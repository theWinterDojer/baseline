"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { base } from "viem/chains";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { BASELINE_TAGLINE } from "@/lib/brand";
import { supabase } from "@/lib/supabaseClient";
import { logEvent } from "@/lib/eventLogger";
import ProgressTrend from "@/components/ProgressTrend";
import {
  habitRegistryAbi,
  mockCompletionNft,
  mockHabitRegistry,
} from "@/lib/contracts";
import type { GoalModelType } from "@/lib/goalTypes";
import {
  calculateSnapshotProgressPercent,
  isMissingGoalTrackingColumnsError,
  isWeightSnapshotPreset,
} from "@/lib/goalTracking";
import { buildProgressTrendPoints } from "@/lib/progressTrend";
import { cadenceCumulativeHint } from "@/lib/cadenceCopy";
import { getPresetLabel } from "@/lib/goalPresets";
import { formatMetricValue } from "@/lib/numberFormat";
import { toPostTxPersistenceError, toWalletActionError } from "@/lib/walletErrors";
import styles from "./goal.module.css";

type Goal = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  start_at: string | null;
  completed_at: string | null;
  deadline_at: string;
  model_type: GoalModelType;
  goal_type: "count" | "duration" | null;
  cadence: "daily" | "weekly" | "by_deadline" | null;
  goal_category: string | null;
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
  created_at: string;
};

type CheckIn = {
  id: string;
  check_in_at: string;
  note: string | null;
  progress_value: number;
  progress_snapshot_value: number | null;
  progress_unit: string | null;
  proof_hash: string | null;
  image_path: string | null;
  onchain_commitment_id: string | null;
  onchain_tx_hash: string | null;
  onchain_chain_id: number | null;
  onchain_submitted_at: string | null;
  image_url: string | null;
  created_at: string;
};

type CompletionNft = {
  id: string;
  token_id: string | null;
  tx_hash: string | null;
  status: string;
  created_at: string;
};

const isMissingCompletedAtColumnError = (message: string) =>
  message.includes("completed_at") && message.includes("does not exist");

const isMissingCheckInImagePathColumnError = (message: string) =>
  message.includes("image_path") && message.includes("does not exist");
const isMissingCheckInOnchainColumnsError = (message: string) =>
  message.includes("does not exist") &&
  [
    "onchain_commitment_id",
    "onchain_tx_hash",
    "onchain_chain_id",
    "onchain_submitted_at",
  ].some((column) => message.includes(column));
const isMissingCheckInProgressColumnsError = (message: string) =>
  message.includes("does not exist") &&
  ["progress_value", "progress_snapshot_value", "progress_unit"].some((column) =>
    message.includes(column)
  );
const CHECK_IN_IMAGES_BUCKET = "checkin-images";
const MAX_CHECK_IN_IMAGE_BYTES = 8 * 1024 * 1024;
const BASE_MAINNET_CHAIN_ID = 8453;
const habitRegistryAddressRaw = process.env.NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS;
const HAS_HABIT_REGISTRY_ADDRESS_CONFIG = Boolean(habitRegistryAddressRaw);
const HABIT_REGISTRY_ADDRESS = /^0x[a-fA-F0-9]{40}$/.test(habitRegistryAddressRaw ?? "")
  ? (habitRegistryAddressRaw as Address)
  : null;

const normalizeImageExtension = (file: File) => {
  const fileNameExtension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (fileNameExtension) {
    const sanitized = fileNameExtension.replace(/[^a-z0-9]/g, "");
    if (sanitized) return sanitized;
  }
  const mimeSubtype = file.type.split("/")[1]?.toLowerCase() ?? "";
  const sanitizedMimeSubtype = mimeSubtype.replace(/[^a-z0-9]/g, "");
  return sanitizedMimeSubtype || "bin";
};

const buildCheckInImagePath = (userId: string, goalId: string, file: File) =>
  `${userId}/${goalId}/${crypto.randomUUID()}.${normalizeImageExtension(file)}`;

const goalCommitmentHash = (goal: Goal) => {
  const payload = JSON.stringify({
    version: 1,
    goalId: goal.id,
    ownerId: goal.user_id,
    title: goal.title,
    description: goal.description,
    startAt: goal.start_at,
    deadlineAt: goal.deadline_at,
    modelType: goal.model_type,
    targetValue: goal.target_value,
    targetUnit: goal.target_unit,
    createdAt: goal.created_at,
  });
  return keccak256(toBytes(payload));
};

const toUnixSeconds = (isoTimestamp: string) =>
  BigInt(Math.floor(new Date(isoTimestamp).getTime() / 1000));

