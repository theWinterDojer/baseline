import type { GoalModelType } from "@/lib/goalTypes";

export type GoalTrackingType = "count" | "duration";
export type GoalCadence = "daily" | "weekly" | "by_deadline";

const SNAPSHOT_PRESET_KEYS = new Set([
  "bodyweight_logged",
  // Legacy support for goals created before the consolidated preset catalog.
  "pounds_lost",
  "pounds_gained",
]);

type LegacyGoalTrackingInput = {
  modelType: GoalModelType;
  targetValue: number | null;
  targetUnit: string | null;
  cadence?: GoalCadence | null;
  category?: string | null;
  preset?: string | null;
  cadenceTargetValue?: number | null;
  totalTargetValue?: number | null;
};

type LegacyGoalTrackingOutput = {
  goal_type: GoalTrackingType | null;
  cadence: GoalCadence | null;
  goal_category: string | null;
  count_unit_preset: string | null;
  cadence_target_value: number | null;
  total_target_value: number | null;
  total_progress_value: number;
};

export function toLegacyCompatibleGoalTrackingFields(
  input: LegacyGoalTrackingInput
): LegacyGoalTrackingOutput {
  if (input.modelType === "milestone") {
    return {
      goal_type: null,
      cadence: null,
      goal_category: null,
      count_unit_preset: null,
      cadence_target_value: null,
      total_target_value: null,
      total_progress_value: 0,
    };
  }

  const goalType: GoalTrackingType =
    input.modelType === "time" ? "duration" : "count";
  const normalizedUnit = normalizePresetKey(input.preset ?? input.targetUnit);
  const normalizedCategory = normalizePresetKey(input.category);
  const cadence = input.cadence ?? "by_deadline";
  const cadenceTargetValue = input.cadenceTargetValue ?? input.targetValue;
  const totalTargetValue = input.totalTargetValue ?? input.targetValue;

  return {
    goal_type: goalType,
    cadence,
    goal_category: goalType === "count" ? normalizedCategory : null,
    count_unit_preset: goalType === "count" ? normalizedUnit : null,
    cadence_target_value: cadenceTargetValue,
    total_target_value: totalTargetValue,
    total_progress_value: 0,
  };
}

export function isMissingGoalTrackingColumnsError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("goal_type") ||
    normalized.includes("cadence") ||
    normalized.includes("count_unit_preset") ||
    normalized.includes("cadence_target_value") ||
    normalized.includes("total_target_value") ||
    normalized.includes("total_progress_value") ||
    normalized.includes("goal_category")
  );
}

export function isWeightSnapshotPreset(preset: string | null | undefined): boolean {
  if (!preset) return false;
  return SNAPSHOT_PRESET_KEYS.has(preset);
}

type SnapshotProgressInput = {
  startValue: number | null;
  currentValue: number | null;
  targetValue: number | null;
};

export function calculateSnapshotProgressPercent(input: SnapshotProgressInput): number {
  const { targetValue, currentValue } = input;
  if (targetValue === null || currentValue === null) return 0;
  if (!Number.isFinite(targetValue) || !Number.isFinite(currentValue)) return 0;

  const startValue =
    input.startValue !== null && Number.isFinite(input.startValue)
      ? input.startValue
      : currentValue;

  if (startValue === targetValue) {
    return currentValue === targetValue ? 100 : 0;
  }

  const neededChange = targetValue - startValue;
  if (neededChange === 0) return 0;

  const currentChange = currentValue - startValue;
  const rawPercent = (currentChange / neededChange) * 100;

  if (!Number.isFinite(rawPercent)) return 0;
  return Math.max(0, Math.min(100, Math.round(rawPercent)));
}

function normalizePresetKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

  return normalized.length > 0 ? normalized : null;
}
