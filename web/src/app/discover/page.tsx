"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BASELINE_TAGLINE } from "@/lib/brand";
import type { GoalModelType } from "@/lib/goalTypes";
import { supabase } from "@/lib/supabaseClient";
import styles from "./discover.module.css";

type GoalSummary = {
  id: string;
  title: string;
  description: string | null;
  deadline_at: string;
  created_at: string;
  model_type: GoalModelType;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTrending = useCallback(async (): Promise<DiscoveryRow[]> => {
    const { data, error } = await supabase
      .from("discovery_rankings")
      .select(
        "goal_id,score,total_sponsored_cents,recent_sponsored_cents_7d,comment_count_7d,verified_sponsor_count,updated_at,goals(id,title,description,deadline_at,created_at,model_type,target_value,target_unit,check_in_count)"
      )
      .order("score", { ascending: false })
      .limit(50);

    if (error) throw error;
    return normalizeDiscoveryRows((data ?? []) as RawDiscoveryRow[]);
  }, []);

  const loadTopSponsored = useCallback(async (): Promise<DiscoveryRow[]> => {
    const { data, error } = await supabase
      .from("discovery_rankings")
      .select(
        "goal_id,score,total_sponsored_cents,recent_sponsored_cents_7d,comment_count_7d,verified_sponsor_count,updated_at,goals(id,title,description,deadline_at,created_at,model_type,target_value,target_unit,check_in_count)"
      )
      .order("total_sponsored_cents", { ascending: false })
      .limit(50);

    if (error) throw error;
    return normalizeDiscoveryRows((data ?? []) as RawDiscoveryRow[]);
  }, []);

  const loadNewest = useCallback(async (): Promise<DiscoveryRow[]> => {
    const { data, error } = await supabase
      .from("goals")
      .select(
        "id,title,description,deadline_at,created_at,model_type,target_value,target_unit,check_in_count"
      )
      .eq("privacy", "public")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    return (data ?? []).map((goal) => ({
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
    const { data, error } = await supabase
      .from("goals")
      .select(
        "id,title,description,deadline_at,created_at,model_type,target_value,target_unit,check_in_count"
      )
      .eq("privacy", "public")
      .gt("target_value", 0)
      .order("check_in_count", { ascending: false })
      .limit(50);

    if (error) throw error;

    const items: DiscoveryRow[] = (data ?? []).map((goal) => ({
      goal_id: goal.id,
      score: 0,
      total_sponsored_cents: 0,
      recent_sponsored_cents_7d: 0,
      comment_count_7d: 0,
      verified_sponsor_count: 0,
      updated_at: new Date().toISOString(),
      goals: goal as GoalSummary,
    }));

    return items
      .sort((a, b) => {
        const pctA = a.goals?.target_value
          ? a.goals.check_in_count / a.goals.target_value
          : 0;
        const pctB = b.goals?.target_value
          ? b.goals.check_in_count / b.goals.target_value
          : 0;
        return pctB - pctA;
      })
      .slice(0, 50);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (activeView === "trending") {
          setRows(await loadTrending());
        } else if (activeView === "top") {
          setRows(await loadTopSponsored());
        } else if (activeView === "near") {
          setRows(await loadNearCompletion());
        } else {
          setRows(await loadNewest());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load discovery.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [activeView, loadNearCompletion, loadNewest, loadTopSponsored, loadTrending]);

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
            <div className={styles.brand}>Baseline</div>
            <div className={styles.tagline}>{BASELINE_TAGLINE}</div>
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
                const progress =
                  goal.target_value && goal.target_value > 0
                    ? Math.min(
                        Math.round((goal.check_in_count / goal.target_value) * 100),
                        100
                      )
                    : null;

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
