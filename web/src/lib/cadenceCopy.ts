import type { GoalCadence } from "@/lib/goalTracking";

type MaybeCadence = GoalCadence | null | undefined;

export function cadenceLabel(cadence: MaybeCadence): string {
  if (cadence === "daily") return "Daily";
  if (cadence === "weekly") return "Weekly";
  return "By deadline";
}

export function cadenceCumulativeHint(cadence: MaybeCadence): string | null {
  if (cadence === "daily") {
    return "Daily targets are tracked as one cumulative total by your deadline.";
  }
  if (cadence === "weekly") {
    return "Weekly targets are tracked as one cumulative total by your deadline.";
  }
  return null;
}

export function cadenceCumulativeTag(cadence: MaybeCadence): string | null {
  if (cadence === "daily") return "Daily cumulative";
  if (cadence === "weekly") return "Weekly cumulative";
  return null;
}

