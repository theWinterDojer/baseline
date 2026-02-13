"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BASELINE_TAGLINE } from "@/lib/brand";
import type { GoalModelType } from "@/lib/goalTypes";
import { getPresetLabel } from "@/lib/goalPresets";
import {
  isMissingGoalTrackingColumnsError,
  isWeightSnapshotPreset,
} from "@/lib/goalTracking";
import { supabase } from "@/lib/supabaseClient";
import styles from "./discover.module.css";

type GoalSummary = {
  id: string;
  title: string;
  description: string | null;
  deadline_at: string;
  created_at: string;
  model_type: GoalModelType;
  goal_type: "count" | "duration" | null;
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

type RawDiscoveryRow = Omit<DiscoveryRow, "goals"> & {
  goals: GoalSummary | GoalSummary[] | null;
};

const toGoalSummary = (
  goal: GoalSummary | GoalSummary[] | null | undefined
): GoalSummary | null => {
  if (!goal) return null;
  return Array.isArray(goal) ? (goal[0] ?? null) : goal;
};

const normalizeDiscoveryRows = (data: RawDiscoveryRow[]): DiscoveryRow[] =>
  data.map((row) => ({
    ...row,
    goals: toGoalSummary(row.goals),
  }));

const selectGoalsWithTracking =
  "id,title,description,deadline_at,created_at,model_type,goal_type,count_unit_preset,total_target_value,total_progress_value,target_value,target_unit,check_in_count";
const selectGoalsLegacy =
  "id,title,description,deadline_at,created_at,model_type,target_value,target_unit,check_in_count";

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

  const loadTrending = useCallback(async (): Promise<DiscoveryRow[]> => {
    const withTracking = await supabase
      .from("discovery_rankings")
      .select(
        `goal_id,score,total_sponsored_cents,recent_sponsored_cents_7d,comment_count_7d,verified_sponsor_count,updated_at,goals(${selectGoalsWithTracking})`
      )
      .order("score", { ascending: false })
      .limit(50);

    if (withTracking.error) {
      if (!isMissingGoalTrackingColumnsError(withTracking.error.message)) {
        throw withTracking.error;
      }

      const legacy = await supabase
        .from("discovery_rankings")
        .select(
          `goal_id,score,total_sponsored_cents,recent_sponsored_cents_7d,comment_count_7d,verified_sponsor_count,updated_at,goals(${selectGoalsLegacy})`
        )
        .order("score", { ascending: false })
        .limit(50);

      if (legacy.error) throw legacy.error;
      return normalizeDiscoveryRows((legacy.data ?? []) as RawDiscoveryRow[]);
    }

    return normalizeDiscoveryRows((withTracking.data ?? []) as RawDiscoveryRow[]);
  }, []);

  const loadTopSponsored = useCallback(async (): Promise<DiscoveryRow[]> => {
    const withTracking = await supabase
      .from("discovery_rankings")
      .select(
        `goal_id,score,total_sponsored_cents,recent_sponsored_cents_7d,comment_count_7d,verified_sponsor_count,updated_at,goals(${selectGoalsWithTracking})`
      )
      .order("total_sponsored_cents", { ascending: false })
      .limit(50);

    if (withTracking.error) {
      if (!isMissingGoalTrackingColumnsError(withTracking.error.message)) {
        throw withTracking.error;
      }

      const legacy = await supabase
        .from("discovery_rankings")
        .select(
          `goal_id,score,total_sponsored_cents,recent_sponsored_cents_7d,comment_count_7d,verified_sponsor_count,updated_at,goals(${selectGoalsLegacy})`
        )
        .order("total_sponsored_cents", { ascending: false })
        .limit(50);

      if (legacy.error) throw legacy.error;
      return normalizeDiscoveryRows((legacy.data ?? []) as RawDiscoveryRow[]);
    }

    return normalizeDiscoveryRows((withTracking.data ?? []) as RawDiscoveryRow[]);
  }, []);

  const loadNewest = useCallback(async (): Promise<DiscoveryRow[]> => {
    const withTracking = await supabase
      .from("goals")
      .select(selectGoalsWithTracking)
      .eq("privacy", "public")
      .order("created_at", { ascending: false })
      .limit(50);

    let goalsData: GoalSummary[] = [];

    if (withTracking.error) {
      if (!isMissingGoalTrackingColumnsError(withTracking.error.message)) {
        throw withTracking.error;
      }

      const legacy = await supabase
        .from("goals")
        .select(selectGoalsLegacy)
        .eq("privacy", "public")
        .order("created_at", { ascending: false })
        .limit(50);

      if (legacy.error) throw legacy.error;
      goalsData = (legacy.data ?? []) as GoalSummary[];
    } else {
      goalsData = (withTracking.data ?? []) as GoalSummary[];
    }

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
  }, []);

  const loadNearCompletion = useCallback(async (): Promise<DiscoveryRow[]> => {
    const withTracking = await supabase
      .from("goals")
      .select(selectGoalsWithTracking)
      .eq("privacy", "public")
      .order("created_at", { ascending: false })
      .limit(200);

    let goalsData: GoalSummary[] = [];

    if (withTracking.error) {
      if (!isMissingGoalTrackingColumnsError(withTracking.error.message)) {
        throw withTracking.error;
      }

      const legacy = await supabase
        .from("goals")
        .select(selectGoalsLegacy)
        .eq("privacy", "public")
        .order("created_at", { ascending: false })
        .limit(200);

      if (legacy.error) throw legacy.error;
      goalsData = (legacy.data ?? []) as GoalSummary[];
    } else {
      goalsData = (withTracking.data ?? []) as GoalSummary[];
    }

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
  }, []);

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
        </section>

        <section className={styles.card}>
          <div className={styles.sectionTitle}>{views.find((v) => v.id === activeView)?.label}</div>
          {loading ? (
            <div className={styles.empty}>Loading goals...</div>
          ) : error ? (
            <div className={styles.message}>{error}</div>
          ) : rows.length === 0 ? (
            <div className={styles.empty}>No public goals yet.</div>
          ) : (
            <div className={styles.list}>
              {rows.map((row) => {
                const goal = row.goals;
                if (!goal) return null;
                const target = goal.total_target_value ?? goal.target_value ?? null;
                const ratio = progressRatio(goal, snapshotByGoalId);
                const progress =
                  target && target > 0
                    ? Math.min(Math.round(ratio * 100), 100)
                    : null;
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
                    {goal.description ? (
                      <div className={styles.listDescription}>{goal.description}</div>
                    ) : null}
                    <div className={styles.listMeta}>
                      <span className={styles.pill}>{goal.model_type}</span>
                      <span className={styles.pill}>
                        Due {new Date(goal.deadline_at).toLocaleDateString()}
                      </span>
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