const shortHash = (value: string, head = 10, tail = 6) => {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

const isRealTxHash = (value: string) => /^0x[a-fA-F0-9]{64}$/.test(value);
const isMockTxRef = (value: string) => value.startsWith("mock:");

const baseScanTxUrl = (txHash: string) =>
  isRealTxHash(txHash) ? `https://basescan.org/tx/${txHash}` : null;

const formatDateInput = (value: string | null) => {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
};

const parsePositiveInteger = (value: string): number | null => {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseNonNegativeDecimal = (value: string): number | null => {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const isSchemaTrackingConfigured = (nextGoal: Goal) =>
  nextGoal.goal_type !== null ||
  nextGoal.cadence !== null ||
  nextGoal.goal_category !== null ||
  nextGoal.count_unit_preset !== null ||
  nextGoal.cadence_target_value !== null ||
  nextGoal.total_target_value !== null;

const toDateInputUtcMillis = (value: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (
    !Number.isSafeInteger(year) ||
    !Number.isSafeInteger(month) ||
    !Number.isSafeInteger(day)
  ) {
    return null;
  }
  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const toInclusiveDateRangeDays = (startDate: string, deadlineDate: string): number | null => {
  const startAt = toDateInputUtcMillis(startDate);
  const deadlineAt = toDateInputUtcMillis(deadlineDate);
  if (startAt === null || deadlineAt === null) return null;
  if (deadlineAt < startAt) return null;
  const days = Math.floor((deadlineAt - startAt) / (24 * 60 * 60 * 1000)) + 1;
  return days > 0 && Number.isSafeInteger(days) ? days : null;
};

const calculateTotalTargetValue = ({
  cadence,
  cadenceTargetValue,
  startDate,
  deadlineDate,
}: {
  cadence: Goal["cadence"];
  cadenceTargetValue: number;
  startDate: string;
  deadlineDate: string;
}): number | null => {
  if (!Number.isSafeInteger(cadenceTargetValue) || cadenceTargetValue <= 0) return null;

  if (cadence === "by_deadline" || cadence === null) {
    return cadenceTargetValue;
  }

  const days = toInclusiveDateRangeDays(startDate, deadlineDate);
  if (!days) return null;

  const occurrences = cadence === "daily" ? days : Math.ceil(days / 7);
  const total = cadenceTargetValue * occurrences;
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  return total;
};

const toEditForm = (nextGoal: Goal) => {
  const targetValueSource = isSchemaTrackingConfigured(nextGoal)
    ? nextGoal.cadence_target_value ??
      nextGoal.target_value ??
      nextGoal.total_target_value
    : nextGoal.target_value;

  return {
    title: nextGoal.title ?? "",
    hasStartDate: Boolean(nextGoal.start_at),
    startDate: formatDateInput(nextGoal.start_at),
    deadline: formatDateInput(nextGoal.deadline_at),
    modelType: nextGoal.model_type,
    targetValue: targetValueSource ? String(targetValueSource) : "",
    targetUnit: nextGoal.target_unit ?? "",
  };
};

export default function GoalPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const goalId = params?.id;
  const { address: connectedAddress } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: BASE_MAINNET_CHAIN_ID });
  const activeChainId = useChainId();
  const [session, setSession] = useState<Session | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [checkInValueInput, setCheckInValueInput] = useState("1");
  const [checkInImageFile, setCheckInImageFile] = useState<File | null>(null);
  const [checkInImagePreviewUrl, setCheckInImagePreviewUrl] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submittingCheckIn, setSubmittingCheckIn] = useState(false);
  const [privacyUpdating, setPrivacyUpdating] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState<string | null>(null);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [pledgeCount, setPledgeCount] = useState(0);
  const [completionUpdating, setCompletionUpdating] = useState(false);
  const [completionMessage, setCompletionMessage] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completionWarning, setCompletionWarning] = useState<string | null>(null);
  const [completionNft, setCompletionNft] = useState<CompletionNft | null>(null);
  const [nftMessage, setNftMessage] = useState<string | null>(null);
  const [nftError, setNftError] = useState<string | null>(null);
  const [nftMinting, setNftMinting] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    hasStartDate: false,
    startDate: "",
    deadline: "",
    modelType: "count" as GoalModelType,
    targetValue: "",
    targetUnit: "",
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [editUpdating, setEditUpdating] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteUpdating, setDeleteUpdating] = useState(false);
  const checkInImageInputRef = useRef<HTMLInputElement | null>(null);

  const walletAddress = session?.user?.user_metadata?.wallet_address as
    | string
    | undefined;
  const sessionChainIdRaw = session?.user?.user_metadata?.chain_id;
  const sessionChainId =
    typeof sessionChainIdRaw === "number"
      ? sessionChainIdRaw
      : typeof sessionChainIdRaw === "string"
        ? Number(sessionChainIdRaw)
        : NaN;

  const isDurationGoal =
    goal?.goal_type === "duration" || goal?.model_type === "time";
  const isWeightSnapshotGoal = isWeightSnapshotPreset(goal?.count_unit_preset);
  const durationTrackingUnit =
    isDurationGoal && goal?.target_unit === "hours" ? "hours" : "minutes";
  const goalUnitLabel =
    (isWeightSnapshotGoal
      ? "weight"
      : goal?.count_unit_preset
      ? getPresetLabel(goal.count_unit_preset)
      : goal?.target_unit) ?? (isDurationGoal ? "minutes" : "units");
  const progressTargetValue = isWeightSnapshotGoal
    ? goal?.cadence_target_value ?? goal?.target_value ?? goal?.total_target_value ?? null
    : goal?.total_target_value ?? goal?.target_value ?? null;
  const isSchemaTrackingGoal = goal ? isSchemaTrackingConfigured(goal) : false;
  const schemaTargetLabel = isWeightSnapshotGoal
    ? "Goal weight"
    : goal?.cadence === "daily"
      ? isDurationGoal
        ? `${durationTrackingUnit === "hours" ? "Hours" : "Minutes"} per day`
        : "Amount per day"
      : goal?.cadence === "weekly"
        ? isDurationGoal
          ? `${durationTrackingUnit === "hours" ? "Hours" : "Minutes"} per week`
          : "Amount per week"
        : isDurationGoal
          ? `Total ${durationTrackingUnit}`
          : "Total target";
  const schemaTargetHelper = isWeightSnapshotGoal
    ? "Use a whole-number goal weight."
    : isDurationGoal
      ? goal?.cadence === "by_deadline"
        ? `Set the total ${durationTrackingUnit} to complete by the deadline.`
        : `Set the ${durationTrackingUnit} target for each cadence period.`
      : `Measured in ${goalUnitLabel}.`;
  const cadenceRollupHint = cadenceCumulativeHint(goal?.cadence);
  const snapshotProgressRange = useMemo(() => {
    if (!isWeightSnapshotGoal) return null;
    let earliest: { value: number; time: number } | null = null;
    let latest: { value: number; time: number } | null = null;

    for (const checkIn of checkIns) {
      if (checkIn.progress_snapshot_value === null) continue;
      const timestamp = new Date(checkIn.check_in_at).getTime();
      if (Number.isNaN(timestamp)) continue;

      if (!earliest || timestamp < earliest.time) {
        earliest = { value: checkIn.progress_snapshot_value, time: timestamp };
      }
      if (!latest || timestamp > latest.time) {
        latest = { value: checkIn.progress_snapshot_value, time: timestamp };
      }
    }

    return {
      startValue: earliest?.value ?? null,
      latestValue: latest?.value ?? null,
    };
  }, [checkIns, isWeightSnapshotGoal]);

  const latestSnapshotProgressValue = snapshotProgressRange?.latestValue ?? null;
  const startSnapshotProgressValue =
    goal?.start_snapshot_value ?? snapshotProgressRange?.startValue ?? null;

  const progressCurrentValue = useMemo(() => {
    if (!goal) return null;
    if (isWeightSnapshotGoal) {
      if (latestSnapshotProgressValue !== null) {
        return latestSnapshotProgressValue;
      }
      if (goal.start_snapshot_value !== null) {
        return goal.start_snapshot_value;
      }
      return null;
    }

    if (typeof goal.total_progress_value === "number") {
      return goal.total_progress_value;
    }

    return checkIns.length;
  }, [checkIns.length, goal, isWeightSnapshotGoal, latestSnapshotProgressValue]);

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
        checkIns: checkIns.map((checkIn) => ({
          checkInAt: checkIn.check_in_at,
          progressValue: checkIn.progress_value,
          progressSnapshotValue: checkIn.progress_snapshot_value,
        })),
      }),
    [checkIns, isWeightSnapshotGoal]
  );

  const isOwner = Boolean(session?.user?.id && goal?.user_id === session.user.id);
  const canMarkComplete = Boolean(
    progressTargetValue && progressTargetValue > 0 && progressPercent >= 100
  );
  const deleteLockReason = !goal
    ? null
    : goal.privacy !== "private"
      ? "Make this goal private before deleting."
      : pledgeCount > 0
        ? "This goal has pledges and can’t be deleted."
        : null;

  const clearCheckInImageSelection = useCallback(() => {
    if (checkInImagePreviewUrl) {
      URL.revokeObjectURL(checkInImagePreviewUrl);
    }
    setCheckInImagePreviewUrl(null);
    setCheckInImageFile(null);
    if (checkInImageInputRef.current) {
      checkInImageInputRef.current.value = "";
    }
  }, [checkInImagePreviewUrl]);

  const handleCheckInImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSubmitError(null);
    const nextFile = event.target.files?.[0] ?? null;

    if (!nextFile) {
      clearCheckInImageSelection();
      return;
    }

    if (!nextFile.type.startsWith("image/")) {
      setSubmitError("Attachment must be an image file.");
      clearCheckInImageSelection();
      return;
    }

    if (nextFile.size > MAX_CHECK_IN_IMAGE_BYTES) {
      setSubmitError("Image must be 8MB or smaller.");
      clearCheckInImageSelection();
      return;
    }

    if (checkInImagePreviewUrl) {
      URL.revokeObjectURL(checkInImagePreviewUrl);
    }
    setCheckInImageFile(nextFile);
    setCheckInImagePreviewUrl(URL.createObjectURL(nextFile));
  };

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

  useEffect(() => {
    return () => {
      if (checkInImagePreviewUrl) {
        URL.revokeObjectURL(checkInImagePreviewUrl);
      }
    };
  }, [checkInImagePreviewUrl]);

  useEffect(() => {
    if (!goal) return;
    if (isWeightSnapshotPreset(goal.count_unit_preset)) {
      setCheckInValueInput("");
      return;
    }
    if (goal.goal_type === "duration" || goal.model_type === "time") {
      setCheckInValueInput(goal.target_unit === "hours" ? "1" : "30");
      return;
    }
    setCheckInValueInput("1");
  }, [goal]);

  const ensureGoalCommitmentAnchor = useCallback(
    async (currentGoal: Goal) => {
      if (currentGoal.commitment_id) {
        return { goal: currentGoal, created: false };
      }

      const startAt = currentGoal.start_at ?? currentGoal.created_at;
      const accountAddress = (walletClient?.account?.address ??
        connectedAddress ??
        walletAddress) as Address | undefined;

      let commitmentId: string;
      let txHash: string;
      let anchorChainId = BASE_MAINNET_CHAIN_ID;

      if (HAS_HABIT_REGISTRY_ADDRESS_CONFIG) {
        if (!HABIT_REGISTRY_ADDRESS) {
          throw new Error("Invalid NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS.");
        }
        if (!walletClient || !publicClient || !accountAddress) {
          throw new Error("Wallet client unavailable for on-chain commitment anchoring.");
        }
        if (activeChainId !== BASE_MAINNET_CHAIN_ID) {
          throw new Error("Switch wallet network to Base mainnet to anchor this public goal.");
        }

        const simulation = await publicClient.simulateContract({
          account: accountAddress,
          address: HABIT_REGISTRY_ADDRESS,
          abi: habitRegistryAbi,
          functionName: "createCommitment",
          args: [goalCommitmentHash(currentGoal), BigInt(1), toUnixSeconds(startAt)],
          chain: base,
        });

        commitmentId = String(simulation.result);
        const realTxHash = await walletClient.writeContract(simulation.request);
        await publicClient.waitForTransactionReceipt({ hash: realTxHash });
        txHash = realTxHash;
        anchorChainId = BASE_MAINNET_CHAIN_ID;
      } else {
        const mockResult = await mockHabitRegistry.createCommitment({
          habitHash: goalCommitmentHash(currentGoal),
          cadence: 1,
          startDate: toUnixSeconds(startAt),
          creator: walletAddress,
        });
        commitmentId = mockResult.commitmentId;
        txHash = `mock:commitment:${currentGoal.id}:${Date.now()}`;
        anchorChainId = Number.isFinite(sessionChainId)
          ? sessionChainId
          : BASE_MAINNET_CHAIN_ID;
      }

      const commitmentCreatedAt = new Date().toISOString();

      const { data: updatedGoal, error: updateError } = await supabase
        .from("goals")
        .update({
          commitment_id: commitmentId,
          commitment_tx_hash: txHash,
          commitment_chain_id: anchorChainId,
          commitment_created_at: commitmentCreatedAt,
        })
        .eq("id", currentGoal.id)
        .select("*")
        .single();

      if (updateError || !updatedGoal) {
        if (isRealTxHash(txHash)) {
          throw new Error(
            toPostTxPersistenceError({
              action: "goal commitment anchor",
              txHash,
            })
          );
        }
        throw new Error(updateError?.message ?? "Failed to persist commitment anchor.");
      }

      setGoal(updatedGoal as Goal);
      setEditForm(toEditForm(updatedGoal as Goal));
      return { goal: updatedGoal as Goal, created: true };
    },
    [
      activeChainId,
      connectedAddress,
      publicClient,
      sessionChainId,
      walletAddress,
      walletClient,
    ]
  );

  const loadGoal = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    const { data, error: goalError } = await supabase
      .from("goals")
      .select("*")
      .eq("id", id)
      .single();

    if (goalError) {
      setError(goalError.message);
      setGoal(null);
      setCheckIns([]);
      setLoading(false);
      return;
    }

    setGoal(data);
    setEditForm(toEditForm(data));

    const { count, error: pledgeError } = await supabase
      .from("pledges")
      .select("id", { count: "exact", head: true })
      .eq("goal_id", id);

    if (pledgeError) {
      setPledgeCount(0);
    } else {
      setPledgeCount(count ?? 0);
    }

    setCheckInError(null);
    let checkInRows:
      | Array<Omit<CheckIn, "image_url">>
      | null = null;
    let checkInQueryError: { message: string } | null = null;

    const checkInsWithImagePath = await supabase
      .from("check_ins")
      .select(
        "id,check_in_at,note,progress_value,progress_snapshot_value,progress_unit,proof_hash,image_path,onchain_commitment_id,onchain_tx_hash,onchain_chain_id,onchain_submitted_at,created_at"
      )
      .eq("goal_id", id)
      .order("check_in_at", { ascending: false });

    if (
      checkInsWithImagePath.error &&
      (isMissingCheckInImagePathColumnError(checkInsWithImagePath.error.message) ||
        isMissingCheckInOnchainColumnsError(checkInsWithImagePath.error.message) ||
        isMissingCheckInProgressColumnsError(checkInsWithImagePath.error.message))
    ) {
      const legacyCheckIns = await supabase
        .from("check_ins")
        .select("id,check_in_at,note,proof_hash,created_at")
        .eq("goal_id", id)
        .order("check_in_at", { ascending: false });

      if (legacyCheckIns.error) {
        checkInQueryError = legacyCheckIns.error;
      } else {
        checkInRows = (legacyCheckIns.data ?? []).map((row) => ({
          ...row,
          progress_value: 1,
          progress_snapshot_value: null,
          progress_unit: null,
          image_path: null,
          onchain_commitment_id: null,
          onchain_tx_hash: null,
          onchain_chain_id: null,
          onchain_submitted_at: null,
        }));
      }
    } else if (checkInsWithImagePath.error) {
      checkInQueryError = checkInsWithImagePath.error;
    } else {
      checkInRows = checkInsWithImagePath.data ?? [];
    }

    if (checkInQueryError) {
      setCheckInError(checkInQueryError.message);
      setCheckIns([]);
    } else {
      const signedCheckIns = await Promise.all(
        (checkInRows ?? []).map(async (checkIn) => {
          if (!checkIn.image_path) {
            return {
              ...checkIn,
              image_url: null,
            };
          }

          const { data: signedData, error: signedError } = await supabase.storage
            .from(CHECK_IN_IMAGES_BUCKET)
            .createSignedUrl(checkIn.image_path, 60 * 60);

          if (signedError || !signedData?.signedUrl) {
            return {
              ...checkIn,
              image_url: null,
            };
          }

          return {
            ...checkIn,
            image_url: signedData.signedUrl,
          };
        })
      );
      setCheckIns(signedCheckIns);
    }

    const { data: nftData, error: nftError } = await supabase
      .from("completion_nfts")
      .select("id,token_id,tx_hash,status,created_at")
      .eq("goal_id", id)
      .maybeSingle();

    if (nftError) {
      setNftError(nftError.message);
      setCompletionNft(null);
    } else {
      setCompletionNft(nftData ?? null);
    }

    setLoading(false);
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

  const handleCheckIn = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    setSubmitMessage(null);
    setSubmittingCheckIn(true);

    if (!session?.user?.id) {
      setSubmitError("Sign in to add a check-in.");
      setSubmittingCheckIn(false);
      return;
    }

    if (!goalId) {
      setSubmitError("Missing goal id.");
      setSubmittingCheckIn(false);
      return;
    }

    const checkInTimestamp = new Date().toISOString();
    const normalizedNote = note.trim() || null;
    let uploadedImagePath: string | null = null;
    let imageColumnUnavailable = false;
    let onchainColumnsUnavailable = false;
    let progressColumnsUnavailable = false;
    let onchainAnchored = false;
    let anchorCreatedForLegacyPublicGoal = false;
    let activeGoal = goal;

    if (!activeGoal) {
      setSubmitError("Goal context is unavailable.");
      setSubmittingCheckIn(false);
      return;
    }

    const isActiveDurationGoal =
      activeGoal.goal_type === "duration" || activeGoal.model_type === "time";
    const isActiveWeightSnapshotGoal = isWeightSnapshotPreset(
      activeGoal.count_unit_preset
    );
    const parsedProgressValue = isActiveWeightSnapshotGoal
      ? parseNonNegativeDecimal(checkInValueInput)
      : parsePositiveInteger(checkInValueInput);

    if (parsedProgressValue === null) {
      setSubmitError(
        isActiveWeightSnapshotGoal
          ? "Enter your current weight (0 or greater, up to 2 decimals)."
          : "Enter a whole number greater than 0 for this check-in."
      );
      setSubmittingCheckIn(false);
      return;
    }

    if (activeGoal.privacy === "public" && !activeGoal.commitment_id) {
      try {
        const anchorResult = await ensureGoalCommitmentAnchor(activeGoal);
        activeGoal = anchorResult.goal;
        anchorCreatedForLegacyPublicGoal = anchorResult.created;
      } catch (anchorError) {
        setSubmitError(
          toWalletActionError({
            error: anchorError,
            fallback: "Failed to create commitment anchor for this public goal.",
            userRejected: "Commitment anchor transaction was canceled in wallet.",
          })
        );
        setSubmittingCheckIn(false);
        return;
      }
    }

    if (checkInImageFile) {
      if (!checkInImageFile.type.startsWith("image/")) {
        setSubmitError("Attachment must be an image file.");
        setSubmittingCheckIn(false);
        return;
      }

      if (checkInImageFile.size > MAX_CHECK_IN_IMAGE_BYTES) {
        setSubmitError("Image must be 8MB or smaller.");
        setSubmittingCheckIn(false);
        return;
      }

      uploadedImagePath = buildCheckInImagePath(
        session.user.id,
        goalId,
        checkInImageFile
      );

      const { error: uploadError } = await supabase.storage
        .from(CHECK_IN_IMAGES_BUCKET)
        .upload(uploadedImagePath, checkInImageFile, {
          contentType: checkInImageFile.type,
          upsert: false,
        });

      if (uploadError) {
        setSubmitError(uploadError.message);
        setSubmittingCheckIn(false);
        return;
      }
    }

    let imageDigest: string | null = null;
    if (checkInImageFile) {
      try {
        const imageBytes = new Uint8Array(await checkInImageFile.arrayBuffer());
        imageDigest = keccak256(imageBytes);
      } catch {
        setSubmitError("Failed to hash attached image.");
        setSubmittingCheckIn(false);
        return;
      }
    }

    const generatedProofHash =
      activeGoal.privacy === "public" && activeGoal.commitment_id
        ? keccak256(
            toBytes(
              JSON.stringify({
                version: 1,
                goalId,
                userId: session.user.id,
                commitmentId: activeGoal.commitment_id,
                checkInTimestamp,
                progressValue: isActiveWeightSnapshotGoal ? 1 : parsedProgressValue,
                progressSnapshotValue: isActiveWeightSnapshotGoal
                  ? parsedProgressValue
                  : null,
                note: normalizedNote,
                imageDigest,
              })
            )
          )
        : null;

    let onchainCommitmentId: string | null = null;
    let onchainTxHash: string | null = null;
    let onchainChainId: number | null = null;
    let onchainSubmittedAt: string | null = null;

    if (activeGoal.privacy === "public" && activeGoal.commitment_id && generatedProofHash) {
      try {
        const accountAddress = (walletClient?.account?.address ??
          connectedAddress ??
          walletAddress) as Address | undefined;

        if (HAS_HABIT_REGISTRY_ADDRESS_CONFIG) {
          if (!HABIT_REGISTRY_ADDRESS) {
            throw new Error("Invalid NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS.");
          }
          if (!walletClient || !publicClient || !accountAddress) {
            throw new Error("Wallet client unavailable for on-chain check-in anchoring.");
          }
          if (activeChainId !== BASE_MAINNET_CHAIN_ID) {
            throw new Error("Switch wallet network to Base mainnet to anchor check-ins.");
          }

          let commitmentIdBigInt: bigint;
          try {
            commitmentIdBigInt = BigInt(activeGoal.commitment_id);
          } catch {
            throw new Error("Goal commitment id is invalid for on-chain check-in.");
          }

          const simulation = await publicClient.simulateContract({
            account: accountAddress,
            address: HABIT_REGISTRY_ADDRESS,
            abi: habitRegistryAbi,
            functionName: "checkIn",
            args: [
              commitmentIdBigInt,
              generatedProofHash as Hex,
              toUnixSeconds(checkInTimestamp),
            ],
            chain: base,
          });

          const realTxHash = await walletClient.writeContract(simulation.request);
          await publicClient.waitForTransactionReceipt({ hash: realTxHash });

          onchainCommitmentId = activeGoal.commitment_id;
          onchainTxHash = realTxHash;
          onchainChainId = BASE_MAINNET_CHAIN_ID;
        } else {
          await mockHabitRegistry.checkIn({
            commitmentId: activeGoal.commitment_id,
            proofHash: generatedProofHash,
            timestamp: toUnixSeconds(checkInTimestamp),
          });

          onchainCommitmentId = activeGoal.commitment_id;
          onchainTxHash = `mock:checkin:${activeGoal.id}:${Date.now()}`;
          onchainChainId =
            activeGoal.commitment_chain_id ??
            (Number.isFinite(sessionChainId) ? sessionChainId : BASE_MAINNET_CHAIN_ID);
        }
        onchainSubmittedAt = checkInTimestamp;
        onchainAnchored = true;
      } catch (onchainError) {
        if (uploadedImagePath) {
          await supabase.storage.from(CHECK_IN_IMAGES_BUCKET).remove([uploadedImagePath]);
        }
        setSubmitError(
          toWalletActionError({
            error: onchainError,
            fallback: "Failed to submit on-chain check-in proof.",
            userRejected: "Check-in transaction was canceled in wallet.",
          })
        );
        setSubmittingCheckIn(false);
        return;
      }
    }

    const basePayload = {
      goal_id: goalId,
      user_id: session.user.id,
      check_in_at: checkInTimestamp,
      progress_value: isActiveWeightSnapshotGoal ? 1 : parsedProgressValue,
      progress_snapshot_value: isActiveWeightSnapshotGoal ? parsedProgressValue : null,
      progress_unit:
        isActiveDurationGoal && activeGoal.target_unit === "hours"
          ? "hours"
          : isActiveDurationGoal
            ? "minutes"
            : "count",
      note: normalizedNote,
      proof_hash: generatedProofHash,
    };

    let includeImagePathColumn = Boolean(uploadedImagePath);
    let includeOnchainColumns = true;
    let includeProgressColumns = true;

    const insertCheckIn = async () =>
      supabase.from("check_ins").insert({
        ...(!includeProgressColumns
          ? {
              goal_id: basePayload.goal_id,
              user_id: basePayload.user_id,
              check_in_at: basePayload.check_in_at,
              note: basePayload.note,
              proof_hash: basePayload.proof_hash,
            }
          : basePayload),
        ...(includeImagePathColumn && uploadedImagePath
          ? { image_path: uploadedImagePath }
          : {}),
        ...(includeOnchainColumns
          ? {
              onchain_commitment_id: onchainCommitmentId,
              onchain_tx_hash: onchainTxHash,
              onchain_chain_id: onchainChainId,
              onchain_submitted_at: onchainSubmittedAt,
            }
          : {}),
      });

    let { error: insertError } = await insertCheckIn();

    while (insertError) {
      if (includeProgressColumns && isMissingCheckInProgressColumnsError(insertError.message)) {
        includeProgressColumns = false;
        progressColumnsUnavailable = true;
        ({ error: insertError } = await insertCheckIn());
        continue;
      }

      if (includeOnchainColumns && isMissingCheckInOnchainColumnsError(insertError.message)) {
        includeOnchainColumns = false;
        onchainColumnsUnavailable = true;
        ({ error: insertError } = await insertCheckIn());
        continue;
      }

      if (includeImagePathColumn && isMissingCheckInImagePathColumnError(insertError.message)) {
        includeImagePathColumn = false;
        imageColumnUnavailable = true;
        if (uploadedImagePath) {
          await supabase.storage.from(CHECK_IN_IMAGES_BUCKET).remove([uploadedImagePath]);
          uploadedImagePath = null;
        }
        ({ error: insertError } = await insertCheckIn());
        continue;
      }

      break;
    }

    if (insertError) {
      if (uploadedImagePath) {
        await supabase.storage.from(CHECK_IN_IMAGES_BUCKET).remove([uploadedImagePath]);
      }
      if (insertError.message.includes("check_ins_progress_unit_valid")) {
        setSubmitError(
          "Database schema is out of date for hour-based check-ins. Apply the latest supabase/schema.sql, then try again."
        );
      } else if (onchainAnchored && onchainTxHash && isRealTxHash(onchainTxHash)) {
        setSubmitError(
          toPostTxPersistenceError({
            action: "check-in record",
            txHash: onchainTxHash,
          })
        );
      } else {
        setSubmitError(insertError.message);
      }
      setSubmittingCheckIn(false);
      return;
    }

    if (goal) {
      const { error: eventError } = await logEvent({
        eventType: "check_in.created",
        actorId: session.user.id,
        recipientId: activeGoal.user_id,
        goalId: activeGoal.id,
        data: {
          noteLength: normalizedNote?.length ?? 0,
          hasImage: Boolean(checkInImageFile),
          onchainAnchored,
          progressValue: isActiveWeightSnapshotGoal ? 1 : parsedProgressValue,
          progressSnapshotValue: isActiveWeightSnapshotGoal
            ? parsedProgressValue
            : null,
        },
      });

      if (eventError) {
        console.warn("Failed to log check_in.created event", eventError);
      }
    }

    setNote("");
    setCheckInValueInput(
      isActiveWeightSnapshotGoal ? "" : isActiveDurationGoal ? "30" : "1"
    );
    clearCheckInImageSelection();
    const submitMessages = ["Check-in saved."];

    if (anchorCreatedForLegacyPublicGoal) {
      submitMessages.push("Commitment anchor was created for this public goal.");
    }

    if (onchainAnchored) {
      submitMessages.push("Check-in was anchored on-chain.");
    }

    if (onchainColumnsUnavailable) {
      submitMessages.push("Apply latest DB schema to persist on-chain check-in metadata.");
    }

    if (progressColumnsUnavailable) {
      submitMessages.push("Apply latest DB schema to persist quantitative check-in progress.");
    }

    if (imageColumnUnavailable) {
      submitMessages.push("Image attachment requires the latest database schema.");
    }

    setSubmitMessage(submitMessages.join(" "));
    if (goalId) {
      await loadGoal(goalId);
    }
    setSubmittingCheckIn(false);
  };

  const handleTogglePrivacy = async () => {
    if (!goal || !session?.user?.id) return;
    const nextPrivacy = goal.privacy === "public" ? "private" : "public";

    if (nextPrivacy === "public") {
      const ok = window.confirm(
        "Make this goal public so others can view and sponsor it?\n\nWhile public, edits are locked. If there are no pledges yet, you can make it private to edit or delete. Once any pledge exists, only completion updates are allowed."
      );
      if (!ok) return;
    }

    setPrivacyUpdating(true);
    setPrivacyError(null);
    setPrivacyMessage(null);

    let activeGoal = goal;
    let commitmentCreated = false;

    if (nextPrivacy === "public" && !goal.commitment_id) {
      try {
        const anchorResult = await ensureGoalCommitmentAnchor(goal);
        activeGoal = anchorResult.goal;
        commitmentCreated = anchorResult.created;
      } catch (anchorError) {
        setPrivacyError(
          toWalletActionError({
            error: anchorError,
            fallback: "Failed to create commitment anchor.",
            userRejected: "Commitment anchor transaction was canceled in wallet.",
          })
        );
        setPrivacyUpdating(false);
        return;
      }
    }

    const { data, error: updateError } = await supabase
      .from("goals")
      .update({ privacy: nextPrivacy })
      .eq("id", activeGoal.id)
      .select("*")
      .single();

    if (updateError) {
      if (updateError.message.toLowerCase().includes("pledge")) {
        setPrivacyError(
          "This goal has sponsorship pledges and can’t be edited or made private. You can still mark it complete."
        );
      } else if (updateError.message.toLowerCase().includes("public goals cannot be edited")) {
        setPrivacyError(
          "Public goals can’t be edited. Make it private first if you need to change details."
        );
      } else {
        setPrivacyError(updateError.message);
      }
      setPrivacyUpdating(false);
      return;
    }

    setGoal(data);
    setEditForm(toEditForm(data));
    setPrivacyMessage(
      nextPrivacy === "public"
        ? commitmentCreated
          ? "Goal is now public and commitment anchor was created."
          : "Goal is now public."
        : "Goal is now private."
    );
    setPrivacyUpdating(false);
  };

  const handleMarkComplete = async () => {
    if (!goal || !session?.user?.id) return;
    if (goal.status === "completed") return;

    setCompletionWarning(null);
    if (!canMarkComplete) {
      setCompletionError(null);
      setCompletionMessage(null);
      setCompletionWarning(
        "Complete this goal through check-ins first. Reach 100% progress before marking it complete."
      );
      return;
    }

    const ok = window.confirm("Mark this goal as complete?");
    if (!ok) return;

    setCompletionUpdating(true);
    setCompletionError(null);
    setCompletionMessage(null);

    const accountAddress = (walletClient?.account?.address ??
      connectedAddress ??
      walletAddress) as Address | undefined;
    let completionRecordedOnchain = false;
    let completionAlreadyRecordedOnchain = false;
    let completionTxHash: Hex | null = null;

    if (goal.privacy === "public" && HAS_HABIT_REGISTRY_ADDRESS_CONFIG) {
      if (!goal.commitment_id) {
        setCompletionError(
          "Public goal is missing an on-chain commitment anchor and cannot be completed yet."
        );
        setCompletionUpdating(false);
        return;
      }
      if (!HABIT_REGISTRY_ADDRESS) {
        setCompletionError("Invalid NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS.");
        setCompletionUpdating(false);
        return;
      }
      if (!walletClient || !publicClient || !accountAddress) {
        setCompletionError("Wallet client unavailable for on-chain completion.");
        setCompletionUpdating(false);
        return;
      }
      if (activeChainId !== BASE_MAINNET_CHAIN_ID) {
        setCompletionError("Switch wallet network to Base mainnet to complete this goal.");
        setCompletionUpdating(false);
        return;
      }

      let commitmentIdBigInt: bigint;
      try {
        commitmentIdBigInt = BigInt(goal.commitment_id);
      } catch {
        setCompletionError("Goal commitment id is invalid for on-chain completion.");
        setCompletionUpdating(false);
        return;
      }

      try {
        const simulation = await publicClient.simulateContract({
          account: accountAddress,
          address: HABIT_REGISTRY_ADDRESS,
          abi: habitRegistryAbi,
          functionName: "markCommitmentCompleted",
          args: [commitmentIdBigInt],
          chain: base,
        });
        const completionTx = await walletClient.writeContract(simulation.request);
        await publicClient.waitForTransactionReceipt({ hash: completionTx });
        completionTxHash = completionTx;
        completionRecordedOnchain = true;
      } catch (completionError) {
        const completionErrorMessage =
          completionError instanceof Error ? completionError.message : "Unknown error";
        if (completionErrorMessage.toLowerCase().includes("commitmentalreadycompleted")) {
          completionAlreadyRecordedOnchain = true;
        } else {
          setCompletionError(
            toWalletActionError({
              error: completionError,
              fallback: "Failed to mark on-chain commitment as completed.",
              userRejected: "Completion transaction was canceled in wallet.",
            })
          );
          setCompletionUpdating(false);
          return;
        }
      }
    }

    const completedAt = new Date().toISOString();
    let { data, error: updateError } = await supabase
      .from("goals")
      .update({
        status: "completed",
        completed_at: completedAt,
      })
      .eq("id", goal.id)
      .select("*")
      .single();

    if (updateError && isMissingCompletedAtColumnError(updateError.message)) {
      const fallback = await supabase
        .from("goals")
        .update({ status: "completed" })
        .eq("id", goal.id)
        .select("*")
        .single();
      data = fallback.data;
      updateError = fallback.error;
    }

    if (updateError) {
      if (completionTxHash && isRealTxHash(completionTxHash)) {
        setCompletionError(
          toPostTxPersistenceError({
            action: "goal completion status",
            txHash: completionTxHash,
          })
        );
      } else {
        setCompletionError(updateError.message);
      }
      setCompletionUpdating(false);
      return;
    }

    const nextGoal = {
      ...data,
      completed_at: (data as Goal).completed_at ?? completedAt,
    } as Goal;
    setGoal(nextGoal);
    setEditForm(toEditForm(nextGoal));
    setCompletionMessage(
      completionRecordedOnchain
        ? "Goal marked complete. On-chain completion recorded."
        : completionAlreadyRecordedOnchain
          ? "Goal marked complete. On-chain completion was already recorded."
          : "Goal marked complete."
    );
    setCompletionUpdating(false);
  };

  const handleMintNft = async () => {
    if (!goal || !session?.user?.id) return;
    if (goal.status !== "completed") {
      setNftError("Complete the goal before minting.");
      return;
    }

    if (completionNft) {
      setNftMessage("Completion NFT already minted.");
      return;
    }

    setNftError(null);
    setNftMessage(null);
    setNftMinting(true);

    const { tokenId, txHash } = await mockCompletionNft.mint();

    const { data, error: mintError } = await supabase
      .from("completion_nfts")
      .insert({
        goal_id: goal.id,
        user_id: session.user.id,
        token_id: tokenId,
        tx_hash: txHash,
        status: "minted",
      })
      .select("id,token_id,tx_hash,status,created_at")
      .single();

    if (mintError) {
      setNftError(mintError.message);
      setNftMinting(false);
      return;
    }

    setCompletionNft(data);
    setNftMessage("Completion NFT minted.");
    setNftMinting(false);
  };

  const handleDeleteGoal = async () => {
    setDeleteError(null);

    if (!goal || !session?.user?.id) {
      setDeleteError("Sign in to delete this goal.");
      return;
    }

    if (goal.privacy !== "private") {
      setDeleteError("Make this goal private before deleting.");
      return;
    }

    if (pledgeCount > 0) {
      setDeleteError("This goal has pledges and can’t be deleted.");
      return;
    }

    const confirmed = window.confirm(
      `Delete "${goal.title}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    setDeleteUpdating(true);

    const { error: goalDeleteError } = await supabase
      .from("goals")
      .delete()
      .eq("id", goal.id)
      .eq("user_id", session.user.id);

    if (goalDeleteError) {
      setDeleteError(goalDeleteError.message);
      setDeleteUpdating(false);
      return;
    }

    const { error: eventError } = await logEvent({
      eventType: "goal.deleted",
      actorId: session.user.id,
      recipientId: session.user.id,
      goalId: goal.id,
      data: {
        title: goal.title,
      },
    });

    if (eventError) {
      console.warn("Failed to log goal.deleted event", eventError);
    }

    router.push("/");
    router.refresh();
  };

  const handleUpdateGoal = async (event: FormEvent) => {
    event.preventDefault();
    setEditError(null);
    setEditMessage(null);

    if (!goal || !session?.user?.id) return;

    if (goal.privacy !== "private") {
      setEditError("Make this goal private to edit its details.");
      return;
    }

    if (pledgeCount > 0) {
      setEditError("This goal has pledges and can’t be edited.");
      return;
    }

    if (!editForm.title.trim()) {
      setEditError("Goal title is required.");
      return;
    }

    if (!editForm.deadline) {
      setEditError("Deadline is required.");
      return;
    }

    if (editForm.hasStartDate && !editForm.startDate) {
      setEditError("Start date is required when enabled.");
      return;
    }

    if (isSchemaTrackingGoal && !editForm.startDate) {
      setEditError("Start date is required for this goal.");
      return;
    }

    if (isSchemaTrackingGoal && editForm.modelType !== goal.model_type) {
      setEditError(
        "This goal uses the new tracking schema. Changing model type is not supported in this editor yet."
      );
      return;
    }

    const requiresTarget = editForm.modelType !== "milestone";
    const targetValueNumber = requiresTarget
      ? parsePositiveInteger(editForm.targetValue)
      : null;

    if (requiresTarget && targetValueNumber === null) {
      setEditError(
        isWeightSnapshotGoal
          ? "Goal weight must be a whole number greater than 0."
          : "Target must be a whole number greater than 0."
      );
      return;
    }

    const schemaTotalTargetValue =
      isSchemaTrackingGoal && requiresTarget && targetValueNumber !== null
        ? calculateTotalTargetValue({
            cadence: goal.cadence,
            cadenceTargetValue: targetValueNumber,
            startDate: editForm.startDate,
            deadlineDate: editForm.deadline,
          })
        : targetValueNumber;

    if (isSchemaTrackingGoal && requiresTarget && schemaTotalTargetValue === null) {
      setEditError("Start date must be on or before the deadline.");
      return;
    }

    const nextTargetUnit = requiresTarget
      ? isSchemaTrackingGoal
        ? goal.target_unit ?? null
        : editForm.targetUnit.trim() || null
      : null;

    const startISO =
      (isSchemaTrackingGoal || editForm.hasStartDate) && editForm.startDate
        ? new Date(`${editForm.startDate}T00:00:00`).toISOString()
        : null;
    const deadlineISO = new Date(
      `${editForm.deadline}T00:00:00`
    ).toISOString();

    setEditUpdating(true);

    const legacyPayload = {
      title: editForm.title.trim(),
      start_at: startISO,
      deadline_at: deadlineISO,
      model_type: isSchemaTrackingGoal ? goal.model_type : editForm.modelType,
      target_value:
        requiresTarget && targetValueNumber !== null
          ? isSchemaTrackingGoal && !isWeightSnapshotGoal
            ? schemaTotalTargetValue
            : targetValueNumber
          : null,
      target_unit: nextTargetUnit,
    };

    const trackingPatch =
      isSchemaTrackingGoal &&
      requiresTarget &&
      targetValueNumber !== null &&
      schemaTotalTargetValue !== null
        ? {
            cadence_target_value: targetValueNumber,
            total_target_value: schemaTotalTargetValue,
          }
        : {};

    let { data, error: updateError } = await supabase
      .from("goals")
      .update({
        ...legacyPayload,
        ...trackingPatch,
      })
      .eq("id", goal.id)
      .select("*")
      .single();

    if (updateError && isMissingGoalTrackingColumnsError(updateError.message)) {
      ({ data, error: updateError } = await supabase
        .from("goals")
        .update(legacyPayload)
        .eq("id", goal.id)
        .select("*")
        .single());
    }

    if (updateError) {
      setEditError(updateError.message);
      setEditUpdating(false);
      return;
    }

    setGoal(data);
    setEditForm(toEditForm(data));
    setEditMessage("Goal updated.");
    setEditUpdating(false);
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
              Back to dashboard
            </Link>
          </div>
          <div className={styles.metaRow}>
            {walletAddress ? (
              <span className={styles.pill}>
                Wallet {`${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`}
              </span>
            ) : session?.user?.email ? (
              <span className={styles.pill}>{session.user.email}</span>
            ) : (
              <span className={styles.pill}>Sign in required</span>
            )}
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
                <span className={styles.pill}>{goal.privacy}</span>
                <span className={styles.pill}>{goal.status}</span>
                {pledgeCount > 0 ? (
                  <span className={`${styles.pill} ${styles.pillLock}`}>Pledge lock</span>
                ) : null}
                {goal.start_at ? (
                  <span className={styles.pill}>
                    Starts {new Date(goal.start_at).toLocaleDateString()}
                  </span>
                ) : null}
                {goal.completed_at ? (
                  <span className={styles.pill}>
                    Completed {new Date(goal.completed_at).toLocaleDateString()}
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
                {progressTargetValue && progressCurrentValue !== null ? (
                  <div className={styles.helperText}>
                    {isWeightSnapshotGoal
                      ? `Current weight: ${formatMetricValue(progressCurrentValue)}${
                          startSnapshotProgressValue !== null
                            ? ` (started ${formatMetricValue(startSnapshotProgressValue)})`
                            : ""
                        }`
                      : `Logged: ${progressCurrentValue} ${goalUnitLabel}`}
                  </div>
                ) : null}
                {!isWeightSnapshotGoal && cadenceRollupHint ? (
                  <div className={styles.helperText}>{cadenceRollupHint}</div>
                ) : null}
                <ProgressTrend
                  points={progressTrendPoints}
                  mode={isWeightSnapshotGoal ? "snapshot" : "cumulative"}
                  unitLabel={goalUnitLabel.toLowerCase()}
                />
              </div>
            </section>

            {isOwner ? (
              <section className={styles.card}>
                <div className={styles.sectionTitle}>Visibility</div>
                <div className={styles.visibilityRow}>
                  <div className={styles.visibilityText}>
                    <div className={styles.visibilityLabel}>
                      {goal.privacy === "public" ? "Public goal" : "Private goal"}
                    </div>
                    <div className={styles.visibilityHint}>
                      Public goals can receive comments and sponsorship.
                    </div>
                    {goal.commitment_id ? (
                      <div className={styles.visibilityHint}>
                        Commitment anchor #{goal.commitment_id}
                        {goal.commitment_tx_hash ? (
                          <>
                            {" · "}
                            {isRealTxHash(goal.commitment_tx_hash) ? (
                              <a
                                className={styles.inlineLink}
                                href={baseScanTxUrl(goal.commitment_tx_hash) as string}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View tx {shortHash(goal.commitment_tx_hash, 8, 6)}
                              </a>
                            ) : isMockTxRef(goal.commitment_tx_hash) ? (
                              <>Demo anchor (mock mode)</>
                            ) : (
                              <>Tx {shortHash(goal.commitment_tx_hash, 16, 8)}</>
                            )}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.buttonRow}>
                    <Link
                      href={`/goals/${goal.id}/offers`}
                      className={`${styles.buttonGhost} ${styles.linkButton}`}
                    >
                      Review offers
                    </Link>
                    {goal.privacy === "public" ? (
                      <Link
                        href={`/public/goals/${goal.id}`}
                        className={`${styles.buttonGhost} ${styles.linkButton}`}
                      >
                        View public page
                      </Link>
                    ) : null}
                    <button
                      className={styles.buttonPrimary}
                      type="button"
                      onClick={handleTogglePrivacy}
                      disabled={privacyUpdating}
                    >
                      {privacyUpdating
                        ? "Updating..."
                        : goal.privacy === "public"
                          ? "Make private"
                          : "Make public"}
                    </button>
                  </div>
                </div>
                {privacyError ? <div className={styles.message}>{privacyError}</div> : null}
                {privacyMessage ? (
                  <div className={`${styles.message} ${styles.success}`}>
                    {privacyMessage}
                  </div>
                ) : null}
                <div className={styles.notice}>
                  While public, goal details are locked. If no pledges exist, you can make the
                  goal private to edit or delete. Once any pledge exists, only completion updates
                  are allowed.
                </div>
              </section>
            ) : null}

            {isOwner ? (
              <section className={styles.card}>
                <div className={styles.sectionTitle}>Edit goal</div>
                {goal.privacy !== "private" ? (
                  <div className={styles.notice}>
                    Make this goal private to edit its details.
                  </div>
                ) : pledgeCount > 0 ? (
                  <div className={styles.notice}>
                    This goal has pledges and can’t be edited.
                  </div>
                ) : (
                  <form className={styles.form} onSubmit={handleUpdateGoal}>
                    {isSchemaTrackingGoal ? (
                      <div className={styles.notice}>
                        This goal uses the wizard tracking setup.
                      </div>
                    ) : null}
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="edit-title">
                        Goal title
                      </label>
                      <input
                        id="edit-title"
                        className={styles.input}
                        value={editForm.title}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                        placeholder="Run 12 miles by April"
                      />
                    </div>

                    <div className={styles.row}>
                      {isSchemaTrackingGoal || editForm.hasStartDate ? (
                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="edit-start">
                            Start date
                          </label>
                          <input
                            id="edit-start"
                            type="date"
                            className={styles.input}
                            value={editForm.startDate}
                            onChange={(event) =>
                              setEditForm((current) => ({
                                ...current,
                                startDate: event.target.value,
                              }))
                            }
                          />
                        </div>
                      ) : (
                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="edit-model">
                            Model
                          </label>
                          <select
                            id="edit-model"
                            className={styles.input}
                            value={editForm.modelType}
                            onChange={(event) =>
                              setEditForm((current) => ({
                                ...current,
                                modelType: event.target.value as GoalModelType,
                              }))
                            }
                          >
                            <option value="count">Count-based</option>
                            <option value="time">Time-based</option>
                            {editForm.modelType === "milestone" ? (
                              <option value="milestone" disabled>
                                Legacy milestone (read-only)
                              </option>
                            ) : null}
                          </select>
                        </div>
                      )}
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="edit-deadline">
                          <span className={styles.labelInline}>
                            Deadline
                            {!isSchemaTrackingGoal ? (
                              <span className={styles.checkboxInline}>
                                <input
                                  type="checkbox"
                                  className={styles.checkbox}
                                  checked={editForm.hasStartDate}
                                  onChange={(event) =>
                                    setEditForm((current) => ({
                                      ...current,
                                      hasStartDate: event.target.checked,
                                      startDate: event.target.checked
                                        ? current.startDate
                                        : "",
                                    }))
                                  }
                                />
                                Add start date
                              </span>
                            ) : null}
                          </span>
                        </label>
                        <input
                          id="edit-deadline"
                          type="date"
                          className={styles.input}
                          value={editForm.deadline}
                          onChange={(event) =>
                            setEditForm((current) => ({
                              ...current,
                              deadline: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>

                    {!isSchemaTrackingGoal && editForm.hasStartDate ? (
                      <div className={styles.row}>
                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="edit-model">
                            Model
                          </label>
                          <select
                            id="edit-model"
                            className={styles.input}
                            value={editForm.modelType}
                            onChange={(event) =>
                              setEditForm((current) => ({
                                ...current,
                                modelType: event.target.value as GoalModelType,
                              }))
                            }
                          >
                            <option value="count">Count-based</option>
                            <option value="time">Time-based</option>
                            {editForm.modelType === "milestone" ? (
                              <option value="milestone" disabled>
                                Legacy milestone (read-only)
                              </option>
                            ) : null}
                          </select>
                        </div>
                      </div>
                    ) : null}

                    {isSchemaTrackingGoal ? (
                      <>
                        {isWeightSnapshotGoal ? (
                          <div className={styles.row}>
                            <div className={styles.field}>
                              <label className={styles.label}>Current weight</label>
                              <input
                                className={styles.input}
                                value={
                                  goal.start_snapshot_value !== null
                                    ? formatMetricValue(goal.start_snapshot_value)
                                    : ""
                                }
                                placeholder="Not set"
                                disabled
                              />
                              <div className={styles.helperText}>
                                Baseline from setup used for weight progress math.
                              </div>
                            </div>
                            <div className={styles.field}>
                              <label className={styles.label} htmlFor="edit-target-value">
                                Goal weight
                              </label>
                              <input
                                id="edit-target-value"
                                type="number"
                                min={1}
                                step={1}
                                className={styles.input}
                                value={editForm.targetValue}
                                onChange={(event) =>
                                  setEditForm((current) => ({
                                    ...current,
                                    targetValue: event.target.value,
                                  }))
                                }
                                placeholder="170"
                              />
                              <div className={styles.helperText}>
                                {schemaTargetHelper}
                                {!isWeightSnapshotGoal && cadenceRollupHint
                                  ? ` ${cadenceRollupHint}`
                                  : ""}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className={styles.row}>
                            <div className={styles.field}>
                              <label className={styles.label} htmlFor="edit-target-value">
                                {schemaTargetLabel}
                              </label>
                              <input
                                id="edit-target-value"
                                type="number"
                                min={1}
                                step={1}
                                className={styles.input}
                                value={editForm.targetValue}
                                onChange={(event) =>
                                  setEditForm((current) => ({
                                    ...current,
                                    targetValue: event.target.value,
                                  }))
                                }
                                placeholder={goal.cadence === "by_deadline" ? "30" : "5"}
                              />
                              <div className={styles.helperText}>
                                {schemaTargetHelper}
                                {!isWeightSnapshotGoal && cadenceRollupHint
                                  ? ` ${cadenceRollupHint}`
                                  : ""}
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className={styles.row}>
                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="edit-target-value">
                            Goal value
                          </label>
                          <input
                            id="edit-target-value"
                            type="number"
                            className={styles.input}
                            value={editForm.targetValue}
                            onChange={(event) =>
                              setEditForm((current) => ({
                                ...current,
                                targetValue: event.target.value,
                              }))
                            }
                            placeholder="12"
                          />
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label} htmlFor="edit-target-unit">
                            Goal unit
                          </label>
                          <input
                            id="edit-target-unit"
                            className={styles.input}
                            value={editForm.targetUnit}
                            onChange={(event) =>
                              setEditForm((current) => ({
                                ...current,
                                targetUnit: event.target.value,
                              }))
                            }
                            placeholder="miles"
                          />
                        </div>
                      </div>
                    )}

                    {editError ? <div className={styles.message}>{editError}</div> : null}
                    {editMessage ? (
                      <div className={`${styles.message} ${styles.success}`}>
                        {editMessage}
                      </div>
                    ) : null}
                    <div className={styles.buttonRow}>
                      <button className={styles.buttonPrimary} type="submit" disabled={editUpdating}>
                        {editUpdating ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                  </form>
                )}
              </section>
            ) : null}

            {isOwner ? (
              <section className={styles.card}>
                <div className={styles.sectionTitle}>Completion</div>
                {goal.status === "completed" ? (
                  <div className={styles.notice}>
                    Goal completed{goal.completed_at
                      ? ` on ${new Date(goal.completed_at).toLocaleDateString()}`
                      : ""}.
                  </div>
                ) : (
                  <>
                    <div className={styles.notice}>
                      Mark the goal complete to start the sponsor approval window.
                    </div>
                    <div className={styles.buttonRow}>
                      <button
                        className={styles.buttonPrimary}
                        type="button"
                        onClick={handleMarkComplete}
                        disabled={completionUpdating}
                      >
                        {completionUpdating ? "Updating..." : "Mark goal complete"}
                      </button>
                    </div>
                  </>
                )}
                {completionWarning ? (
                  <div className={styles.warningBox}>{completionWarning}</div>
                ) : null}
                {completionError ? (
                  <div className={styles.message}>{completionError}</div>
                ) : null}
                {completionMessage ? (
                  <div className={`${styles.message} ${styles.success}`}>
                    {completionMessage}
                  </div>
                ) : null}
              </section>
            ) : null}

            {isOwner ? (
              <section className={styles.card}>
                <div className={styles.sectionTitle}>Completion NFT</div>
                {goal.status !== "completed" ? (
                  <div className={styles.notice}>
                    Finish the goal to mint a completion NFT (optional).
                  </div>
                ) : completionNft ? (
                  <div className={styles.notice}>
                    NFT minted. Token #{completionNft.token_id ?? "—"} · Tx{" "}
                    {completionNft.tx_hash
                      ? `${completionNft.tx_hash.slice(0, 10)}…${completionNft.tx_hash.slice(-6)}`
                      : "—"}
                  </div>
                ) : (
                  <>
                    <div className={styles.notice}>
                      Mint a completion NFT to commemorate this goal (mocked for now).
                    </div>
                    <div className={styles.buttonRow}>
                      <button
                        className={styles.buttonPrimary}
                        type="button"
                        onClick={handleMintNft}
                        disabled={nftMinting}
                      >
                        {nftMinting ? "Minting..." : "Mint completion NFT"}
                      </button>
                    </div>
                  </>
                )}
                {nftError ? <div className={styles.message}>{nftError}</div> : null}
                {nftMessage ? (
                  <div className={`${styles.message} ${styles.success}`}>{nftMessage}</div>
                ) : null}
              </section>
            ) : null}

            <section className={styles.card}>
              <div className={styles.sectionTitle}>Add check-in</div>
              <form className={styles.form} onSubmit={handleCheckIn}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="checkin-value">
                    {isWeightSnapshotGoal
                      ? "Current weight"
                      : isDurationGoal
                        ? durationTrackingUnit === "hours"
                          ? "Hours logged"
                          : "Minutes logged"
                        : `Quantity (${goalUnitLabel})`}
                  </label>
                  <input
                    id="checkin-value"
                    type="number"
                    min={isWeightSnapshotGoal ? 0 : 1}
                    step={isWeightSnapshotGoal ? 0.1 : 1}
                    className={styles.input}
                    value={checkInValueInput}
                    onChange={(event) => setCheckInValueInput(event.target.value)}
                    placeholder={
                      isWeightSnapshotGoal
                        ? "e.g. 182.4"
                        : isDurationGoal
                          ? durationTrackingUnit === "hours"
                            ? "e.g. 1"
                            : "e.g. 30"
                          : "e.g. 1"
                    }
                    disabled={submittingCheckIn}
                  />
                  {isWeightSnapshotGoal ? (
                    <div className={styles.helperText}>
                      Enter your current weight. Progress compares your latest weight to your goal
                      weight.
                    </div>
                  ) : (
                    <div className={styles.helperText}>
                      Log the amount completed in this check-in.
                    </div>
                  )}
                  {isDurationGoal && !isWeightSnapshotGoal ? (
                    <div className={styles.buttonRow}>
                      {(durationTrackingUnit === "hours"
                        ? [1, 2, 3, 4]
                        : [15, 30, 45, 60]
                      ).map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={styles.quickValueButton}
                          onClick={() => setCheckInValueInput(String(value))}
                          disabled={submittingCheckIn}
                        >
                          {durationTrackingUnit === "hours" ? `${value}h` : `${value}m`}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="checkin-note">
                    Note (optional)
                  </label>
                  <textarea
                    id="checkin-note"
                    className={styles.textarea}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="What moved you forward today?"
                  />
                </div>
                {goal?.privacy === "public" ? (
                  <div className={styles.helperText}>
                    {HAS_HABIT_REGISTRY_ADDRESS_CONFIG
                      ? "Public goal check-ins are automatically hashed and anchored on Base."
                      : "Demo mode: check-ins are auto-hashed and locally mocked until HabitRegistry address is configured."}
                  </div>
                ) : null}
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="checkin-image">
                    Image (optional)
                  </label>
                  <input
                    ref={checkInImageInputRef}
                    id="checkin-image"
                    className={styles.input}
                    type="file"
                    accept="image/*"
                    onChange={handleCheckInImageChange}
                    disabled={submittingCheckIn}
                  />
                  <div className={styles.helperText}>
                    Upload a progress photo (max 8MB).
                  </div>
                  {checkInImagePreviewUrl ? (
                    <div className={styles.imagePreviewWrap}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={checkInImagePreviewUrl}
                        alt="Selected check-in attachment preview"
                        className={styles.imagePreview}
                      />
                      <button
                        className={styles.buttonGhost}
                        type="button"
                        onClick={clearCheckInImageSelection}
                      >
                        Remove image
                      </button>
                    </div>
                  ) : null}
                </div>
                {submitError ? <div className={styles.message}>{submitError}</div> : null}
                {submitMessage ? (
                  <div className={`${styles.message} ${styles.success}`}>{submitMessage}</div>
                ) : null}
                <div className={styles.buttonRow}>
                  <button
                    className={styles.buttonPrimary}
                    type="submit"
                    disabled={submittingCheckIn}
                  >
                    {submittingCheckIn ? "Saving..." : "Save check-in"}
                  </button>
                </div>
              </form>
            </section>

            <section className={styles.card}>
              <div className={styles.sectionTitle}>Recent check-ins</div>
              {checkInError ? <div className={styles.message}>{checkInError}</div> : null}
              {checkIns.length === 0 ? (
                <div className={styles.empty}>No check-ins yet.</div>
              ) : (
                <div className={styles.list}>
                  {checkIns.map((checkIn) => (
                    <div key={checkIn.id} className={styles.listItem}>
                      <div className={styles.listMeta}>
                        {new Date(checkIn.check_in_at).toLocaleString()}
                      </div>
                      <div>{checkIn.note || "No note"}</div>
                      {checkIn.progress_snapshot_value !== null ? (
                        <div className={styles.listMeta}>
                          Current weight: {formatMetricValue(checkIn.progress_snapshot_value)}
                        </div>
                      ) : (
                        <div className={styles.listMeta}>
                          Logged: {checkIn.progress_value}{" "}
                          {checkIn.progress_unit === "count" || !checkIn.progress_unit
                            ? goalUnitLabel
                            : checkIn.progress_unit}
                        </div>
                      )}
                      {checkIn.proof_hash ? (
                        <div className={styles.listMeta}>{checkIn.proof_hash}</div>
                      ) : null}
                      {checkIn.onchain_tx_hash ? (
                        <div className={styles.listMeta}>
                          On-chain anchor{" "}
                          {isRealTxHash(checkIn.onchain_tx_hash) ? (
                            <a
                              className={styles.inlineLink}
                              href={baseScanTxUrl(checkIn.onchain_tx_hash) as string}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View tx {shortHash(checkIn.onchain_tx_hash, 8, 6)}
                            </a>
                          ) : isMockTxRef(checkIn.onchain_tx_hash) ? (
                            "Demo anchor (mock mode)"
                          ) : (
                            shortHash(checkIn.onchain_tx_hash, 24, 12)
                          )}
                          {checkIn.onchain_chain_id ? ` (Chain ${checkIn.onchain_chain_id})` : ""}
                        </div>
                      ) : null}
                      {checkIn.image_url ? (
                        <div className={styles.checkInImageWrap}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={checkIn.image_url}
                            alt="Check-in attachment"
                            className={styles.checkInImage}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {isOwner ? (
              <section className={styles.card}>
                <div className={styles.sectionTitle}>Delete goal</div>
                <div className={styles.notice}>
                  Deleting permanently removes this goal and its check-ins.
                </div>
                {deleteLockReason ? <div className={styles.notice}>{deleteLockReason}</div> : null}
                {deleteError ? <div className={styles.message}>{deleteError}</div> : null}
                <div className={styles.buttonRow}>
                  <button
                    className={styles.buttonDanger}
                    type="button"
                    onClick={handleDeleteGoal}
                    disabled={
                      !goal ||
                      goal.privacy !== "private" ||
                      Boolean(deleteLockReason) ||
                      deleteUpdating
                    }
                  >
                    {deleteUpdating ? "Deleting..." : "Delete goal"}
                  </button>
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <div className={styles.card}>Goal not found.</div>
        )}
      </div>
    </div>
  );
}
