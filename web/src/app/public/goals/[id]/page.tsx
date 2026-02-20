"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { erc20Abi, isAddress, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { BASELINE_TAGLINE } from "@/lib/brand";
import ProgressTrend from "@/components/ProgressTrend";
import { habitRegistryAbi } from "@/lib/contracts";
import { logEvent } from "@/lib/eventLogger";
import type { GoalModelType } from "@/lib/goalTypes";
import { getPresetLabel } from "@/lib/goalPresets";
import {
  calculateSnapshotProgressPercent,
  isWeightSnapshotPreset,
} from "@/lib/goalTracking";
import { buildProgressTrendPoints } from "@/lib/progressTrend";
import { cadenceCumulativeHint, cadenceLabel } from "@/lib/cadenceCopy";
import { supabase } from "@/lib/supabaseClient";
import { formatMetricValue } from "@/lib/numberFormat";
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_USDC_ADDRESS,
  HABIT_REGISTRY_ADDRESS,
  HAS_HABIT_REGISTRY_ADDRESS_CONFIG,
  centsToUsdcRaw,
} from "@/lib/sponsorshipChain";
import {
  legacyMinCheckInsToMinimumProgress,
  minimumProgressToLegacyMinCheckIns,
  parseMinimumProgressInput,
} from "@/lib/sponsorshipThreshold";
import { toPostTxPersistenceError, toWalletActionError } from "@/lib/walletErrors";
import styles from "./publicGoal.module.css";

type Goal = {
  id: string;
  user_id: string;
  title: string;
  start_at: string | null;
  completed_at: string | null;
  deadline_at: string;
  model_type: GoalModelType;
  goal_type: "count" | "duration" | null;
  cadence: "daily" | "weekly" | "by_deadline" | null;
  count_unit_preset: string | null;
  cadence_target_value: number | null;
  start_snapshot_value: number | null;
  total_target_value: number | null;
  total_progress_value: number;
  target_value: number | null;
  target_unit: string | null;
  privacy: "private" | "public";
  status: "active" | "completed" | "archived";
  commitment_id: string | null;
  commitment_tx_hash: string | null;
  commitment_chain_id: number | null;
  commitment_created_at: string | null;
  check_in_count: number;
  created_at: string;
};

type Comment = {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
};

type CompletionNft = {
  id: string;
  token_id: string | null;
  tx_hash: string | null;
  created_at: string;
};

type SponsorPledge = {
  id: string;
  amount_cents: number;
  deadline_at: string;
  min_check_ins: number | null;
  status: "offered" | "accepted" | "settled" | "expired" | "cancelled";
  accepted_at: string | null;
  approval_at: string | null;
  settled_at: string | null;
  escrow_tx: string | null;
  onchain_pledge_id: string | null;
  escrow_chain_id: number | null;
  escrow_contract_address: string | null;
  escrow_token_address: string | null;
  escrow_amount_raw: string | null;
  settlement_tx: string | null;
  created_at: string;
};

type PublicSponsorPledge = {
  id: string;
  amount_cents: number;
  deadline_at: string;
  min_check_ins: number | null;
  status: "offered" | "accepted" | "settled" | "expired" | "cancelled";
  approval_at: string | null;
  created_at: string;
};

type SponsorCriteriaNote = {
  id: string;
  pledge_id: string;
  text: string;
  created_at: string;
};

type TrendCheckIn = {
  check_in_at: string;
  progress_value: number;
  progress_snapshot_value: number | null;
};

const isMissingCheckInProgressColumnsError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") &&
    (normalized.includes("progress_value") ||
      normalized.includes("progress_snapshot_value"))
  );
};

const toUnixSeconds = (isoTimestamp: string) =>
  BigInt(Math.floor(new Date(isoTimestamp).getTime() / 1000));

