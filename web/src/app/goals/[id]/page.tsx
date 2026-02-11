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
import { useParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { base } from "viem/chains";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { useAccount, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { BASELINE_TAGLINE } from "@/lib/brand";
import { supabase } from "@/lib/supabaseClient";
import { logEvent } from "@/lib/eventLogger";
import {
  habitRegistryAbi,
  mockCompletionNft,
  mockHabitRegistry,
} from "@/lib/contracts";
import type { GoalModelType } from "@/lib/goalTypes";
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

const toEditForm = (nextGoal: Goal) => ({
  title: nextGoal.title ?? "",
  hasStartDate: Boolean(nextGoal.start_at),
  startDate: formatDateInput(nextGoal.start_at),
  deadline: formatDateInput(nextGoal.deadline_at),
  modelType: nextGoal.model_type,
  targetValue: nextGoal.target_value ? String(nextGoal.target_value) : "",
  targetUnit: nextGoal.target_unit ?? "",
});

export default function GoalPage() {
  const params = useParams<{ id: string }>();
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

  const progressPercent = useMemo(() => {
    if (!goal?.target_value || goal.target_value <= 0) return 0;
    return Math.min(Math.round((checkIns.length / goal.target_value) * 100), 100);
  }, [goal, checkIns.length]);

  const isOwner = Boolean(session?.user?.id && goal?.user_id === session.user.id);

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
        "id,check_in_at,note,proof_hash,image_path,onchain_commitment_id,onchain_tx_hash,onchain_chain_id,onchain_submitted_at,created_at"
      )
      .eq("goal_id", id)
      .order("check_in_at", { ascending: false });

    if (
      checkInsWithImagePath.error &&
      (isMissingCheckInImagePathColumnError(checkInsWithImagePath.error.message) ||
        isMissingCheckInOnchainColumnsError(checkInsWithImagePath.error.message))
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
    let onchainAnchored = false;
    let anchorCreatedForLegacyPublicGoal = false;
    let activeGoal = goal;

    if (!activeGoal) {
      setSubmitError("Goal context is unavailable.");
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
          anchorError instanceof Error
            ? anchorError.message
            : "Failed to create commitment anchor for this public goal."
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
          onchainError instanceof Error
            ? onchainError.message
            : "Failed to submit on-chain check-in proof."
        );
        setSubmittingCheckIn(false);
        return;
      }
    }

    const basePayload = {
      goal_id: goalId,
      user_id: session.user.id,
      check_in_at: checkInTimestamp,
      note: normalizedNote,
      proof_hash: generatedProofHash,
    };

    let includeImagePathColumn = Boolean(uploadedImagePath);
    let includeOnchainColumns = true;

    const insertCheckIn = async () =>
      supabase.from("check_ins").insert({
        ...basePayload,
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
      setSubmitError(insertError.message);
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
        },
      });

      if (eventError) {
        console.warn("Failed to log check_in.created event", eventError);
      }
    }

    setNote("");
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
          anchorError instanceof Error
            ? anchorError.message
            : "Failed to create commitment anchor."
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

    const ok = window.confirm("Mark this goal as complete?");
    if (!ok) return;

    setCompletionUpdating(true);
    setCompletionError(null);
    setCompletionMessage(null);

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
      setCompletionError(updateError.message);
      setCompletionUpdating(false);
      return;
    }

    const nextGoal = {
      ...data,
      completed_at: (data as Goal).completed_at ?? completedAt,
    } as Goal;
    setGoal(nextGoal);
    setEditForm(toEditForm(nextGoal));
    setCompletionMessage("Goal marked complete.");
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

    const requiresTarget = editForm.modelType !== "milestone";
    const targetValueNumber = requiresTarget
      ? Number(editForm.targetValue)
      : null;

    if (requiresTarget && (!targetValueNumber || targetValueNumber <= 0)) {
      setEditError("Goal value must be greater than 0.");
      return;
    }

    const startISO =
      editForm.hasStartDate && editForm.startDate
        ? new Date(`${editForm.startDate}T00:00:00`).toISOString()
        : null;
    const deadlineISO = new Date(
      `${editForm.deadline}T00:00:00`
    ).toISOString();

    setEditUpdating(true);

    const { data, error: updateError } = await supabase
      .from("goals")
      .update({
        title: editForm.title.trim(),
        start_at: startISO,
        deadline_at: deadlineISO,
        model_type: editForm.modelType,
        target_value: targetValueNumber,
        target_unit: requiresTarget ? editForm.targetUnit.trim() || null : null,
      })
      .eq("id", goal.id)
      .select("*")
      .single();

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
                <span className={styles.pill}>{goal.model_type}</span>
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
                  {goal.target_value
                    ? `${progressPercent}% of ${goal.target_value} ${
                        goal.target_unit ?? "check-ins"
                      }`
                    : "Target not set yet"}
                </div>
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
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="edit-deadline">
                          <span className={styles.labelInline}>
                            Deadline
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
                      {editForm.hasStartDate ? (
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
                            <option value="milestone">Milestone-based</option>
                          </select>
                        </div>
                      )}
                    </div>

                    {editForm.hasStartDate ? (
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
                            <option value="milestone">Milestone-based</option>
                          </select>
                        </div>
                      </div>
                    ) : null}

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
          </>
        ) : (
          <div className={styles.card}>Goal not found.</div>
        )}
      </div>
    </div>
  );
}
