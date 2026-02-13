"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { SiweMessage } from "siwe";
import { useAccount, useChainId, useDisconnect, useSignMessage } from "wagmi";
import { supabase } from "@/lib/supabaseClient";
import { logEvent } from "@/lib/eventLogger";
import { BASELINE_TAGLINE } from "@/lib/brand";
import type { GoalModelType } from "@/lib/goalTypes";
import {
  GOAL_PRESET_CATEGORIES,
  getPresetLabel,
} from "@/lib/goalPresets";
import {
  type GoalCadence,
  isMissingGoalTrackingColumnsError,
  isWeightSnapshotPreset,
  toLegacyCompatibleGoalTrackingFields,
} from "@/lib/goalTracking";
import styles from "./page.module.css";

type Goal = {
  id: string;
  title: string;
  start_at: string | null;
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

const modelLabels: Record<GoalModelType, string> = {
  count: "Count-based",
  time: "Duration-based",
  milestone: "Milestone-based",
};

const CADENCE_OPTIONS: Array<{
  value: GoalCadence;
  title: string;
  description: string;
}> = [
  {
    value: "daily",
    title: "Daily",
    description: "Set a target you want to hit each day.",
  },
  {
    value: "weekly",
    title: "Weekly",
    description: "Set a target you want to hit each week.",
  },
  {
    value: "by_deadline",
    title: "By deadline",
    description: "Set one total target to reach by the deadline.",
  },
];

const WIZARD_STEPS = [
  "Intent",
  "Measurement",
  "Pace",
  "Timeline",
  "Review",
] as const;

type MeasurementLevel = "type" | "category" | "unit";
type WizardMotionDirection = "forward" | "backward";
type DurationInputUnit = "minutes" | "hours";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toDateInputValue = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const defaultStartDate = toDateInputValue(new Date());

const parseStrictPositiveInteger = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const numberValue = Number(trimmed);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) {
    return null;
  }
  return numberValue;
};

const parseStrictPositiveDecimal = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const numberValue = Number(trimmed);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }
  return numberValue;
};

const daysInclusive = (startDate: string, deadlineDate: string): number | null => {
  if (!startDate || !deadlineDate) return null;
  const [startY, startM, startD] = startDate.split("-").map(Number);
  const [endY, endM, endD] = deadlineDate.split("-").map(Number);
  if (!startY || !startM || !startD || !endY || !endM || !endD) return null;

  const startUtc = Date.UTC(startY, startM - 1, startD);
  const endUtc = Date.UTC(endY, endM - 1, endD);
  if (Number.isNaN(startUtc) || Number.isNaN(endUtc) || startUtc > endUtc) {
    return null;
  }

  return Math.floor((endUtc - startUtc) / MS_PER_DAY) + 1;
};

const staggerStyle = (index: number) => ({
  animationDelay: `${index * 40}ms`,
});

const UNIT_GUIDANCE_BY_PRESET_KEY: Record<string, string> = {
  bodyweight_logged:
    "Log your current weight at each check-in. Progress compares your latest weight to your goal weight.",
  reduction_days: "Use this for \"no X\" goals. Log 1 for each successful day.",
  distance: "Log distance completed on each check-in.",
  activity_minutes: "Log active minutes completed each time.",
  sleep_hours: "Log total sleep hours for the day.",
};