export default function PublicGoalPage() {
  const params = useParams<{ id: string }>();
  const goalId = params?.id;
  const { address: connectedAddress } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: BASE_MAINNET_CHAIN_ID });
  const activeChainId = useChainId();
  const [session, setSession] = useState<Session | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentMessage, setCommentMessage] = useState<string | null>(null);
  const [commentSubmitError, setCommentSubmitError] = useState<string | null>(null);
  const [sponsorPledges, setSponsorPledges] = useState<SponsorPledge[]>([]);
  const [publicSponsorPledges, setPublicSponsorPledges] = useState<PublicSponsorPledge[]>(
    []
  );
  const [sponsorCriteriaNotes, setSponsorCriteriaNotes] = useState<SponsorCriteriaNote[]>(
    []
  );
  const [sponsorMessage, setSponsorMessage] = useState<string | null>(null);
  const [sponsorError, setSponsorError] = useState<string | null>(null);
  const [publicSponsorError, setPublicSponsorError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [completionNft, setCompletionNft] = useState<CompletionNft | null>(null);
  const [pledgeAmount, setPledgeAmount] = useState(10);
  const [pledgeAmountMode, setPledgeAmountMode] = useState<"preset" | "custom">(
    "preset"
  );
  const [customAmount, setCustomAmount] = useState("");
  const [pledgeDeadline, setPledgeDeadline] = useState("");
  const [minimumProgressInput, setMinimumProgressInput] = useState("");
  const [criteriaText, setCriteriaText] = useState("");
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [pledgeMessage, setPledgeMessage] = useState<string | null>(null);
  const [pledgeSubmitting, setPledgeSubmitting] = useState(false);
  const [latestSnapshotProgressValue, setLatestSnapshotProgressValue] = useState<
    number | null
  >(null);
  const [startSnapshotProgressValue, setStartSnapshotProgressValue] = useState<
    number | null
  >(null);
  const [trendCheckIns, setTrendCheckIns] = useState<TrendCheckIn[]>([]);

  const pledgePresets = [5, 10, 20, 50, 100];

  const isDurationGoal =
    goal?.goal_type === "duration" || goal?.model_type === "time";
  const isWeightSnapshotGoal = isWeightSnapshotPreset(goal?.count_unit_preset);
  const goalUnitLabel =
    (isWeightSnapshotGoal
      ? "weight"
      : goal?.count_unit_preset
      ? getPresetLabel(goal.count_unit_preset)
      : goal?.target_unit) ?? (isDurationGoal ? "minutes" : "units");
  const minProgressUnitLabel = goalUnitLabel.toLowerCase();
  const isGoalOwnerViewer = Boolean(
    session?.user?.id && goal?.user_id && session.user.id === goal.user_id
  );
  const progressTargetValue = isWeightSnapshotGoal
    ? goal?.cadence_target_value ?? goal?.target_value ?? goal?.total_target_value ?? null
    : goal?.total_target_value ?? goal?.target_value ?? null;
  const cadenceRollupHint = cadenceCumulativeHint(goal?.cadence);
  const progressCurrentValue = useMemo(() => {
    if (!goal) return null;
    if (isWeightSnapshotGoal) {
      if (latestSnapshotProgressValue !== null) return latestSnapshotProgressValue;
      if (goal.start_snapshot_value !== null) return goal.start_snapshot_value;
      return null;
    }
    if (typeof goal.total_progress_value === "number") {
      return goal.total_progress_value;
    }
    return goal.check_in_count;
  }, [goal, isWeightSnapshotGoal, latestSnapshotProgressValue]);

  const progressPercent = useMemo(() => {
    if (isWeightSnapshotGoal) {
      return calculateSnapshotProgressPercent({
        startValue: startSnapshotProgressValue,
        currentValue: progressCurrentValue,
        targetValue: progressTargetValue,
      });
    }
    if (!progressTargetValue || progressTargetValue <= 0) return 0;
    if (progressCurrentValue === null || progressCurrentValue < 0) return 0;
    return Math.min(Math.round((progressCurrentValue / progressTargetValue) * 100), 100);
  }, [
    isWeightSnapshotGoal,
    progressCurrentValue,
    progressTargetValue,
    startSnapshotProgressValue,
  ]);
  const progressTrendPoints = useMemo(
    () =>
      buildProgressTrendPoints({
        mode: isWeightSnapshotGoal ? "snapshot" : "cumulative",
        checkIns: trendCheckIns.map((checkIn) => ({
          checkInAt: checkIn.check_in_at,
          progressValue: checkIn.progress_value,
          progressSnapshotValue: checkIn.progress_snapshot_value,
        })),
      }),
    [isWeightSnapshotGoal, trendCheckIns]
  );
  const totalSponsoredCents = useMemo(
    () =>
      publicSponsorPledges.reduce((sum, pledge) => sum + Math.max(pledge.amount_cents, 0), 0),
    [publicSponsorPledges]
  );
  const hasVerifiedSponsor = useMemo(
    () => publicSponsorPledges.some((pledge) => pledge.approval_at !== null),
    [publicSponsorPledges]
  );
  const criteriaByPledgeId = useMemo(() => {
    const grouped = new Map<string, SponsorCriteriaNote[]>();
    for (const note of sponsorCriteriaNotes) {
      const current = grouped.get(note.pledge_id) ?? [];
      current.push(note);
      grouped.set(note.pledge_id, current);
    }
    return grouped;
  }, [sponsorCriteriaNotes]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const loadComments = useCallback(async (id: string) => {
    setCommentsLoading(true);
    setCommentsError(null);

    const { data, error: commentsError } = await supabase
      .from("comments")
      .select("id,text,created_at,author_id")
      .eq("goal_id", id)
      .order("created_at", { ascending: false });

    if (commentsError) {
      setCommentsError(commentsError.message);
      setComments([]);
    } else {
      setComments(data ?? []);
    }

    setCommentsLoading(false);
  }, []);

  const loadGoal = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

    const { data, error: goalError } = await supabase
      .from("goals")
      .select("*")
      .eq("id", id)
      .single();

    if (goalError || !data || data.privacy !== "public") {
      setError("Goal not found or private.");
      setGoal(null);
      setLoading(false);
      return;
    }

    setGoal(data);
    setLatestSnapshotProgressValue(null);
    setTrendCheckIns([]);
    setStartSnapshotProgressValue(
      typeof data.start_snapshot_value === "number" ? data.start_snapshot_value : null
    );
    setLoading(false);
    await loadComments(id);

    if (isWeightSnapshotPreset(data.count_unit_preset)) {
      const [latestSnapshotResult, startSnapshotResult] = await Promise.all([
        supabase
          .from("check_ins")
          .select("progress_snapshot_value,check_in_at")
          .eq("goal_id", id)
          .not("progress_snapshot_value", "is", null)
          .order("check_in_at", { ascending: false })
          .limit(1),
        supabase
          .from("check_ins")
          .select("progress_snapshot_value,check_in_at")
          .eq("goal_id", id)
          .not("progress_snapshot_value", "is", null)
          .order("check_in_at", { ascending: true })
          .limit(1),
      ]);

      if (!latestSnapshotResult.error) {
        const latestSnapshot = latestSnapshotResult.data?.[0]?.progress_snapshot_value;
        setLatestSnapshotProgressValue(
          typeof latestSnapshot === "number" ? latestSnapshot : null
        );
      }
      if (
        !startSnapshotResult.error &&
        typeof data.start_snapshot_value !== "number"
      ) {
        const startSnapshot = startSnapshotResult.data?.[0]?.progress_snapshot_value;
        setStartSnapshotProgressValue(typeof startSnapshot === "number" ? startSnapshot : null);
      }
    }

    const progressCheckInsResult = await supabase
      .from("check_ins")
      .select("check_in_at,progress_value,progress_snapshot_value")
      .eq("goal_id", id)
      .order("check_in_at", { ascending: true })
      .limit(120);

    if (
      progressCheckInsResult.error &&
      isMissingCheckInProgressColumnsError(progressCheckInsResult.error.message)
    ) {
      const legacyTrendCheckInsResult = await supabase
        .from("check_ins")
        .select("check_in_at")
        .eq("goal_id", id)
        .order("check_in_at", { ascending: true })
        .limit(120);

      if (!legacyTrendCheckInsResult.error) {
        setTrendCheckIns(
          (legacyTrendCheckInsResult.data ?? []).map((row) => ({
            check_in_at: row.check_in_at,
            progress_value: 1,
            progress_snapshot_value: null,
          }))
        );
      }
    } else if (!progressCheckInsResult.error) {
      setTrendCheckIns(progressCheckInsResult.data ?? []);
    }

    const { data: nftData } = await supabase
      .from("completion_nfts")
      .select("id,token_id,tx_hash,created_at")
      .eq("goal_id", id)
      .maybeSingle();

    setCompletionNft(nftData ?? null);
  }, [loadComments]);

  const loadSponsorPledges = useCallback(async (id: string, userId: string) => {
    const { data, error: pledgeError } = await supabase
      .from("pledges")
      .select(
        "id,amount_cents,deadline_at,min_check_ins,status,accepted_at,approval_at,settled_at,escrow_tx,onchain_pledge_id,escrow_chain_id,escrow_contract_address,escrow_token_address,escrow_amount_raw,settlement_tx,created_at"
      )
      .eq("goal_id", id)
      .eq("sponsor_id", userId)
      .order("created_at", { ascending: false });

    if (pledgeError) {
      setSponsorError(pledgeError.message);
      setSponsorPledges([]);
      return;
    }

    setSponsorPledges(data ?? []);
  }, []);

  const loadPublicSponsorData = useCallback(async (id: string) => {
    setPublicSponsorError(null);

    const [publicPledgesResult, criteriaResult] = await Promise.all([
      supabase
        .from("pledges")
        .select("id,amount_cents,deadline_at,min_check_ins,status,approval_at,created_at")
        .eq("goal_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("sponsor_criteria")
        .select("id,pledge_id,text,created_at,pledges!inner(goal_id)")
        .eq("pledges.goal_id", id)
        .order("created_at", { ascending: false }),
    ]);

    if (publicPledgesResult.error) {
      setPublicSponsorError(publicPledgesResult.error.message);
      setPublicSponsorPledges([]);
    } else {
      setPublicSponsorPledges((publicPledgesResult.data ?? []) as PublicSponsorPledge[]);
    }

    if (criteriaResult.error) {
      if (!publicPledgesResult.error) {
        setPublicSponsorError(criteriaResult.error.message);
      }
      setSponsorCriteriaNotes([]);
    } else {
      const normalized = (criteriaResult.data ?? []).map((row) => ({
        id: row.id,
        pledge_id: row.pledge_id,
        text: row.text,
        created_at: row.created_at,
      })) as SponsorCriteriaNote[];
      setSponsorCriteriaNotes(normalized);
    }
  }, []);

  useEffect(() => {
    if (!goalId) return;
    const timeoutId = setTimeout(() => {
      void loadGoal(goalId);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [goalId, loadGoal]);

  useEffect(() => {
    if (!goalId || !session?.user?.id) return;
    const timeoutId = setTimeout(() => {
      void loadSponsorPledges(goalId, session.user.id);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [goalId, session?.user?.id, loadSponsorPledges]);

  useEffect(() => {
    if (!goalId) return;
    const timeoutId = setTimeout(() => {
      void loadPublicSponsorData(goalId);
    }, 0);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [goalId, loadPublicSponsorData]);

  const handleCommentSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setCommentSubmitError(null);
    setCommentMessage(null);

    if (!session?.user?.id) {
      setCommentSubmitError("Sign in with your wallet to comment.");
      return;
    }

    if (!goalId) {
      setCommentSubmitError("Missing goal id.");
      return;
    }

    if (!commentText.trim()) {
      setCommentSubmitError("Comment text is required.");
      return;
    }

    const { error: insertError } = await supabase.from("comments").insert({
      goal_id: goalId,
      author_id: session.user.id,
      text: commentText.trim(),
    });

    if (insertError) {
      setCommentSubmitError(insertError.message);
      return;
    }

    setCommentText("");
    setCommentMessage("Comment posted.");
    await loadComments(goalId);
  };

  const handleApprove = async (pledgeId: string) => {
    setSponsorMessage(null);
    setSponsorError(null);
    if (!session?.user?.id) {
      setSponsorError("Sign in required.");
      return;
    }
    setApprovingId(pledgeId);

    const approvedPledge = sponsorPledges.find((pledge) => pledge.id === pledgeId);
    if (!approvedPledge) {
      setSponsorError("Pledge not found.");
      setApprovingId(null);
      return;
    }

    let settlementTx: Hex | null = null;
    let settlementContractAddress: Address | null = null;

    const hasOnchainPledge = Boolean(approvedPledge.onchain_pledge_id);

    if (HAS_HABIT_REGISTRY_ADDRESS_CONFIG && hasOnchainPledge) {
      const onchainEscrowContractAddress = approvedPledge.escrow_contract_address;
      if (onchainEscrowContractAddress && isAddress(onchainEscrowContractAddress)) {
        settlementContractAddress = onchainEscrowContractAddress;
      } else if (HABIT_REGISTRY_ADDRESS) {
        settlementContractAddress = HABIT_REGISTRY_ADDRESS;
      } else {
        setSponsorError("Missing/invalid escrow contract address for on-chain settlement.");
        setApprovingId(null);
        return;
      }
      if (!walletClient || !publicClient) {
        setSponsorError("Wallet client unavailable for on-chain settlement.");
        setApprovingId(null);
        return;
      }
      if (!connectedAddress) {
        setSponsorError("Connect your wallet to settle sponsorship.");
        setApprovingId(null);
        return;
      }
      if (activeChainId !== BASE_MAINNET_CHAIN_ID) {
        setSponsorError("Switch wallet network to Base mainnet to settle sponsorship.");
        setApprovingId(null);
        return;
      }
      let onchainPledgeId: bigint;
      try {
        onchainPledgeId = BigInt(approvedPledge.onchain_pledge_id as string);
      } catch {
        setSponsorError("Invalid on-chain pledge id.");
        setApprovingId(null);
        return;
      }

      try {
        const simulation = await publicClient.simulateContract({
          account: connectedAddress as Address,
          address: settlementContractAddress,
          abi: habitRegistryAbi,
          functionName: "settlePledgeBySponsor",
          args: [onchainPledgeId],
          chain: base,
        });
        settlementTx = await walletClient.writeContract(simulation.request);
        await publicClient.waitForTransactionReceipt({ hash: settlementTx });
      } catch (settleError) {
        setSponsorError(
          toWalletActionError({
            error: settleError,
            fallback: "Failed to settle sponsorship on-chain.",
            userRejected: "Settlement transaction was canceled in wallet.",
          })
        );
        setApprovingId(null);
        return;
      }
    }

    const { error: updateError } = await supabase
      .from("pledges")
      .update({
        status: "settled",
        approval_at: new Date().toISOString(),
        settled_at: new Date().toISOString(),
        settlement_tx: settlementTx,
        ...(settlementContractAddress
          ? { escrow_contract_address: settlementContractAddress }
          : {}),
      })
      .eq("id", pledgeId);

    if (updateError) {
      if (settlementTx) {
        setSponsorError(
          toPostTxPersistenceError({
            action: "sponsorship settlement record",
            txHash: settlementTx,
          })
        );
      } else {
        setSponsorError(updateError.message);
      }
      setApprovingId(null);
      return;
    }

    if (goal) {
      const { error: eventError } = await logEvent({
        eventType: "pledge.approved",
        actorId: session.user.id,
        recipientId: goal.user_id,
        goalId: goal.id,
        pledgeId: approvedPledge.id,
        data: {
          amountCents: approvedPledge.amount_cents,
          deadlineAt: approvedPledge.deadline_at,
          minimumProgress: legacyMinCheckInsToMinimumProgress(approvedPledge.min_check_ins),
        },
      });

      if (eventError) {
        console.warn("Failed to log pledge.approved event", eventError);
      }
    }

    setSponsorMessage(
      hasOnchainPledge
        ? "Approval recorded. Escrow settled on-chain."
        : "Approval recorded. Legacy off-chain pledge marked settled."
    );
    await loadSponsorPledges(goalId as string, session?.user?.id as string);
    await loadPublicSponsorData(goalId as string);
    setApprovingId(null);
  };

  const handlePledgeSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPledgeError(null);
    setPledgeMessage(null);

    if (!session?.user?.id) {
      setPledgeError("Sign in with your wallet to sponsor.");
      return;
    }

    if (!goalId) {
      setPledgeError("Missing goal id.");
      return;
    }

    if (isGoalOwnerViewer) {
      setPledgeError("You can’t sponsor your own goal.");
      return;
    }

    const amountValue =
      pledgeAmountMode === "custom" ? Number(customAmount) : pledgeAmount;

    if (!amountValue || Number.isNaN(amountValue) || amountValue < 5) {
      setPledgeError("Pledge amount must be at least $5.");
      return;
    }

    if (!pledgeDeadline) {
      setPledgeError("Pledge deadline is required.");
      return;
    }

    const deadlineISO = new Date(`${pledgeDeadline}T00:00:00`).toISOString();
    const minimumProgressParse = parseMinimumProgressInput(minimumProgressInput);

    if (!minimumProgressParse.valid) {
      setPledgeError("Minimum progress must be 0 or greater.");
      return;
    }

    const minimumProgressValue = minimumProgressParse.value;

    setPledgeSubmitting(true);

    const amountCents = Math.round(amountValue * 100);
    const minimumProgressLegacy =
      minimumProgressToLegacyMinCheckIns(minimumProgressValue);
    let status: SponsorPledge["status"] = "offered";
    let acceptedAt: string | null = null;
    let escrowTx: Hex | null = null;
    let onchainPledgeId: string | null = null;
    let escrowChainId: number | null = null;
    let escrowContractAddress: string | null = null;
    let escrowTokenAddress: string | null = null;
    let escrowAmountRaw: string | null = null;

    if (HAS_HABIT_REGISTRY_ADDRESS_CONFIG) {
      if (!HABIT_REGISTRY_ADDRESS) {
        setPledgeError("Invalid NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS.");
        setPledgeSubmitting(false);
        return;
      }
      if (!BASE_USDC_ADDRESS) {
        setPledgeError("Invalid NEXT_PUBLIC_BASE_USDC_ADDRESS.");
        setPledgeSubmitting(false);
        return;
      }
      if (!goal?.commitment_id) {
        setPledgeError("Goal is missing on-chain commitment. Ask owner to re-anchor goal.");
        setPledgeSubmitting(false);
        return;
      }
      if (!walletClient || !publicClient) {
        setPledgeError("Wallet client unavailable for on-chain sponsorship.");
        setPledgeSubmitting(false);
        return;
      }
      if (!connectedAddress) {
        setPledgeError("Connect your wallet to submit a sponsorship.");
        setPledgeSubmitting(false);
        return;
      }
      if (activeChainId !== BASE_MAINNET_CHAIN_ID) {
        setPledgeError("Switch wallet network to Base mainnet to sponsor.");
        setPledgeSubmitting(false);
        return;
      }

      let commitmentIdBigInt: bigint;
      try {
        commitmentIdBigInt = BigInt(goal.commitment_id);
      } catch {
        setPledgeError("Goal commitment id is invalid for on-chain sponsorship.");
        setPledgeSubmitting(false);
        return;
      }

      try {
        const amountRaw = centsToUsdcRaw(amountCents);
        const approveSimulation = await publicClient.simulateContract({
          account: connectedAddress as Address,
          address: BASE_USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [HABIT_REGISTRY_ADDRESS, amountRaw],
          chain: base,
        });
        const approveTx = await walletClient.writeContract(approveSimulation.request);
        await publicClient.waitForTransactionReceipt({ hash: approveTx });

        const createSimulation = await publicClient.simulateContract({
          account: connectedAddress as Address,
          address: HABIT_REGISTRY_ADDRESS,
          abi: habitRegistryAbi,
          functionName: "createPledge",
          args: [
            commitmentIdBigInt,
            amountRaw,
            toUnixSeconds(deadlineISO),
            BigInt(minimumProgressLegacy ?? 0),
          ],
          chain: base,
        });

        onchainPledgeId = String(createSimulation.result);
        escrowTx = await walletClient.writeContract(createSimulation.request);
        await publicClient.waitForTransactionReceipt({ hash: escrowTx });

        status = "accepted";
        acceptedAt = new Date().toISOString();
        escrowChainId = BASE_MAINNET_CHAIN_ID;
        escrowContractAddress = HABIT_REGISTRY_ADDRESS;
        escrowTokenAddress = BASE_USDC_ADDRESS;
        escrowAmountRaw = amountRaw.toString();
      } catch (onchainError) {
        setPledgeError(
          toWalletActionError({
            error: onchainError,
            fallback: "Failed to create on-chain sponsorship escrow.",
            userRejected: "Sponsorship transaction was canceled in wallet.",
          })
        );
        setPledgeSubmitting(false);
        return;
      }
    }

    const { data: pledgeData, error: pledgeInsertError } = await supabase
      .from("pledges")
      .insert({
        goal_id: goalId,
        sponsor_id: session.user.id,
        amount_cents: amountCents,
        deadline_at: deadlineISO,
        min_check_ins: minimumProgressLegacy,
        status,
        accepted_at: acceptedAt,
        escrow_tx: escrowTx,
        onchain_pledge_id: onchainPledgeId,
        escrow_chain_id: escrowChainId,
        escrow_contract_address: escrowContractAddress,
        escrow_token_address: escrowTokenAddress,
        escrow_amount_raw: escrowAmountRaw,
      })
      .select("id")
      .single();

    if (pledgeInsertError || !pledgeData?.id) {
      if (status === "accepted" && escrowTx) {
        setPledgeError(
          toPostTxPersistenceError({
            action: "pledge record",
            txHash: escrowTx,
          })
        );
      } else {
        setPledgeError(pledgeInsertError?.message ?? "Failed to create pledge.");
      }
      setPledgeSubmitting(false);
      return;
    }

    const criteria = criteriaText.trim();
    let criteriaSaveFailed = false;
    if (criteria) {
      const { error: criteriaError } = await supabase
        .from("sponsor_criteria")
        .insert({
          pledge_id: pledgeData.id,
          text: criteria,
        });

      if (criteriaError) {
        console.warn("Failed to save sponsor criteria", criteriaError.message);
        criteriaSaveFailed = true;
      }
    }

    if (goal) {
      const { error: eventError } = await logEvent({
        eventType: "pledge.offered",
        actorId: session.user.id,
        recipientId: goal.user_id,
        goalId: goal.id,
        pledgeId: pledgeData.id,
        data: {
          amountCents,
          deadlineAt: deadlineISO,
          minimumProgress: minimumProgressValue,
          hasCriteria: Boolean(criteria) && !criteriaSaveFailed,
          escrowedOnchain: status === "accepted",
          escrowTx,
        },
      });

      if (eventError) {
        console.warn("Failed to log pledge.offered event", eventError);
      }
    }

    setPledgeMessage(
      criteriaSaveFailed
        ? status === "accepted"
          ? "USDC sponsorship escrow funded and submitted. Criteria text could not be saved."
          : "Sponsorship offer sent. Criteria text could not be saved."
        : status === "accepted"
          ? "USDC sponsorship escrow funded and submitted."
          : "Sponsorship offer sent."
    );
    setPledgeSubmitting(false);
    setPledgeAmount(10);
    setPledgeAmountMode("preset");
    setCustomAmount("");
    setPledgeDeadline("");
    setMinimumProgressInput("");
    setCriteriaText("");
    await loadPublicSponsorData(goalId);
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <div className={styles.brandRow}>
              <div className={styles.brand}>Baseline</div>
              <div className={styles.tagline}>{BASELINE_TAGLINE}</div>
            </div>
            <Link href="/" className={styles.backLink}>
              Back to Baseline
            </Link>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.pill}>Public goal</span>
          </div>
        </header>

        {loading ? (
          <div className={styles.card}>Loading goal...</div>
        ) : error ? (
          <div className={styles.card}>{error}</div>
        ) : goal ? (
          <>
            <section className={styles.card}>
              <div className={styles.title}>{goal.title}</div>
              <div className={styles.metaRow}>
                <span className={styles.pill}>{goal.model_type}</span>
                <span className={styles.pill}>
                  {cadenceLabel(goal.cadence)}
                  {cadenceRollupHint ? " (cumulative)" : ""}
                </span>
                <span className={styles.pill}>{goal.status}</span>
                {completionNft ? (
                  <span className={styles.pill}>Completion NFT</span>
                ) : null}
                {hasVerifiedSponsor ? (
                  <span className={styles.pill}>Verified by sponsor</span>
                ) : null}
                {goal.completed_at ? (
                  <span className={styles.pill}>
                    Completed {new Date(goal.completed_at).toLocaleDateString()}
                  </span>
                ) : null}
                {goal.start_at ? (
                  <span className={styles.pill}>
                    Starts {new Date(goal.start_at).toLocaleDateString()}
                  </span>
                ) : null}
                <span className={styles.pill}>
                  Due {new Date(goal.deadline_at).toLocaleDateString()}
                </span>
                {goal.commitment_id ? (
                  <span className={styles.pill}>
                    Anchored #{`${goal.commitment_id.slice(0, 10)}${goal.commitment_id.length > 10 ? "..." : ""}`}
                  </span>
                ) : null}
                {goal.commitment_chain_id ? (
                  <span className={styles.pill}>Chain {goal.commitment_chain_id}</span>
                ) : null}
              </div>
              <div className={styles.progressWrap}>
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className={styles.progressLabel}>
                  {progressTargetValue
                    ? isWeightSnapshotGoal
                      ? `${progressPercent}% to goal weight ${formatMetricValue(progressTargetValue)}`
                      : `${progressPercent}% of ${progressTargetValue} ${goalUnitLabel}${
                          cadenceRollupHint ? " (cumulative target)" : ""
                        }`
                    : "Target not set yet"}
                </div>
                <div className={styles.progressMeta}>
                  {progressCurrentValue !== null
                    ? isWeightSnapshotGoal
                      ? `Current weight: ${formatMetricValue(progressCurrentValue)}${
                          startSnapshotProgressValue !== null
                            ? ` (started ${formatMetricValue(startSnapshotProgressValue)})`
                            : ""
                        }`
                      : `Logged: ${progressCurrentValue} ${goalUnitLabel}`
                    : `${goal.check_in_count} check-ins logged`}
                </div>
                {!isWeightSnapshotGoal && cadenceRollupHint ? (
                  <div className={styles.progressMeta}>{cadenceRollupHint}</div>
                ) : null}
                <ProgressTrend
                  points={progressTrendPoints}
                  mode={isWeightSnapshotGoal ? "snapshot" : "cumulative"}
                  unitLabel={goalUnitLabel.toLowerCase()}
                />
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.sectionTitle}>Sponsor activity</div>
              {publicSponsorError ? (
                <div className={styles.message}>{publicSponsorError}</div>
              ) : null}
              {publicSponsorPledges.length === 0 ? (
                <div className={styles.empty}>No sponsorships yet.</div>
              ) : (
                <>
                  <div className={styles.progressMeta}>
                    {publicSponsorPledges.length} sponsor
                    {publicSponsorPledges.length === 1 ? "" : "s"} · $
                    {Math.round(totalSponsoredCents / 100)} total offered
                    {hasVerifiedSponsor ? " · verified by sponsor" : ""}
                  </div>
                  <div className={styles.list}>
                    {publicSponsorPledges.map((pledge, index) => {
                      const minimumProgress = legacyMinCheckInsToMinimumProgress(
                        pledge.min_check_ins
                      );
                      const criteria = criteriaByPledgeId.get(pledge.id) ?? [];
                      return (
                        <div key={pledge.id} className={styles.listItem}>
                          <div className={styles.listMeta}>
                            Sponsor #{index + 1} · Offered{" "}
                            {new Date(pledge.created_at).toLocaleDateString()}
                          </div>
                          <div>
                            ${Math.round(pledge.amount_cents / 100)} ·{" "}
                            {pledge.status === "settled" && !pledge.approval_at
                              ? "settled (no response)"
                              : pledge.status}
                          </div>
                          {minimumProgress !== null ? (
                            <div className={styles.listMeta}>
                              Minimum progress: {minimumProgress} {minProgressUnitLabel}
                            </div>
                          ) : null}
                          <div className={styles.listMeta}>
                            Offer deadline {new Date(pledge.deadline_at).toLocaleDateString()}
                          </div>
                          {criteria.map((note) => (
                            <div key={note.id} className={styles.listMeta}>
                              Criteria: {note.text}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            <section className={styles.card}>
              <div className={styles.sectionTitle}>Sponsor this goal</div>
              <div className={styles.progressMeta}>
                Sponsorships are funded in Base USDC escrow when submitted.
              </div>
              {session ? (
                isGoalOwnerViewer ? (
                  <div className={styles.empty}>You can’t sponsor your own goal.</div>
                ) : (
                <form className={styles.form} onSubmit={handlePledgeSubmit}>
                  <div className={styles.field}>
                    <label className={styles.label}>Pledge amount</label>
                    <div className={styles.amountGrid}>
                      {pledgePresets.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          className={`${styles.amountButton} ${
                            pledgeAmountMode === "preset" && pledgeAmount === amount
                              ? styles.amountButtonActive
                              : ""
                          }`}
                          onClick={() => {
                            setPledgeAmount(amount);
                            setPledgeAmountMode("preset");
                          }}
                        >
                          ${amount}
                        </button>
                      ))}
                      <label
                        htmlFor="pledge-custom-amount"
                        className={`${styles.customAmount} ${
                          pledgeAmountMode === "custom" ? styles.customAmountActive : ""
                        }`}
                      >
                        <span className={styles.customLabel}>Custom</span>
                        <span className={styles.customDivider} aria-hidden="true" />
                        <span className={styles.customPrefix}>$</span>
                        <input
                          id="pledge-custom-amount"
                          type="number"
                          min="5"
                          step="1"
                          className={styles.customInput}
                          value={customAmount}
                          onChange={(event) => {
                            setCustomAmount(event.target.value);
                            setPledgeAmountMode("custom");
                          }}
                          onFocus={() => setPledgeAmountMode("custom")}
                          placeholder="5"
                        />
                      </label>
                    </div>
                    <div className={styles.fieldHint}>Custom amount must be at least $5.</div>
                  </div>

                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="pledge-deadline">
                        Pledge deadline
                      </label>
                      <input
                        id="pledge-deadline"
                        type="date"
                        className={styles.input}
                        value={pledgeDeadline}
                        onChange={(event) => setPledgeDeadline(event.target.value)}
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="pledge-min-progress">
                        Minimum progress ({minProgressUnitLabel})
                      </label>
                      <input
                        id="pledge-min-progress"
                        type="number"
                        min="0"
                        step="1"
                        className={styles.input}
                        value={minimumProgressInput}
                        onChange={(event) => setMinimumProgressInput(event.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="pledge-criteria">
                      Criteria (optional)
                    </label>
                    <textarea
                      id="pledge-criteria"
                      className={styles.textarea}
                      value={criteriaText}
                      onChange={(event) => setCriteriaText(event.target.value)}
                      placeholder="Share any expectations (non-binding)."
                    />
                  </div>

                  {pledgeError ? <div className={styles.message}>{pledgeError}</div> : null}
                  {pledgeMessage ? (
                    <div className={`${styles.message} ${styles.success}`}>{pledgeMessage}</div>
                  ) : null}
                  <div className={styles.buttonRow}>
                    <button className={styles.buttonPrimary} type="submit" disabled={pledgeSubmitting}>
                      {pledgeSubmitting ? "Sending..." : "Send sponsorship offer"}
                    </button>
                  </div>
                </form>
                )
              ) : (
                <div className={styles.empty}>
                  Sign in with your wallet to sponsor this goal.
                </div>
              )}
            </section>

            {session ? (
              <section className={styles.card}>
                <div className={styles.sectionTitle}>Your sponsorships</div>
                {sponsorError ? <div className={styles.message}>{sponsorError}</div> : null}
                {sponsorMessage ? (
                  <div className={`${styles.message} ${styles.success}`}>
                    {sponsorMessage}
                  </div>
                ) : null}
                {sponsorPledges.length === 0 ? (
                  <div className={styles.empty}>
                    No sponsorships on this goal yet.
                  </div>
                ) : (
                  <div className={styles.list}>
                    {sponsorPledges.map((pledge) => {
                      const minimumProgress = legacyMinCheckInsToMinimumProgress(
                        pledge.min_check_ins
                      );
                      const approvalExpired =
                        pledge.status === "settled" && !pledge.approval_at;

                      return (
                        <div key={pledge.id} className={styles.listItem}>
                          <div className={styles.listMeta}>
                            Offer {new Date(pledge.created_at).toLocaleDateString()}
                          </div>
                          <div>
                            ${Math.round(pledge.amount_cents / 100)} ·{" "}
                            {pledge.status === "settled" && !pledge.approval_at
                              ? "settled (no response)"
                              : pledge.status}
                          </div>
                          {goal?.completed_at && pledge.status === "accepted" ? (
                            <div className={styles.listMeta}>
                              Approval window is open for 7 days after completion.
                            </div>
                          ) : null}
                          {minimumProgress !== null ? (
                            <div className={styles.listMeta}>
                              Minimum progress: {minimumProgress} {minProgressUnitLabel}
                            </div>
                          ) : null}
                          <div className={styles.buttonRow}>
                            <button
                              className={styles.buttonPrimary}
                              type="button"
                              onClick={() => handleApprove(pledge.id)}
                              disabled={
                                pledge.status !== "accepted" ||
                                !goal?.completed_at ||
                                approvalExpired ||
                                approvingId === pledge.id
                              }
                            >
                              {pledge.status === "accepted"
                                ? approvingId === pledge.id
                                  ? "Approving..."
                                  : "Approve completion"
                                : "Approval unavailable"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}

            <section className={styles.card}>
              <div className={styles.sectionTitle}>Comments</div>
              {session ? (
                <form className={styles.form} onSubmit={handleCommentSubmit}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="comment-text">
                      Add a comment
                    </label>
                    <textarea
                      id="comment-text"
                      className={styles.textarea}
                      value={commentText}
                      onChange={(event) => setCommentText(event.target.value)}
                      placeholder="Share encouragement or a quick note."
                    />
                  </div>
                  {commentSubmitError ? (
                    <div className={styles.message}>{commentSubmitError}</div>
                  ) : null}
                  {commentMessage ? (
                    <div className={`${styles.message} ${styles.success}`}>{commentMessage}</div>
                  ) : null}
                  <div className={styles.buttonRow}>
                    <button className={styles.buttonPrimary} type="submit">
                      Post comment
                    </button>
                  </div>
                </form>
              ) : (
                <div className={styles.empty}>
                  Sign in with your wallet to comment.
                </div>
              )}

              {commentsLoading ? (
                <div className={styles.message}>Loading comments...</div>
              ) : commentsError ? (
                <div className={styles.message}>{commentsError}</div>
              ) : comments.length === 0 ? (
                <div className={styles.empty}>No comments yet.</div>
              ) : (
                <div className={styles.list}>
                  {comments.map((comment) => (
                    <div key={comment.id} className={styles.listItem}>
                      <div className={styles.listMeta}>
                        Supporter · {new Date(comment.created_at).toLocaleString()}
                      </div>
                      <div>{comment.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <div className={styles.card}>Goal not found or private.</div>
        )}
      </div>
    </div>
  );
}
