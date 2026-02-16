export type TrendMode = "cumulative" | "snapshot";

export type TrendCheckInInput = {
  checkInAt: string;
  progressValue: number | null;
  progressSnapshotValue: number | null;
};

export type ProgressTrendPoint = {
  timestamp: string;
  value: number;
};

const toTimestamp = (value: string): number | null => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return timestamp;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const buildProgressTrendPoints = ({
  checkIns,
  mode,
}: {
  checkIns: TrendCheckInInput[];
  mode: TrendMode;
}): ProgressTrendPoint[] => {
  const sorted = [...checkIns]
    .map((checkIn) => ({
      ...checkIn,
      ts: toTimestamp(checkIn.checkInAt),
    }))
    .filter((checkIn) => checkIn.ts !== null)
    .sort((left, right) => (left.ts as number) - (right.ts as number));

  if (mode === "snapshot") {
    return sorted
      .filter((checkIn) => isFiniteNumber(checkIn.progressSnapshotValue))
      .map((checkIn) => ({
        timestamp: checkIn.checkInAt,
        value: checkIn.progressSnapshotValue as number,
      }));
  }

  let cumulative = 0;
  const points: ProgressTrendPoint[] = [];
  for (const checkIn of sorted) {
    const increment =
      isFiniteNumber(checkIn.progressValue) && checkIn.progressValue > 0
        ? checkIn.progressValue
        : 1;
    cumulative += increment;
    points.push({
      timestamp: checkIn.checkInAt,
      value: cumulative,
    });
  }

  return points;
};
