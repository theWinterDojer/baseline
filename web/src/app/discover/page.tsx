"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BASELINE_TAGLINE } from "@/lib/brand";
import type { GoalModelType } from "@/lib/goalTypes";
import { getPresetLabel } from "@/lib/goalPresets";
import { cadenceCumulativeTag } from "@/lib/cadenceCopy";
import {
  isMissingGoalTrackingColumnsError,
  isWeightSnapshotPreset,
} from "@/lib/goalTracking";
import { supabase } from "@/lib/supabaseClient";
import styles from "./discover.module.css";

type GoalSummary = {
  id: string;
  title: string;
  deadline_at: string;
  created_at: string;
  model_type: GoalModelType;
  goal_type: "count" | "duration" | null;
  cadence: "daily" | "weekly" | "by_deadline" | null;
  count_unit_preset: string | null;
  total_target_value: number | null;
  total_progress_value: number;
  target_value: number | null;
  target_unit: string | null;
  check_in_count: number;
};

type DiscoveryRow = {
  goal_id: string;
  score: number;
  total_sponsored_cents: number;
  recent_sponsored_cents_7d: number;
  comment_count_7d: number;
  verified_sponsor_count: number;
  updated_at: string;
  goals: GoalSummary | null;
};

type RawGoalSummary = GoalSummary;

type RawDiscoveryRow = Omit<DiscoveryRow, "goals"> & {
  goals: RawGoalSummary | RawGoalSummary[] | null;
};

const toGoalSummary = (
  goal: RawGoalSummary | RawGoalSummary[] | null | undefined
): GoalSummary | null => {
  if (!goal) return null;
  const resolved = Array.isArray(goal) ? (goal[0] ?? null) : goal;
  if (!resolved) return null;
  return resolved;
};

const normalizeDiscoveryRows = (data: RawDiscoveryRow[]): DiscoveryRow[] =>
  data.map((row) => ({
    ...row,
    goals: toGoalSummary(row.goals),
  }));

const selectGoalsWithTracking =
  "id,title,deadline_at,created_at,model_type,goal_type,cadence,count_unit_preset,total_target_value,total_progress_value,target_value,target_unit,check_in_count";
const selectGoalsLegacy =
  "id,title,deadline_at,created_at,model_type,target_value,target_unit,check_in_count";

const normalizeGoalSummaryRows = (data: RawGoalSummary[]): GoalSummary[] =>
  data.map((goal) => ({
    ...goal,
  }));

const progressRatio = (
  goal: GoalSummary,
  snapshotByGoalId: Map<string, number>
): number => {
  const target = goal.total_target_value ?? goal.target_value ?? 0;
  if (!target || target <= 0) return 0;

  if (isWeightSnapshotPreset(goal.count_unit_preset)) {
    const latestSnapshot = snapshotByGoalId.get(goal.id);
    if (latestSnapshot !== undefined) {
      return latestSnapshot / target;
    }
  }

  const current =
    typeof goal.total_progress_value === "number"
      ? goal.total_progress_value
      : goal.check_in_count;
  if (current <= 0) return 0;
  return current / target;
};

const views = [
  { id: "trending", label: "Trending" },
  { id: "top", label: "Top Sponsored" },
  { id: "near", label: "Near Completion" },
  { id: "new", label: "Newest" },
] as const;

type ViewId = (typeof views)[number]["id"];