export default function Home() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [walletAuthLoading, setWalletAuthLoading] = useState(false);
  const [lastAuthAddress, setLastAuthAddress] = useState<string | null>(null);
  const [goalWizardStep, setGoalWizardStep] = useState(0);
  const [measurementLevel, setMeasurementLevel] = useState<MeasurementLevel>("type");
  const [wizardMotionDirection, setWizardMotionDirection] =
    useState<WizardMotionDirection>("forward");
  const [durationInputUnit, setDurationInputUnit] =
    useState<DurationInputUnit>("minutes");
  const [goalForm, setGoalForm] = useState({
    title: "",
    modelType: "count" as Extract<GoalModelType, "count" | "time">,
    categoryKey: "",
    presetKey: "",
    cadence: "by_deadline" as GoalCadence,
    startSnapshotValue: "",
    cadenceTargetValue: "",
    startDate: defaultStartDate,
    deadline: "",
  });
  const [goalError, setGoalError] = useState<string | null>(null);
  const [goalMessage, setGoalMessage] = useState<string | null>(null);
  const wizardHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const walletAddress =
    (session?.user?.user_metadata?.wallet_address as string | undefined) ??
    address;

  const formatAddress = (value: string) =>
    `${value.slice(0, 6)}...${value.slice(-4)}`;

  const userLabel = useMemo(() => {
    if (walletAddress) {
      return `Wallet ${formatAddress(walletAddress)}`;
    }
    if (session?.user?.email) {
      return session.user.email;
    }
    return "Signed in";
  }, [walletAddress, session?.user?.email]);

  const selectedCategory = useMemo(
    () =>
      GOAL_PRESET_CATEGORIES.find(
        (category) => category.key === goalForm.categoryKey
      ) ?? null,
    [goalForm.categoryKey]
  );

  const selectedPreset = useMemo(
    () =>
      selectedCategory?.presets.find(
        (preset) => preset.key === goalForm.presetKey
      ) ?? null,
    [goalForm.presetKey, selectedCategory]
  );
  const isSnapshotPresetSelected =
    goalForm.modelType === "count" && isWeightSnapshotPreset(goalForm.presetKey);

  useEffect(() => {
    if (goalForm.modelType !== "count") return;
    if (!selectedCategory) {
      if (!goalForm.presetKey) return;
      setGoalForm((current) => ({
        ...current,
        presetKey: "",
      }));
      return;
    }
    if (selectedCategory.presets.some((preset) => preset.key === goalForm.presetKey)) {
      return;
    }
    setGoalForm((current) => ({
      ...current,
      presetKey: selectedCategory.presets[0]?.key ?? "",
    }));
  }, [goalForm.modelType, goalForm.presetKey, selectedCategory]);

  useEffect(() => {
    if (!isSnapshotPresetSelected) return;
    if (goalForm.cadence === "by_deadline") return;
    setGoalForm((current) => ({
      ...current,
      cadence: "by_deadline",
    }));
  }, [goalForm.cadence, isSnapshotPresetSelected]);

  const cadenceTargetNumber = useMemo(
    () => parseStrictPositiveInteger(goalForm.cadenceTargetValue),
    [goalForm.cadenceTargetValue]
  );
  const snapshotStartWeight = useMemo(
    () =>
      isSnapshotPresetSelected
        ? parseStrictPositiveDecimal(goalForm.startSnapshotValue)
        : null,
    [goalForm.startSnapshotValue, isSnapshotPresetSelected]
  );
  const cadenceTargetStorageValue = useMemo(() => {
    if (!cadenceTargetNumber) return null;
    return cadenceTargetNumber;
  }, [cadenceTargetNumber]);
  const cadenceTargetDurationMinutes = useMemo(() => {
    if (!cadenceTargetNumber || goalForm.modelType !== "time") return null;
    if (durationInputUnit === "hours") {
      const minutesValue = cadenceTargetNumber * 60;
      return Number.isSafeInteger(minutesValue) ? minutesValue : null;
    }
    return cadenceTargetNumber;
  }, [cadenceTargetNumber, durationInputUnit, goalForm.modelType]);

  const dateRangeDays = useMemo(
    () => daysInclusive(goalForm.startDate, goalForm.deadline),
    [goalForm.deadline, goalForm.startDate]
  );

  const cadenceOccurrences = useMemo(() => {
    if (!dateRangeDays) return null;
    if (goalForm.cadence === "daily") return dateRangeDays;
    if (goalForm.cadence === "weekly") return Math.ceil(dateRangeDays / 7);
    return 1;
  }, [dateRangeDays, goalForm.cadence]);

  const totalTargetValue = useMemo(() => {
    if (!cadenceTargetStorageValue || !cadenceOccurrences) return null;
    return cadenceTargetStorageValue * cadenceOccurrences;
  }, [cadenceOccurrences, cadenceTargetStorageValue]);

  const durationUnitLabel = durationInputUnit === "hours" ? "hours" : "minutes";

  const goalUnitLabel =
    goalForm.modelType === "time"
      ? durationUnitLabel
      : isSnapshotPresetSelected
        ? "weight"
        : (selectedPreset?.label.toLowerCase() ?? "units");

  const goalSummary = useMemo(() => {
    const title = goalForm.title.trim();
    if (!title) return null;
    if (isSnapshotPresetSelected) {
      if (!cadenceTargetNumber || snapshotStartWeight === null) return null;
      return `${title}: start at ${snapshotStartWeight} and reach goal weight ${cadenceTargetNumber} by ${goalForm.deadline}.`;
    }
    if (!cadenceTargetNumber || !totalTargetValue) return null;
    if (goalForm.modelType === "time") {
      if (goalForm.cadence === "daily") {
        return `${title}: ${cadenceTargetNumber} ${goalUnitLabel} per day from ${goalForm.startDate} to ${goalForm.deadline} (${totalTargetValue} ${goalUnitLabel} total).`;
      }
      if (goalForm.cadence === "weekly") {
        return `${title}: ${cadenceTargetNumber} ${goalUnitLabel} per week from ${goalForm.startDate} to ${goalForm.deadline} (${totalTargetValue} ${goalUnitLabel} total).`;
      }
      return `${title}: ${cadenceTargetNumber} ${goalUnitLabel} by ${goalForm.deadline} (${totalTargetValue} ${goalUnitLabel} total).`;
    }
    if (goalForm.cadence === "daily") {
      return `${title}: ${cadenceTargetNumber} ${goalUnitLabel} per day from ${goalForm.startDate} to ${goalForm.deadline} (${totalTargetValue} total).`;
    }
    if (goalForm.cadence === "weekly") {
      return `${title}: ${cadenceTargetNumber} ${goalUnitLabel} per week from ${goalForm.startDate} to ${goalForm.deadline} (${totalTargetValue} total).`;
    }
    return `${title}: ${totalTargetValue} ${goalUnitLabel} by ${goalForm.deadline}.`;
  }, [
    cadenceTargetNumber,
    goalForm.cadence,
    goalForm.deadline,
    goalForm.modelType,
    goalForm.startDate,
    goalForm.title,
    isSnapshotPresetSelected,
    goalUnitLabel,
    snapshotStartWeight,
    totalTargetValue,
  ]);

  const selectedUnitGuidance = useMemo(() => {
    if (goalForm.modelType !== "count") return null;
    return (
      UNIT_GUIDANCE_BY_PRESET_KEY[goalForm.presetKey] ??
      "You will log this amount each time you check in."
    );
  }, [goalForm.modelType, goalForm.presetKey]);

  const stepErrors = useMemo(() => {
    const errors = [null, null, null, null, null] as Array<string | null>;

    if (!goalForm.title.trim()) {
      errors[0] = "Goal title is required.";
    }

    if (
      goalForm.modelType === "count" &&
      (!goalForm.categoryKey || !goalForm.presetKey)
    ) {
      errors[1] = "Choose a category and preset unit.";
    }

    if (!cadenceTargetStorageValue) {
      errors[2] = "Target must be a whole number greater than 0.";
    } else if (isSnapshotPresetSelected && snapshotStartWeight === null) {
      errors[2] = "Current weight must be a number greater than 0.";
    } else if (
      goalForm.modelType === "time" &&
      goalForm.cadence !== "by_deadline" &&
      (!cadenceTargetDurationMinutes || cadenceTargetDurationMinutes < 5)
    ) {
      errors[2] = "Duration goals need at least 5 minutes for daily/weekly cadence.";
    }

    if (!goalForm.startDate || !goalForm.deadline) {
      errors[3] = "Start date and deadline are required.";
    } else if (!dateRangeDays) {
      errors[3] = "Start date must be on or before the deadline.";
    }

    if (!goalSummary) {
      errors[4] = "Complete the earlier steps to review this goal.";
    }

    return errors;
  }, [
    cadenceTargetStorageValue,
    dateRangeDays,
    goalForm.cadence,
    goalForm.categoryKey,
    goalForm.deadline,
    goalForm.modelType,
    goalForm.presetKey,
    goalForm.startDate,
    goalForm.title,
    cadenceTargetDurationMinutes,
    isSnapshotPresetSelected,
    goalSummary,
    snapshotStartWeight,
  ]);

  const measurementStepError = useMemo(() => {
    if (goalForm.modelType === "time") {
      return null;
    }

    if (measurementLevel === "type") {
      return null;
    }

    if (measurementLevel === "category" && !goalForm.categoryKey) {
      return "Choose a category.";
    }

    if (measurementLevel === "unit" && !goalForm.presetKey) {
      return "Choose a preset unit.";
    }

    if (!goalForm.categoryKey || !goalForm.presetKey) {
      return "Choose a category and preset unit.";
    }

    return null;
  }, [goalForm.categoryKey, goalForm.modelType, goalForm.presetKey, measurementLevel]);

  const currentStepError =
    goalWizardStep === 1 ? measurementStepError : stepErrors[goalWizardStep];

  const isCurrentStepValid = currentStepError === null;
  const wizardProgressPercent =
    ((goalWizardStep + 1) / WIZARD_STEPS.length) * 100;
  const wizardCardKey =
    goalWizardStep === 1 ? `measurement-${measurementLevel}` : `step-${goalWizardStep}`;
  const wizardCardDirectionClass =
    wizardMotionDirection === "backward"
      ? styles.wizardCardBackward
      : styles.wizardCardForward;

  useEffect(() => {
    wizardHeadingRef.current?.focus();
  }, [wizardCardKey]);

  const loadGoals = async (activeSession: Session | null) => {
    if (!activeSession) return;
    setGoalsLoading(true);
    const selectWithTracking =
      "id,title,start_at,deadline_at,model_type,goal_type,cadence,goal_category,count_unit_preset,cadence_target_value,total_target_value,total_progress_value,target_value,target_unit,privacy,status,commitment_id,commitment_tx_hash,commitment_chain_id,commitment_created_at,created_at";
    const selectLegacy =
      "id,title,start_at,deadline_at,model_type,target_value,target_unit,privacy,status,commitment_id,commitment_tx_hash,commitment_chain_id,commitment_created_at,created_at";

    const withTracking = await supabase
      .from("goals")
      .select(selectWithTracking)
      .order("created_at", { ascending: false });

    if (withTracking.error) {
      if (!isMissingGoalTrackingColumnsError(withTracking.error.message)) {
        setGoalError(withTracking.error.message);
        setGoals([]);
        setGoalsLoading(false);
        return;
      }

      const legacy = await supabase
        .from("goals")
        .select(selectLegacy)
        .order("created_at", { ascending: false });

      if (legacy.error) {
        setGoalError(legacy.error.message);
        setGoals([]);
      } else {
        setGoals((legacy.data ?? []) as Goal[]);
      }
      setGoalsLoading(false);
      return;
    }

    setGoals((withTracking.data ?? []) as Goal[]);
    setGoalsLoading(false);
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setInitializing(false);
      loadGoals(data.session ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        if (newSession) {
          loadGoals(newSession);
        } else {
          setGoals([]);
          setLastAuthAddress(null);
        }
      }
    );

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signInWithWallet = useCallback(async () => {
    if (!address) {
      return;
    }

    setWalletAuthLoading(true);
    setLastAuthAddress(address.toLowerCase());

    try {
      const nonceResponse = await fetch("/api/auth/siwe/nonce", {
        method: "POST",
      });
      const nonceData = await nonceResponse.json().catch(() => null);

      if (!nonceResponse.ok) {
        throw new Error(nonceData?.error ?? "Failed to request nonce.");
      }

      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to Baseline using your wallet.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce: nonceData.nonce,
      });

      const signature = await signMessageAsync({
        message: message.prepareMessage(),
      });

      const verifyResponse = await fetch("/api/auth/siwe/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.prepareMessage(),
          signature,
        }),
      });

      const verifyData = await verifyResponse.json().catch(() => null);

      if (!verifyResponse.ok) {
        throw new Error(verifyData?.error ?? "Wallet sign-in failed.");
      }

      if (!verifyData?.session) {
        throw new Error("Missing session from wallet sign-in.");
      }

      const { error } = await supabase.auth.setSession(verifyData.session);

      if (error) {
        throw error;
      }

    } catch (error) {
      console.warn(
        "Wallet sign-in failed",
        error instanceof Error ? error.message : error
      );
    } finally {
      setWalletAuthLoading(false);
    }
  }, [address, chainId, signMessageAsync]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    disconnect();
  };

  useEffect(() => {
    if (initializing || !isConnected || !address || session || walletAuthLoading) return;
    if (lastAuthAddress?.toLowerCase() === address.toLowerCase()) return;
    void signInWithWallet();
  }, [
    address,
    initializing,
    isConnected,
    lastAuthAddress,
    session,
    walletAuthLoading,
    signInWithWallet,
  ]);

  const handleWizardBack = () => {
    setGoalError(null);
    setGoalMessage(null);
    if (goalWizardStep === 1) {
      if (measurementLevel === "unit") {
        setWizardMotionDirection("backward");
        setMeasurementLevel("category");
        return;
      }
      if (measurementLevel === "category") {
        setWizardMotionDirection("backward");
        setMeasurementLevel("type");
        return;
      }
    }
    if (goalWizardStep === 0) return;
    setWizardMotionDirection("backward");
    setGoalWizardStep((current) => Math.max(current - 1, 0));
  };

  const handleWizardContinue = () => {
    setGoalError(null);
    setGoalMessage(null);
    if (!isCurrentStepValid) {
      setGoalError(currentStepError ?? "Please complete this step.");
      return;
    }

    if (goalWizardStep === 1) {
      if (measurementLevel === "type") {
        if (goalForm.modelType === "count") {
          setWizardMotionDirection("forward");
          setMeasurementLevel("category");
          return;
        }
        setWizardMotionDirection("forward");
        setGoalWizardStep((current) =>
          Math.min(current + 1, WIZARD_STEPS.length - 1)
        );
        return;
      }

      if (measurementLevel === "category") {
        setWizardMotionDirection("forward");
        setMeasurementLevel("unit");
        return;
      }

      if (measurementLevel === "unit") {
        setWizardMotionDirection("forward");
        setGoalWizardStep((current) =>
          Math.min(current + 1, WIZARD_STEPS.length - 1)
        );
        return;
      }

      return;
    }

    setWizardMotionDirection("forward");
    setGoalWizardStep((current) =>
      Math.min(current + 1, WIZARD_STEPS.length - 1)
    );
  };

  const handleCreateGoal = async () => {
    setGoalError(null);
    setGoalMessage(null);
    const lastStepIndex = WIZARD_STEPS.length - 1;

    if (goalWizardStep !== lastStepIndex) {
      setGoalError("Use Continue to reach Review before saving.");
      return;
    }

    if (!session?.user?.id) {
      setGoalError("Sign in to create a goal.");
      return;
    }

    if (!goalForm.title.trim()) {
      setGoalError("Goal title is required.");
      return;
    }

    if (goalForm.modelType === "count" && (!goalForm.categoryKey || !goalForm.presetKey)) {
      setGoalError("Choose a category and preset unit.");
      return;
    }

    const cadenceTargetInputValue = parseStrictPositiveInteger(goalForm.cadenceTargetValue);
    if (!cadenceTargetInputValue) {
      setGoalError("Target must be a whole number greater than 0.");
      return;
    }

    if (isSnapshotPresetSelected && snapshotStartWeight === null) {
      setGoalError("Current weight must be a number greater than 0.");
      return;
    }

    const cadenceTargetValue = cadenceTargetInputValue;

    if (!Number.isSafeInteger(cadenceTargetValue)) {
      setGoalError("Target value is too large.");
      return;
    }

    const cadenceTargetMinutesForValidation =
      goalForm.modelType === "time" && durationInputUnit === "hours"
        ? cadenceTargetValue * 60
        : cadenceTargetValue;

    if (
      goalForm.modelType === "time" &&
      goalForm.cadence !== "by_deadline" &&
      cadenceTargetMinutesForValidation < 5
    ) {
      setGoalError("Duration goals need at least 5 minutes for daily/weekly cadence.");
      return;
    }

    if (!goalForm.startDate) {
      setGoalError("Start date is required.");
      return;
    }

    if (!goalForm.deadline) {
      setGoalError("Deadline is required.");
      return;
    }

    if (!dateRangeDays) {
      setGoalError("Start date must be on or before the deadline.");
      return;
    }

    if (!totalTargetValue) {
      setGoalError("Could not compute total target from the selected cadence.");
      return;
    }

    const targetValueNumber = isSnapshotPresetSelected
      ? cadenceTargetInputValue
      : totalTargetValue;
    const targetUnitValue =
      goalForm.modelType === "time"
        ? durationInputUnit
        : isSnapshotPresetSelected
          ? "weight"
        : getPresetLabel(goalForm.presetKey)?.toLowerCase() ?? "units";

    const startISO = new Date(`${goalForm.startDate}T00:00:00`).toISOString();
    const deadlineISO = new Date(`${goalForm.deadline}T00:00:00`).toISOString();

    const legacyPayload = {
      user_id: session.user.id,
      title: goalForm.title.trim(),
      start_at: startISO,
      deadline_at: deadlineISO,
      model_type: goalForm.modelType,
      target_value: targetValueNumber,
      target_unit: targetUnitValue,
      privacy: "private" as const,
      status: "active" as const,
    };

    const trackingFields = toLegacyCompatibleGoalTrackingFields({
      modelType: goalForm.modelType,
      targetValue: targetValueNumber,
      targetUnit: targetUnitValue,
      cadence: goalForm.cadence,
      category: goalForm.modelType === "count" ? goalForm.categoryKey : null,
      preset:
        goalForm.modelType === "count" ? goalForm.presetKey : durationInputUnit,
      cadenceTargetValue,
      totalTargetValue: targetValueNumber,
    });

    const goalInsertPayload = {
      ...legacyPayload,
      ...trackingFields,
      ...(isSnapshotPresetSelected && snapshotStartWeight !== null
        ? { start_snapshot_value: snapshotStartWeight }
        : {}),
    };

    let { data: goalData, error } = await supabase
      .from("goals")
      .insert(goalInsertPayload)
      .select("id")
      .single();

    if (
      error &&
      error.message.toLowerCase().includes("start_snapshot_value")
    ) {
      ({ data: goalData, error } = await supabase
        .from("goals")
        .insert({
          ...legacyPayload,
          ...trackingFields,
        })
        .select("id")
        .single());
    }

    if (error && isMissingGoalTrackingColumnsError(error.message)) {
      ({ data: goalData, error } = await supabase
        .from("goals")
        .insert(legacyPayload)
        .select("id")
        .single());
    }

    if (error) {
      setGoalError(error.message);
      return;
    }

    if (goalData?.id) {
      const { error: eventError } = await logEvent({
        eventType: "goal.created",
        actorId: session.user.id,
        recipientId: session.user.id,
        goalId: goalData.id,
        data: {
          title: goalForm.title.trim(),
          modelType: goalForm.modelType,
          cadence: goalForm.cadence,
          goalCategory: goalForm.modelType === "count" ? goalForm.categoryKey : null,
          unitPreset:
            goalForm.modelType === "count" ? goalForm.presetKey : durationInputUnit,
        },
      });

      if (eventError) {
        console.warn("Failed to log goal.created event", eventError);
      }
    }

      setGoalForm({
        title: "",
        modelType: "count",
        categoryKey: "",
        presetKey: "",
        cadence: "by_deadline",
        startSnapshotValue: "",
        cadenceTargetValue: "",
        startDate: defaultStartDate,
        deadline: "",
      });
    setDurationInputUnit("minutes");
    setMeasurementLevel("type");
    setWizardMotionDirection("forward");
    setGoalWizardStep(0);
    setGoalMessage("Goal created.");
    await loadGoals(session);
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.brand}>Baseline</div>
          </div>
          <div className={styles.headerCenter}>
            <div className={styles.tagline}>{BASELINE_TAGLINE}</div>
          </div>
          <div className={styles.headerRight}>
            {session ? (
              <div className={styles.buttonRow}>
                <span className={styles.pill}>{userLabel}</span>
                <Link className={`${styles.buttonGhost} ${styles.linkButton}`} href="/settings">
                  Settings
                </Link>
                <button className={styles.buttonGhost} onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div className={styles.main}>
          <section className={`${styles.panel} ${styles.delay1}`}>
            {!session ? (
              <>
                <h1 className={styles.panelHeading}>Start a goal that stays yours.</h1>
                <p className={styles.panelSubheading}>
                  Baseline is a private-first habit tracker with optional sponsorship. Keep your
                  progress off-chain, publish only when you want support.
                </p>
                <div className={styles.heroList}>
                  <span>
                    <span className={styles.dot} /> Private by default, public by choice
                  </span>
                  <span>
                    <span className={styles.dot} /> Flexible check-ins, no streak pressure
                  </span>
                  <span>
                    <span className={styles.dot} /> Deterministic payouts, minimal on-chain data
                  </span>
                </div>
              </>
            ) : (
              <>
                <h1 className={styles.panelHeading}>Create your first goal</h1>
                <form
                  className={styles.wizard}
                  onSubmit={(event: FormEvent) => event.preventDefault()}
                >
                  <div className={styles.wizardPanel}>
                    <div className={styles.wizardProgressHeader}>
                      <div className={styles.wizardStepTag}>
                        Step {goalWizardStep + 1} of {WIZARD_STEPS.length}
                      </div>
                      <div className={styles.wizardProgressTrack} aria-hidden="true">
                        <div
                          className={styles.wizardProgressFill}
                          style={{ width: `${wizardProgressPercent}%` }}
                        />
                      </div>
                      <div className={styles.wizardStepLabel}>
                        {WIZARD_STEPS[goalWizardStep]}
                      </div>
                    </div>

                    <div
                      key={wizardCardKey}
                      className={`${styles.wizardCardBody} ${wizardCardDirectionClass}`}
                    >
                      {goalWizardStep === 0 ? (
                        <>
                          <h3
                            ref={wizardHeadingRef}
                            tabIndex={-1}
                            className={styles.wizardHeading}
                          >
                            What do you want to do?
                          </h3>
                          <p className={styles.wizardSubheading}>
                            Keep the title short and specific. You can tune pacing next.
                          </p>
                          <div className={styles.field}>
                            <label className={styles.label} htmlFor="goal-title">
                              Goal title
                            </label>
                            <input
                              id="goal-title"
                              className={styles.input}
                              value={goalForm.title}
                              onChange={(event) =>
                                setGoalForm((current) => ({
                                  ...current,
                                  title: event.target.value,
                                }))
                              }
                              placeholder="Read one hour every day this year"
                            />
                          </div>
                        </>
                      ) : null}

                      {goalWizardStep === 1 ? (
                        <>
                          <h3
                            ref={wizardHeadingRef}
                            tabIndex={-1}
                            className={styles.wizardHeading}
                          >
                            {measurementLevel === "type"
                              ? "How do you want to track this goal?"
                              : measurementLevel === "category"
                                ? "Which area fits this goal best?"
                                : "What exactly will you log?"}
                          </h3>
                          <p className={styles.wizardSubheading}>
                            {measurementLevel === "type"
                              ? "Choose the simplest way to track progress."
                              : measurementLevel === "category"
                                ? "Pick the life area this goal belongs to."
                                : "Choose one unit to track in each check-in."}
                          </p>

                          {measurementLevel === "type" ? (
                            <div className={styles.optionGrid}>
                              <button
                                type="button"
                                className={`${styles.optionCard} ${styles.staggerReveal} ${goalForm.modelType === "count" ? styles.optionCardSelected : ""}`}
                                style={staggerStyle(0)}
                                onClick={() =>
                                  setGoalForm((current) => ({
                                    ...current,
                                    modelType: "count",
                                    categoryKey: "",
                                    presetKey: "",
                                  }))
                                }
                              >
                                <span className={styles.optionTitle}>Track amount</span>
                                <span className={styles.optionBody}>
                                  Log how much you do, like miles ran, pounds lost, books read.
                                </span>
                              </button>
                              <button
                                type="button"
                                className={`${styles.optionCard} ${styles.staggerReveal} ${goalForm.modelType === "time" ? styles.optionCardSelected : ""}`}
                                style={staggerStyle(1)}
                                onClick={() =>
                                  setGoalForm((current) => ({
                                    ...current,
                                    modelType: "time",
                                    categoryKey: "",
                                    presetKey: "",
                                  }))
                                }
                              >
                                <span className={styles.optionTitle}>Track time</span>
                                <span className={styles.optionBody}>
                                  Log time spent in minutes or hours.
                                </span>
                              </button>
                            </div>
                          ) : null}

                          {measurementLevel === "category" && goalForm.modelType === "count" ? (
                            <div className={styles.field}>
                              <div className={styles.categoryGrid}>
                                {GOAL_PRESET_CATEGORIES.map((category, index) => (
                                  <button
                                    key={category.key}
                                    type="button"
                                    className={`${styles.categoryCard} ${styles.staggerReveal} ${goalForm.categoryKey === category.key ? styles.categoryCardSelected : ""}`}
                                    style={staggerStyle(index)}
                                    onClick={() =>
                                      setGoalForm((current) => ({
                                        ...current,
                                        categoryKey: category.key,
                                        presetKey: category.presets[0]?.key ?? "",
                                      }))
                                    }
                                  >
                                    {category.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {measurementLevel === "unit" && goalForm.modelType === "count" ? (
                            <div className={styles.field}>
                              <div className={styles.presetWrap}>
                                {(selectedCategory?.presets ?? []).map((preset, index) => (
                                  <button
                                    key={preset.key}
                                    type="button"
                                    className={`${styles.presetChip} ${styles.staggerReveal} ${goalForm.presetKey === preset.key ? styles.presetChipSelected : ""}`}
                                    style={staggerStyle(index)}
                                    onClick={() =>
                                      setGoalForm((current) => ({
                                        ...current,
                                        presetKey: preset.key,
                                      }))
                                    }
                                  >
                                    {preset.label}
                                  </button>
                                ))}
                              </div>
                              <div className={styles.helper}>{selectedUnitGuidance}</div>
                            </div>
                          ) : null}

                          {goalForm.modelType === "time" ? (
                            <div className={styles.inlineNote}>
                              You can choose minutes or hours in the next step.
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      {goalWizardStep === 2 ? (
                        <>
                          <h3
                            ref={wizardHeadingRef}
                            tabIndex={-1}
                            className={styles.wizardHeading}
                          >
                            {isSnapshotPresetSelected
                              ? "What is your goal weight?"
                              : "How often should this happen?"}
                          </h3>
                          <p className={styles.wizardSubheading}>
                            {isSnapshotPresetSelected
                              ? "Set your current weight and your goal weight."
                              : "Choose cadence, then define the target for that cadence."}
                          </p>
                          {!isSnapshotPresetSelected ? (
                            <div className={styles.optionGrid}>
                              {CADENCE_OPTIONS.map((option, index) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  className={`${styles.optionCard} ${styles.staggerReveal} ${goalForm.cadence === option.value ? styles.optionCardSelected : ""}`}
                                  style={staggerStyle(index)}
                                  onClick={() =>
                                    setGoalForm((current) => ({
                                      ...current,
                                      cadence: option.value,
                                    }))
                                  }
                                >
                                  <span className={styles.optionTitle}>{option.title}</span>
                                  <span className={styles.optionBody}>{option.description}</span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className={styles.inlineNote}>
                              Goal weight uses a single target by your deadline.
                            </div>
                          )}

                          {goalForm.modelType === "time" ? (
                            <div className={styles.durationInlineRow}>
                              <div className={`${styles.field} ${styles.durationUnitField}`}>
                                <label className={styles.label}>Duration unit</label>
                                <div className={styles.presetWrap}>
                                  {(["minutes", "hours"] as const).map((unit, index) => (
                                    <button
                                      key={unit}
                                      type="button"
                                      className={`${styles.presetChip} ${styles.staggerReveal} ${durationInputUnit === unit ? styles.presetChipSelected : ""}`}
                                      style={staggerStyle(index)}
                                      onClick={() => {
                                        if (unit === durationInputUnit) return;
                                        setDurationInputUnit(unit);
                                        setGoalForm((current) => ({
                                          ...current,
                                          cadenceTargetValue: "",
                                        }));
                                      }}
                                    >
                                      {unit === "minutes" ? "Minutes" : "Hours"}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className={`${styles.field} ${styles.durationTargetField}`}>
                                <label className={styles.label} htmlFor="goal-cadence-target">
                                  {goalForm.cadence === "daily"
                                    ? `Target per day (${durationUnitLabel})`
                                    : goalForm.cadence === "weekly"
                                      ? `Target per week (${durationUnitLabel})`
                                      : `Total target (${durationUnitLabel})`}
                                </label>
                                <input
                                  id="goal-cadence-target"
                                  type="number"
                                  min={1}
                                  step={1}
                                  className={`${styles.input} ${styles.durationTargetInput}`}
                                  value={goalForm.cadenceTargetValue}
                                  onChange={(event) =>
                                    setGoalForm((current) => ({
                                      ...current,
                                      cadenceTargetValue: event.target.value,
                                    }))
                                  }
                                  placeholder={durationInputUnit === "hours" ? "e.g. 1" : "e.g. 60"}
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              {isSnapshotPresetSelected ? (
                                <div className={styles.row}>
                                  <div className={styles.field}>
                                    <label className={styles.label} htmlFor="goal-current-weight">
                                      Current weight
                                    </label>
                                    <input
                                      id="goal-current-weight"
                                      type="number"
                                      min={1}
                                      step={0.1}
                                      className={styles.input}
                                      value={goalForm.startSnapshotValue}
                                      onChange={(event) =>
                                        setGoalForm((current) => ({
                                          ...current,
                                          startSnapshotValue: event.target.value,
                                        }))
                                      }
                                      placeholder="e.g. 192.6"
                                    />
                                  </div>
                                  <div className={styles.field}>
                                    <label className={styles.label} htmlFor="goal-cadence-target">
                                      Goal weight
                                    </label>
                                    <input
                                      id="goal-cadence-target"
                                      type="number"
                                      min={1}
                                      step={1}
                                      className={styles.input}
                                      value={goalForm.cadenceTargetValue}
                                      onChange={(event) =>
                                        setGoalForm((current) => ({
                                          ...current,
                                          cadenceTargetValue: event.target.value,
                                        }))
                                      }
                                      placeholder="e.g. 180"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div className={styles.field}>
                                  <label className={styles.label} htmlFor="goal-cadence-target">
                                    {goalForm.cadence === "daily"
                                      ? "Target per day"
                                      : goalForm.cadence === "weekly"
                                        ? "Target per week"
                                        : "Total target"}
                                  </label>
                                  <input
                                    id="goal-cadence-target"
                                    type="number"
                                    min={1}
                                    step={1}
                                    className={styles.input}
                                    value={goalForm.cadenceTargetValue}
                                    onChange={(event) =>
                                      setGoalForm((current) => ({
                                        ...current,
                                        cadenceTargetValue: event.target.value,
                                      }))
                                    }
                                    placeholder="e.g. 60"
                                  />
                                </div>
                              )}
                              {isSnapshotPresetSelected ? (
                                <div className={styles.helper}>
                                  You will log current weight in check-ins. Progress compares
                                  current vs goal from this starting weight.
                                </div>
                              ) : null}
                            </>
                          )}
                        </>
                      ) : null}

                      {goalWizardStep === 3 ? (
                        <>
                          <h3
                            ref={wizardHeadingRef}
                            tabIndex={-1}
                            className={styles.wizardHeading}
                          >
                            What is your time window?
                          </h3>
                          <p className={styles.wizardSubheading}>
                            Start date and deadline are required for consistent tracking.
                          </p>
                          <div className={styles.row}>
                            <div className={styles.field}>
                              <label className={styles.label} htmlFor="goal-start">
                                Start date
                              </label>
                              <input
                                id="goal-start"
                                type="date"
                                className={styles.input}
                                value={goalForm.startDate}
                                onChange={(event) =>
                                  setGoalForm((current) => ({
                                    ...current,
                                    startDate: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className={styles.field}>
                              <label className={styles.label} htmlFor="goal-deadline">
                                Deadline
                              </label>
                              <input
                                id="goal-deadline"
                                type="date"
                                className={styles.input}
                                value={goalForm.deadline}
                                onChange={(event) =>
                                  setGoalForm((current) => ({
                                    ...current,
                                    deadline: event.target.value,
                                  }))
                                }
                              />
                            </div>
                          </div>
                          {dateRangeDays ? (
                            <div className={styles.inlineNote}>
                              {dateRangeDays} days in range ({cadenceOccurrences ?? 0}{" "}
                              {goalForm.cadence === "weekly" ? "weeks" : "cycles"} counted).
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      {goalWizardStep === 4 ? (
                        <>
                          <h3
                            ref={wizardHeadingRef}
                            tabIndex={-1}
                            className={styles.wizardHeading}
                          >
                            Review your goal
                          </h3>
                          <p className={styles.wizardSubheading}>
                            Confirm this setup before saving.
                          </p>
                          <div className={styles.reviewCard}>
                            <div className={styles.reviewRow}>
                              <span className={styles.reviewLabel}>Measurement</span>
                              <span>
                                {goalForm.modelType === "time"
                                  ? "Track time"
                                  : "Track amount"}
                              </span>
                            </div>
                            {goalForm.modelType === "time" ? (
                              <div className={styles.reviewRow}>
                                <span className={styles.reviewLabel}>Duration unit</span>
                                <span>{durationInputUnit}</span>
                              </div>
                            ) : null}
                            {goalForm.modelType === "count" ? (
                              <div className={styles.reviewRow}>
                                <span className={styles.reviewLabel}>Unit</span>
                                <span>{selectedPreset?.label ?? "-"}</span>
                              </div>
                            ) : null}
                            {isSnapshotPresetSelected ? (
                              <div className={styles.reviewRow}>
                                <span className={styles.reviewLabel}>Current weight</span>
                                <span>{snapshotStartWeight ?? "-"}</span>
                              </div>
                            ) : null}
                            <div className={styles.reviewRow}>
                              <span className={styles.reviewLabel}>Cadence</span>
                              <span>{goalForm.cadence.replace("_", " ")}</span>
                            </div>
                            <div className={styles.reviewRow}>
                              <span className={styles.reviewLabel}>
                                {isSnapshotPresetSelected ? "Goal weight" : "Total target"}
                              </span>
                              <span>
                                {isSnapshotPresetSelected
                                  ? `${cadenceTargetNumber ?? "-"}`
                                  : goalForm.modelType === "time"
                                  ? `${totalTargetValue ?? "-"} ${goalUnitLabel}`
                                  : `${totalTargetValue ?? "-"} ${goalUnitLabel}`}
                              </span>
                            </div>
                            <div className={styles.reviewSummary}>
                              {goalSummary ?? "Complete previous steps to generate summary."}
                            </div>
                            {isSnapshotPresetSelected ? (
                              <div className={styles.inlineNote}>
                                You will log your current weight each check-in. Progress uses your
                                latest weight compared with your goal weight.
                              </div>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </div>

                    {goalError ? <div className={styles.message}>{goalError}</div> : null}
                    {goalMessage ? (
                      <div className={`${styles.message} ${styles.success}`}>{goalMessage}</div>
                    ) : null}

                    <div className={`${styles.buttonRow} ${styles.wizardActions}`}>
                      <button
                        type="button"
                        className={styles.buttonGhost}
                        onClick={handleWizardBack}
                        disabled={goalWizardStep === 0}
                      >
                        Back
                      </button>
                      {goalWizardStep < WIZARD_STEPS.length - 1 ? (
                        <button
                          type="button"
                          className={styles.buttonPrimary}
                          onClick={handleWizardContinue}
                          disabled={!isCurrentStepValid}
                        >
                          Continue
                        </button>
                      ) : (
                        <button
                          className={styles.buttonPrimary}
                          type="button"
                          onClick={() => {
                            void handleCreateGoal();
                          }}
                          disabled={!isCurrentStepValid}
                        >
                          Save goal
                        </button>
                      )}
                      <span className={styles.footerNote}>
                        Your goals stay private until you publish them.
                      </span>
                    </div>
                  </div>
                </form>
              </>
            )}
          </section>

          <section className={`${styles.panel} ${styles.delay2}`}>
            {!session ? (
              <>
                <h2 className={styles.panelHeading}>Connect your wallet</h2>
                <p className={styles.panelSubheading}>
                  Wallet connection is the primary sign-in. Attach email later in settings for
                  backup access and notifications.
                </p>
                <div className={styles.walletRow}>
                  <ConnectButton.Custom>
                    {({
                      account,
                      mounted,
                      openAccountModal,
                      openConnectModal,
                    }) => {
                      const ready = mounted;
                      const connected = ready && account;
                      return (
                        <button
                          type="button"
                          className={styles.buttonGhost}
                          onClick={connected ? openAccountModal : openConnectModal}
                          disabled={!ready}
                        >
                          {connected ? account.displayName : "Connect wallet"}
                        </button>
                      );
                    }}
                  </ConnectButton.Custom>
                  {isConnected ? (
                    <button
                      className={styles.buttonPrimary}
                      type="button"
                      onClick={signInWithWallet}
                      disabled={walletAuthLoading}
                    >
                      {walletAuthLoading ? "Signing in..." : "Sign in with wallet"}
                    </button>
                  ) : null}
                </div>
                <div className={styles.walletNote}>
                  {isConnected
                    ? "Sign in to unlock goal creation and check-ins."
                    : "Connect a wallet to start."}
                </div>
              </>
            ) : (
              <>
                <h2 className={styles.panelHeading}>Your goals</h2>
                <p className={styles.panelSubheading}>
                  Review your goals and add check-ins as you go.
                </p>
                {initializing || goalsLoading ? (
                  <div className={styles.emptyState}>Loading your goals...</div>
                ) : goals.length === 0 ? (
                  <div className={styles.emptyState}>
                    No goals yet. Create your first goal to begin.
                  </div>
                ) : (
                  <div className={styles.goalList}>
                    {goals.map((goal) => (
                      <Link key={goal.id} href={`/goals/${goal.id}`} className={styles.goalCard}>
                        <div className={styles.goalMeta}>
                          {modelLabels[goal.model_type]} • {goal.privacy}
                          {goal.start_at
                            ? ` • Starts ${new Date(goal.start_at).toLocaleDateString()}`
                            : ""}
                        </div>
                        <div className={styles.goalTitle}>{goal.title}</div>
                        <div className={styles.goalFoot}>
                          <span>
                            Due {new Date(goal.deadline_at).toLocaleDateString()}
                          </span>
                          <span>
                            {goal.target_value
                              ? `${goal.target_value} ${goal.target_unit ?? "check-ins"}`
                              : ""}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                {goalError ? <div className={styles.message}>{goalError}</div> : null}
                <div className={`${styles.buttonRow} ${styles.discoverCtaRow}`}>
                  <Link className={`${styles.buttonGhost} ${styles.linkButton}`} href="/discover">
                    Browse public goals
                  </Link>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
