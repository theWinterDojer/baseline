const MAX_GOAL_TAGS = 8;

const normalizeTagToken = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

export const parseGoalTagsInput = (value: string): string[] => {
  const seen = new Set<string>();
  const parsed: string[] = [];

  for (const token of value.split(/[,\n]/)) {
    const normalized = normalizeTagToken(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    parsed.push(normalized);
    if (parsed.length >= MAX_GOAL_TAGS) break;
  }

  return parsed;
};

export const formatGoalTagsInput = (tags: string[] | null | undefined): string => {
  if (!tags || tags.length === 0) return "";
  return tags.join(", ");
};

export const coerceGoalTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const parsed: string[] = [];

  for (const tag of value) {
    if (typeof tag !== "string") continue;
    const normalized = normalizeTagToken(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    parsed.push(normalized);
    if (parsed.length >= MAX_GOAL_TAGS) break;
  }

  return parsed;
};

export const goalMatchesTagFilter = (
  tags: string[] | null | undefined,
  filterInput: string
): boolean => {
  const filters = parseGoalTagsInput(filterInput);
  if (filters.length === 0) return true;

  const normalizedTags = coerceGoalTags(tags);
  if (normalizedTags.length === 0) return false;

  return filters.every((filterTag) =>
    normalizedTags.some((tag) => tag.includes(filterTag))
  );
};