export default function DiscoverPage() {
  const [activeView, setActiveView] = useState<ViewId>("trending");
  const [rows, setRows] = useState<DiscoveryRow[]>([]);
  const [deadlineWindowFilter, setDeadlineWindowFilter] = useState<
    "any" | "30d" | "90d" | "year"
  >("any");
  const [amountFilter, setAmountFilter] = useState<"any" | "5" | "25" | "100">("any");
  const [snapshotByGoalId, setSnapshotByGoalId] = useState<Map<string, number>>(
    () => new Map()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshotProgress = useCallback(async (goalIds: string[]) => {
    if (goalIds.length === 0) return new Map<string, number>();
    const { data, error } = await supabase
      .from("check_ins")
      .select("goal_id,progress_snapshot_value,check_in_at")
      .in("goal_id", goalIds)
      .not("progress_snapshot_value", "is", null)
      .order("check_in_at", { ascending: false });

    if (error) {
      return new Map<string, number>();
    }

    const nextMap = new Map<string, number>();
    for (const row of data ?? []) {
      if (
        !nextMap.has(row.goal_id) &&
        typeof row.progress_snapshot_value === "number"
      ) {
        nextMap.set(row.goal_id, row.progress_snapshot_value);
      }
    }
    return nextMap;
  }, []);

  const loadRankedView = useCallback(
    async (orderBy: "score" | "total_sponsored_cents"): Promise<DiscoveryRow[]> => {
      const rankedTracking = await supabase
        .from("discovery_rankings")
        .select(
          `goal_id,score,total_sponsored_cents,recent_sponsored_cents_7d,comment_count_7d,verified_sponsor_count,updated_at,goals(${selectGoalsWithTracking})`
        )
        .order(orderBy, { ascending: false })
        .limit(50);

      if (!rankedTracking.error) {
        return normalizeDiscoveryRows((rankedTracking.data ?? []) as RawDiscoveryRow[]);
      }

      if (!isMissingGoalTrackingColumnsError(rankedTracking.error.message)) {
        throw rankedTracking.error;
      }

      const rankedLegacy = await supabase
        .from("discovery_rankings")
        .select(
          `goal_id,score,total_sponsored_cents,recent_sponsored_cents_7d,comment_count_7d,verified_sponsor_count,updated_at,goals(${selectGoalsLegacy})`
        )
        .order(orderBy, { ascending: false })
        .limit(50);

      if (!rankedLegacy.error) {
        return normalizeDiscoveryRows((rankedLegacy.data ?? []) as RawDiscoveryRow[]);
      }

      throw rankedLegacy.error;
    },
    []
  );

  const loadPublicGoals = useCallback(async (limit: number): Promise<GoalSummary[]> => {
    const withTracking = await supabase
      .from("goals")
      .select(selectGoalsWithTracking)
      .eq("privacy", "public")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!withTracking.error) {
      return normalizeGoalSummaryRows((withTracking.data ?? []) as RawGoalSummary[]);
    }

    if (!isMissingGoalTrackingColumnsError(withTracking.error.message)) {
      throw withTracking.error;
    }

    const legacy = await supabase
      .from("goals")
      .select(selectGoalsLegacy)
      .eq("privacy", "public")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!legacy.error) {
      return normalizeGoalSummaryRows((legacy.data ?? []) as RawGoalSummary[]);
    }

    throw legacy.error;
  }, []);

  const loadTrending = useCallback(
    async (): Promise<DiscoveryRow[]> => loadRankedView("score"),
    [loadRankedView]
  );

  const loadTopSponsored = useCallback(
    async (): Promise<DiscoveryRow[]> => loadRankedView("total_sponsored_cents"),
    [loadRankedView]
  );

  const loadNewest = useCallback(async (): Promise<DiscoveryRow[]> => {
    const goalsData = await loadPublicGoals(50);

    return goalsData.map((goal) => ({
      goal_id: goal.id,
      score: 0,
      total_sponsored_cents: 0,
      recent_sponsored_cents_7d: 0,
      comment_count_7d: 0,
      verified_sponsor_count: 0,
      updated_at: new Date().toISOString(),
      goals: goal as GoalSummary,
    }));
  }, [loadPublicGoals]);

  const loadNearCompletion = useCallback(async (): Promise<DiscoveryRow[]> => {
    const goalsData = await loadPublicGoals(200);

    return goalsData
      .map((goal) => ({
        goal_id: goal.id,
        score: 0,
        total_sponsored_cents: 0,
        recent_sponsored_cents_7d: 0,
        comment_count_7d: 0,
        verified_sponsor_count: 0,
        updated_at: new Date().toISOString(),
        goals: goal as GoalSummary,
      }))
      .filter((item) => {
        const target =
          item.goals?.total_target_value ?? item.goals?.target_value ?? null;
        return Boolean(target && target > 0);
      });
  }, [loadPublicGoals]);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        let nextRows: DiscoveryRow[] = [];
        if (activeView === "trending") {
          nextRows = await loadTrending();
        } else if (activeView === "top") {
          nextRows = await loadTopSponsored();
        } else if (activeView === "near") {
          nextRows = await loadNearCompletion();
        } else {
          nextRows = await loadNewest();
        }

        const snapshotGoalIds = nextRows
          .map((row) => row.goals)
          .filter((goal): goal is GoalSummary => Boolean(goal))
          .filter((goal) => isWeightSnapshotPreset(goal.count_unit_preset))
          .map((goal) => goal.id);
        const nextSnapshotMap = await loadSnapshotProgress(snapshotGoalIds);

        if (activeView === "near") {
          nextRows = nextRows
            .sort((a, b) => {
              const pctA = a.goals ? progressRatio(a.goals, nextSnapshotMap) : 0;
              const pctB = b.goals ? progressRatio(b.goals, nextSnapshotMap) : 0;
              return pctB - pctA;
            })
            .slice(0, 50);
        }

        setRows(nextRows);
        setSnapshotByGoalId(nextSnapshotMap);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load discovery.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [
    activeView,
    loadNearCompletion,
    loadNewest,
    loadSnapshotProgress,
    loadTopSponsored,
    loadTrending,
  ]);

  const viewHint = useMemo(() => {
    switch (activeView) {
      case "trending":
        return "Weighted mix of sponsorship, comments, and verified sponsors.";
      case "top":
        return "Sorted by total sponsorship volume.";
      case "near":
        return "Goals closest to their target.";
      case "new":
        return "Newest public goals.";
      default:
        return "";
    }
  }, [activeView]);

  const filteredRows = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();

    const maxDeadlineMs = (() => {
      const days =
        deadlineWindowFilter === "30d"
          ? 30
          : deadlineWindowFilter === "90d"
            ? 90
            : deadlineWindowFilter === "year"
              ? 365
              : null;
      if (days === null) return null;
      return nowMs + days * 24 * 60 * 60 * 1000;
    })();

    const minimumSponsoredCents =
      amountFilter === "5"
        ? 500
        : amountFilter === "25"
          ? 2500
          : amountFilter === "100"
            ? 10000
            : null;

    return rows.filter((row) => {
      const goal = row.goals;
      if (!goal) return false;

      if (maxDeadlineMs !== null) {
        const deadlineMs = new Date(goal.deadline_at).getTime();
        if (Number.isNaN(deadlineMs) || deadlineMs < nowMs || deadlineMs > maxDeadlineMs) {
          return false;
        }
      }

      if (
        minimumSponsoredCents !== null &&
        row.total_sponsored_cents < minimumSponsoredCents
      ) {
        return false;
      }

      return true;
    });
  }, [amountFilter, deadlineWindowFilter, rows]);

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
        </header>

        <section className={styles.card}>
          <div className={styles.title}>Discover goals</div>
          <div className={styles.metaRow}>{viewHint}</div>
          <div className={styles.tabRow}>
            {views.map((view) => (
              <button
                key={view.id}
                type="button"
                className={`${styles.tab} ${
                  activeView === view.id ? styles.tabActive : ""
                }`}
                onClick={() => setActiveView(view.id)}
              >
                {view.label}
              </button>
            ))}
          </div>
          <div className={styles.filterRow}>
            <div className={styles.filterField}>
              <label className={styles.filterLabel} htmlFor="discover-deadline-window">
                Deadline window
              </label>
              <select
                id="discover-deadline-window"
                className={styles.filterInput}
                value={deadlineWindowFilter}
                onChange={(event) =>
                  setDeadlineWindowFilter(
                    event.target.value as "any" | "30d" | "90d" | "year"
                  )
                }
              >
                <option value="any">Any deadline</option>
                <option value="30d">Due in 30 days</option>
                <option value="90d">Due in 90 days</option>
                <option value="year">Due in 1 year</option>
              </select>
            </div>
            <div className={styles.filterField}>
              <label className={styles.filterLabel} htmlFor="discover-amount-filter">
                Sponsored amount
              </label>
              <select
                id="discover-amount-filter"
                className={styles.filterInput}
                value={amountFilter}
                onChange={(event) =>
                  setAmountFilter(event.target.value as "any" | "5" | "25" | "100")
                }
              >
                <option value="any">Any amount</option>
                <option value="5">$5+ sponsored</option>
                <option value="25">$25+ sponsored</option>
                <option value="100">$100+ sponsored</option>
              </select>
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.sectionTitle}>{views.find((v) => v.id === activeView)?.label}</div>
          {loading ? (
            <div className={styles.empty}>Loading goals...</div>
          ) : error ? (
            <div className={styles.message}>{error}</div>
          ) : rows.length === 0 ? (
            <div className={styles.empty}>No public goals yet.</div>
          ) : filteredRows.length === 0 ? (
            <div className={styles.empty}>No goals match these filters.</div>
          ) : (
            <div className={styles.list}>
              {filteredRows.map((row) => {
                const goal = row.goals;
                if (!goal) return null;
                const target = goal.total_target_value ?? goal.target_value ?? null;
                const ratio = progressRatio(goal, snapshotByGoalId);
                const progress =
                  target && target > 0
                    ? Math.min(Math.round(ratio * 100), 100)
                    : null;
                const cadenceTag = cadenceCumulativeTag(goal.cadence);
                const goalUnit =
                  (goal.count_unit_preset
                    ? getPresetLabel(goal.count_unit_preset)
                    : goal.target_unit) ??
                  (goal.goal_type === "duration" || goal.model_type === "time"
                    ? "minutes"
                    : "units");

                return (
                  <Link
                    key={row.goal_id}
                    href={`/public/goals/${row.goal_id}`}
                    className={styles.listItem}
                  >
                    <div className={styles.listTitle}>{goal.title}</div>
                    <div className={styles.listMeta}>
                      <span className={styles.pill}>{goal.model_type}</span>
                      <span className={styles.pill}>
                        Due {new Date(goal.deadline_at).toLocaleDateString()}
                      </span>
                      {cadenceTag ? <span className={styles.pill}>{cadenceTag}</span> : null}
                      {target ? (
                        <span className={styles.pill}>
                          Target {target} {goalUnit}
                        </span>
                      ) : null}
                      {progress !== null ? (
                        <span className={styles.pill}>{progress}% complete</span>
                      ) : null}
                      {row.total_sponsored_cents > 0 ? (
                        <span className={styles.pill}>
                          ${Math.round(row.total_sponsored_cents / 100)} sponsored
                        </span>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
