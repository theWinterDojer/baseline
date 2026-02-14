export const legacyMinCheckInsToMinimumProgress = (
  minCheckIns: number | null | undefined
): number | null => {
  if (typeof minCheckIns !== "number") return null;
  if (!Number.isFinite(minCheckIns) || minCheckIns < 0) return null;
  return Math.floor(minCheckIns);
};

export const minimumProgressToLegacyMinCheckIns = (
  minimumProgress: number | null
): number | null => {
  if (minimumProgress === null) return null;
  if (!Number.isFinite(minimumProgress) || minimumProgress < 0) return null;
  return Math.floor(minimumProgress);
};

export const parseMinimumProgressInput = (
  value: string
): { value: number | null; valid: boolean } => {
  const trimmed = value.trim();
  if (!trimmed) {
    return { value: null, valid: true };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { value: null, valid: false };
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return { value: null, valid: false };
  }

  return { value: parsed, valid: true };
};
