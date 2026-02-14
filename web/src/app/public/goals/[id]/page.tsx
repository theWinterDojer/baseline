"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { BASELINE_TAGLINE } from "@/lib/brand";
import type { GoalModelType } from "@/lib/goalTypes";
import { getPresetLabel } from "@/lib/goalPresets";
import {
  calculateSnapshotProgressPercent,
  isWeightSnapshotPreset,
} from "@/lib/goalTracking";
import { cadenceCumulativeHint, cadenceLabel } from "@/lib/cadenceCopy";
import { supabase } from "@/lib/supabaseClient";
import { coerceGoalTags } from "@/lib/goalTags";
import styles from "./publicGoal.module.css";

type Goal = {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  start_at: string | null;
  completed_at: string | null;
  deadline_at: string;
  model_type: GoalModelType;
  goal_type: "count" | "duration" | null;
  cadence: "daily" | "weekly" | "by_deadline" | null;
  count_unit_preset: string | null;
  cadence_target_value: number | null;
  start_snapshot_value: number | null;
  total_target_value: number | null;
  total_progress_value: number;
  target_value: number | null;
  target_unit: string | null;
  privacy: "private" | "public";
  status: "active" | "completed" | "archived";
  commitment_id: string | null;
  commitment_tx_hash: string | null;
  commitment_chain_id: number | null;
  commitment_created_at: string | null;
  check_in_count: number;
  created_at: string;
};

type Comment = {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
};

type CompletionNft = {
  id: string;
  token_id: string | null;
  tx_hash: string | null;
  created_at: string;
};

type SponsorPledge = {
  id: string;
  amount_cents: number;
  deadline_at: string;
  min_check_ins: number | null;
  status: "offered" | "accepted" | "settled" | "expired" | "cancelled";
  accepted_at: string | null;
  approval_at: string | null;
  settled_at: string | null;
  created_at: string;
};

type PublicSponsorPledge = {
  id: string;
  amount_cents: number;
  deadline_at: string;
  min_check_ins: number | null;
  status: "offered" | "accepted" | "settled" | "expired" | "cancelled";
  approval_at: string | null;
  created_at: string;
};

type SponsorCriteriaNote = {
  id: string;
  pledge_id: string;
  text: string;
  created_at: string;
};

const formatMetricValue = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/\.?0+$/, "");
};

export default function PublicGoalPage() {
  const params = useParams<{ id: string }>();
  const goalId = params?.id;
  const [session, setSession] = useState<Session | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentMessage, setCommentMessage] = useState<string | null>(null);
  const [commentSubmitError, setCommentSubmitError] = useState<string | null>(null);
  const [sponsorPledges, setSponsorPledges] = useState<SponsorPledge[]>([]);
  const [publicSponsorPledges, setPublicSponsorPledges] = useState<PublicSponsorPledge[]>(
    []
  );
  const [sponsorCriteriaNotes, setSponsorCriteriaNotes] = useState<SponsorCriteriaNote[]>(
    []
  );
  const [sponsorMessage, setSponsorMessage] = useState<string | null>(null);
  const [sponsorError, setSponsorError] = useState<string | null>(null);
  const [publicSponsorError, setPublicSponsorError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [completionNft, setCompletionNft] = useState<CompletionNft | null>(null);
  const [pledgeAmount, setPledgeAmount] = useState(10);
  const [pledgeAmountMode, setPledgeAmountMode] = useState<"preset" | "custom">(
    "preset"
  );
  const [customAmount, setCustomAmount] = useState("");
  const [pledgeDeadline, setPledgeDeadline] = useState("");
  const [minCheckIns, setMinCheckIns] = useState("");
  const [criteriaText, setCriteriaText] = useState("");
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [pledgeMessage, setPledgeMessage] = useState<string | null>(null);
  const [pledgeSubmitting, setPledgeSubmitting] = useState(false);
  const [latestSnapshotProgressValue, setLatestSnapshotProgressValue] = useState<
    number | null
  >(null);
  const [startSnapshotProgressValue, setStartSnapshotProgressValue] = useState<
    number | null
  >(null);

  const pledgePresets = [5, 10, 20, 50, 100];

  const isDurationGoal =
    goal?.goal_type === "duration" || goal?.model_type === "time";
  const goalTags = useMemo(() => coerceGoalTags(goal?.tags), [goal?.tags]);
  const isWeightSnapshotGoal = isWeightSnapshotPreset(goal?.count_unit_preset);
  const goalUnitLabel =
    (isWeightSnapshotGoal
      ? "weight"
      : goal?.count_unit_preset
      ? getPresetLabel(goal.count_unit_preset)
      : goal?.target_unit) ?? (isDurationGoal ? "minutes" : "units");
  const minProgressUnitLabel = goalUnitLabel.toLowerCase();
  const progressTargetValue = isWeightSnapshotGoal
    ? goal?.cadence_target_value ?? goal?.target_value ?? goal?.total_target_value ?? null
    : goal?.total_target_value ?? goal?.target_value ?? null;
  const cadenceRollupHint = cadenceCumulativeHint(goal?.cadence);
  const progressCurrentValue = useMemo(() => {
    if (!goal) return null;
    if (isWeightSnapshotGoal) {
      if (latestSnapshotProgressValue !== null) return latestSnapshotProgressValue;
      if (goal.start_snapshot_value !== null) return goal.start_snapshot_value;
      return null;
    }
    if (typeof goal.total_progress_value === "number") {
      return goal.total_progress_value;
    }
    return goal.check_in_count;
  }, [goal, isWeightSnapshotGoal, latestSnapshotProgressValue]);

  const progressPercent = useMemo(() => {
    if (isWeightSnapshotGoal) {
      return calculateSnapshotProgressPercent({
        startValue: startSnapshotProgressValue,
        currentValue: progressCurrentValue,
        targetValue: progressTargetValue,
      });
    }
    if (!progressTargetValue || progressTargetValue <= 0) return 0;
    if (progressCurrentValue === null || progressCurrentValue < 0) return 0;
    return Math.min(Math.round((progressCurrentValue / progressTargetValue) * 100), 100);
  }, [
    isWeightSnapshotGoal,
    progressCurrentValue,
    progressTargetValue,
    startSnapshotProgressValue,
  ]);
  const totalSponsoredCents = useMemo(
    () =>
      publicSponsorPledges.reduce((sum, pledge) => sum + Math.max(pledge.amount_cents, 0), 0),
    [publicSponsorPledges]
  );
  const hasVerifiedSponsor = useMemo(
    () => publicSponsorPledges.some((pledge) => pledge.approval_at !== null),
    [publicSponsorPledges]
  );
  const criteriaByPledgeId = useMemo(() => {
    const grouped = new Map<string, SponsorCriteriaNote[]>();
    for (const note of sponsorCriteriaNotes) {
      const current = grouped.get(note.pledge_id) ?? [];
      current.push(note);
      grouped.set(note.pledge_id, current);
    }
    return grouped;
  }, [sponsorCriteriaNotes]);

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

  const loadComments = useCallback(async (id: string) => {
    setCommentsLoading(true);
    setCommentsError(null);

    const { data, error: commentsError } = await supabase
      .from("comments")
      .select("id,text,created_at,author_id")
      .eq("goal_id", id)
      .order("created_at", { ascending: false });

    if (commentsError) {
      setCommentsError(commentsError.message);
      setComments([]);
    } else {
      setComments(data ?? []);
    }

    setCommentsLoading(false);
  }, []);

  const loadGoal = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

    const { data, error: goalError } = await supabase
      .from("goals")
      .select("*")
      .eq("id", id)
      .single();

    if (goalError || !data || data.privacy !== "public") {
      setError("Goal not found or private.");
      setGoal(null);
      setLoading(false);
      return;
    }

    setGoal(data);
    setLatestSnapshotProgressValue(null);
    setStartSnapshotProgressValue(
      typeof data.start_snapshot_value === "number" ? data.start_snapshot_value : null
    );
    setLoading(false);
    await loadComments(id);

    if (isWeightSnapshotPreset(data.count_unit_preset)) {
      const [latestSnapshotResult, startSnapshotResult] = await Promise.all([
        supabase
          .from("check_ins")
          .select("progress_snapshot_value,check_in_at")
          .eq("goal_id", id)
          .not("progress_snapshot_value", "is", null)
          .order("check_in_at", { ascending: false })
          .limit(1),
        supabase
          .from("check_ins")
          .select("progress_snapshot_value,check_in_at")
          .eq("goal_id", id)
          .not("progress_snapshot_value", "is", null)
          .order("check_in_at", { ascending: true })
          .limit(1),
      ]);

      if (!latestSnapshotResult.error) {
        const latestSnapshot = latestSnapshotResult.data?.[0]?.progress_snapshot_value;
        setLatestSnapshotProgressValue(
          typeof latestSnapshot === "number" ? latestSnapshot : null
        );
      }
      if (
        !startSnapshotResult.error &&
        typeof data.start_snapshot_value !== "number"
      ) {
        const startSnapshot = startSnapshotResult.data?.[0]?.progress_snapshot_value;
        setStartSnapshotProgressValue(typeof startSnapshot === "number" ? startSnapshot : null);
      }
    }

    const { data: nftData } = await supabase
      .from("completion_nfts")
      .select("id,token_id,tx_hash,created_at")
      .eq("goal_id", id)
      .maybeSingle();

    setCompletionNft(nftData ?? null);
  }, [loadComments]);

  const loadSponsorPledges = useCallback(async (id: string, userId: string) => {
    const { data, error: pledgeError } = await supabase
      .from("pledges")
      .select(
        "id,amount_cents,deadline_at,min_check_ins,status,accepted_at,approval_at,settled_at,created_at"
      )
      .eq("goal_id", id)
      .eq("sponsor_id", userId)
      .order("created_at", { ascending: false });

    if (pledgeError) {
      setSponsorError(pledgeError.message);
      setSponsorPledges([]);
      return;
    }

    setSponsorPledges(data ?? []);
  }, []);

  const loadPublicSponsorData = useCallback(async (id: string) => {
    setPublicSponsorError(null);

    const [publicPledgesResult, criteriaResult] = await Promise.all([
      supabase
        .from("pledges")
        .select("id,amount_cents,deadline_at,min_check_ins,status,approval_at,created_at")
        .eq("goal_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("sponsor_criteria")
        .select("id,pledge_id,text,created_at,pledges!inner(goal_id)")
        .eq("pledges.goal_id", id)
        .order("created_at", { ascending: false }),
    ]);

    if (publicPledgesResult.error) {
      setPublicSponsorError(publicPledgesResult.error.message);
      setPublicSponsorPledges([]);
    } else {
      setPublicSponsorPledges((publicPledgesResult.data ?? []) as PublicSponsorPledge[]);
    }

    if (criteriaResult.error) {
      if (!publicPledgesResult.error) {
        setPublicSponsorError(criteriaResult.error.message);
      }
      setSponsorCriteriaNotes([]);
    } else {
      const normalized = (criteriaResult.data ?? []).map((row) => ({
        id: row.id,
        pledge_id: row.pledge_id,
        text: row.text,
        created_at: row.created_at,
      })) as SponsorCriteriaNote[];
      setSponsorCriteriaNotes(normalized);
    }
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

  useEffect(() => {
    if (!goalId || !session?.user?.id) return;
    const timeoutId = setTimeout(() => {
      void loadSponsorPledges(goalId, session.user.id);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [goalId, session?.user?.id, loadSponsorPledges]);

  useEffect(() => {
    if (!goalId) return;
    const timeoutId = setTimeout(() => {
      void loadPublicSponsorData(goalId);
    }, 0);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [goalId, loadPublicSponsorData]);

  useEffect(() => {
    if (!goal?.completed_at || sponsorPledges.length === 0) return;
    const completedAt = new Date(goal.completed_at);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();

    const overdue = sponsorPledges.filter(
      (pledge) =>
        pledge.status === "accepted" &&
        completedAt.getTime() + sevenDaysMs < now.getTime()
    );

    if (overdue.length === 0) return;

    const settleOverdue = async () => {
      await supabase
        .from("pledges")
        .update({ status: "settled", settled_at: new Date().toISOString() })
        .in(
          "id",
          overdue.map((pledge) => pledge.id)
        );
      await loadSponsorPledges(goalId, session?.user?.id as string);
    };

    void settleOverdue();
  }, [goal?.completed_at, sponsorPledges, goalId, session?.user?.id, loadSponsorPledges]);

  const handleCommentSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setCommentSubmitError(null);
    setCommentMessage(null);

    if (!session?.user?.id) {
      setCommentSubmitError("Sign in with your wallet to comment.");
      return;
    }

    if (!goalId) {
      setCommentSubmitError("Missing goal id.");
      return;
    }

    if (!commentText.trim()) {
      setCommentSubmitError("Comment text is required.");
      return;
    }

    const { error: insertError } = await supabase.from("comments").insert({
      goal_id: goalId,
      author_id: session.user.id,
      text: commentText.trim(),
    });

    if (insertError) {
      setCommentSubmitError(insertError.message);
      return;
    }

    setCommentText("");
    setCommentMessage("Comment posted.");
    await loadComments(goalId);
  };

  const handleApprove = async (pledgeId: string) => {
    setSponsorMessage(null);
    setSponsorError(null);
    setApprovingId(pledgeId);

    const { error: updateError } = await supabase
      .from("pledges")
      .update({
        status: "settled",
        approval_at: new Date().toISOString(),
        settled_at: new Date().toISOString(),
      })
      .eq("id", pledgeId);

    if (updateError) {
      setSponsorError(updateError.message);
      setApprovingId(null);
      return;
    }

    setSponsorMessage("Approval recorded. Escrow settled.");
    await loadSponsorPledges(goalId as string, session?.user?.id as string);
    await loadPublicSponsorData(goalId as string);
    setApprovingId(null);
  };

  const handlePledgeSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPledgeError(null);
    setPledgeMessage(null);

    if (!session?.user?.id) {
      setPledgeError("Sign in with your wallet to sponsor.");
      return;
    }

    if (!goalId) {
      setPledgeError("Missing goal id.");
      return;
    }

    const amountValue =
      pledgeAmountMode === "custom" ? Number(customAmount) : pledgeAmount;

    if (!amountValue || Number.isNaN(amountValue) || amountValue < 5) {
      setPledgeError("Pledge amount must be at least $5.");
      return;
    }

    if (!pledgeDeadline) {
      setPledgeError("Pledge deadline is required.");
      return;
    }

    const deadlineISO = new Date(`${pledgeDeadline}T00:00:00`).toISOString();
    const minCheckInsValue = minCheckIns ? Number(minCheckIns) : null;

    if (minCheckInsValue !== null && (Number.isNaN(minCheckInsValue) || minCheckInsValue < 0)) {
      setPledgeError("Minimum progress must be 0 or greater.");
      return;
    }

    setPledgeSubmitting(true);

    const { data: pledgeData, error: pledgeInsertError } = await supabase
      .from("pledges")
      .insert({
        goal_id: goalId,
        sponsor_id: session.user.id,
        amount_cents: Math.round(amountValue * 100),
        deadline_at: deadlineISO,
        min_check_ins: minCheckInsValue,
        status: "offered",
      })
      .select("id")
      .single();

    if (pledgeInsertError || !pledgeData?.id) {
      setPledgeError(pledgeInsertError?.message ?? "Failed to create pledge.");
      setPledgeSubmitting(false);
      return;
    }

    const criteria = criteriaText.trim();
    if (criteria) {
      const { error: criteriaError } = await supabase
        .from("sponsor_criteria")
        .insert({
          pledge_id: pledgeData.id,
          text: criteria,
        });

      if (criteriaError) {
        await supabase.from("pledges").delete().eq("id", pledgeData.id);
        setPledgeError("Failed to save sponsor criteria. Please try again.");
        setPledgeSubmitting(false);
        return;
      }
    }

    setPledgeMessage("Sponsorship offer sent.");
    setPledgeSubmitting(false);
    setPledgeAmount(10);
    setPledgeAmountMode("preset");
    setCustomAmount("");
    setPledgeDeadline("");
    setMinCheckIns("");
    setCriteriaText("");
    await loadPublicSponsorData(goalId);
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
              Back to Baseline
            </Link>
          </div>
          <div className={styles.metaRow}>
            <span className={styles.pill}>Public goal</span>
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
              {goal.description ? (
                <div className={styles.description}>{goal.description}</div>
              ) : null}
              <div className={styles.metaRow}>
                <span className={styles.pill}>{goal.model_type}</span>
                <span className={styles.pill}>
                  {cadenceLabel(goal.cadence)}
                  {cadenceRollupHint ? " (cumulative)" : ""}
                </span>
                <span className={styles.pill}>{goal.status}</span>
                {completionNft ? (
                  <span className={styles.pill}>Completion NFT</span>
                ) : null}
                {hasVerifiedSponsor ? (
                  <span className={styles.pill}>Verified by sponsor</span>
                ) : null}
                {goal.completed_at ? (
                  <span className={styles.pill}>
                    Completed {new Date(goal.completed_at).toLocaleDateString()}
                  </span>
                ) : null}
                {goal.start_at ? (
                  <span className={styles.pill}>
                    Starts {new Date(goal.start_at).toLocaleDateString()}
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
                {goalTags.map((tag) => (
                  <span key={tag} className={styles.pill}>
                    #{tag}
                  </span>
                ))}
              </div>
              <div className={styles.progressWrap}>
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className={styles.progressLabel}>
                  {progressTargetValue
                    ? isWeightSnapshotGoal
                      ? `${progressPercent}% to goal weight ${formatMetricValue(progressTargetValue)}`
                      : `${progressPercent}% of ${progressTargetValue} ${goalUnitLabel}${
                          cadenceRollupHint ? " (cumulative target)" : ""
                        }`
                    : "Target not set yet"}
                </div>
                <div className={styles.progressMeta}>
                  {progressCurrentValue !== null
                    ? isWeightSnapshotGoal
                      ? `Current weight: ${formatMetricValue(progressCurrentValue)}${
                          startSnapshotProgressValue !== null
                            ? ` (started ${formatMetricValue(startSnapshotProgressValue)})`
                            : ""
                        }`
                      : `Logged: ${progressCurrentValue} ${goalUnitLabel}`
                    : `${goal.check_in_count} check-ins logged`}
                </div>
                {!isWeightSnapshotGoal && cadenceRollupHint ? (
                  <div className={styles.progressMeta}>{cadenceRollupHint}</div>
                ) : null}
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.sectionTitle}>Sponsor activity</div>
              {publicSponsorError ? (
                <div className={styles.message}>{publicSponsorError}</div>
              ) : null}
              {publicSponsorPledges.length === 0 ? (
                <div className={styles.empty}>No sponsorships yet.</div>
              ) : (
                <>
                  <div className={styles.progressMeta}>
                    {publicSponsorPledges.length} sponsor
                    {publicSponsorPledges.length === 1 ? "" : "s"} · $
                    {Math.round(totalSponsoredCents / 100)} total offered
                    {hasVerifiedSponsor ? " · verified by sponsor" : ""}
                  </div>
                  <div className={styles.list}>
                    {publicSponsorPledges.map((pledge, index) => {
                      const criteria = criteriaByPledgeId.get(pledge.id) ?? [];
                      return (
                        <div key={pledge.id} className={styles.listItem}>
                          <div className={styles.listMeta}>
                            Sponsor #{index + 1} · Offered{" "}
                            {new Date(pledge.created_at).toLocaleDateString()}
                          </div>
                          <div>
                            ${Math.round(pledge.amount_cents / 100)} ·{" "}
                            {pledge.status === "settled" && !pledge.approval_at
                              ? "settled (no response)"
                              : pledge.status}
                          </div>
                          {pledge.min_check_ins !== null ? (
                            <div className={styles.listMeta}>
                              Minimum progress: {pledge.min_check_ins} {minProgressUnitLabel}
                            </div>
                          ) : null}
                          <div className={styles.listMeta}>
                            Offer deadline {new Date(pledge.deadline_at).toLocaleDateString()}
                          </div>
                          {criteria.map((note) => (
                            <div key={note.id} className={styles.listMeta}>
                              Criteria: {note.text}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            <section className={styles.card}>
              <div className={styles.sectionTitle}>Sponsor this goal</div>
              {session ? (
                <form className={styles.form} onSubmit={handlePledgeSubmit}>
                  <div className={styles.field}>
                    <label className={styles.label}>Pledge amount</label>
                    <div className={styles.amountGrid}>
                      {pledgePresets.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          className={`${styles.amountButton} ${
                            pledgeAmountMode === "preset" && pledgeAmount === amount
                              ? styles.amountButtonActive
                              : ""
                          }`}
                          onClick={() => {
                            setPledgeAmount(amount);
                            setPledgeAmountMode("preset");
                          }}
                        >
                          ${amount}
                        </button>
                      ))}
                      <div className={styles.customAmount}>
                        <span className={styles.customLabel}>Custom</span>
                        <input
                          type="number"
                          min="5"
                          step="1"
                          className={styles.input}
                          value={customAmount}
                          onChange={(event) => {
                            setCustomAmount(event.target.value);
                            setPledgeAmountMode("custom");
                          }}
                          placeholder="5+"
                        />
                      </div>
                    </div>
                  </div>

                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="pledge-deadline">
                        Pledge deadline
                      </label>
                      <input
                        id="pledge-deadline"
                        type="date"
                        className={styles.input}
                        value={pledgeDeadline}
                        onChange={(event) => setPledgeDeadline(event.target.value)}
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="pledge-min-progress">
                        Minimum progress ({minProgressUnitLabel})
                      </label>
                      <input
                        id="pledge-min-progress"
                        type="number"
                        min="0"
                        step="1"
                        className={styles.input}
                        value={minCheckIns}
                        onChange={(event) => setMinCheckIns(event.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="pledge-criteria">
                      Criteria (optional)
                    </label>
                    <textarea
                      id="pledge-criteria"
                      className={styles.textarea}
                      value={criteriaText}
                      onChange={(event) => setCriteriaText(event.target.value)}
                      placeholder="Share any expectations (non-binding)."
                    />
                  </div>

                  {pledgeError ? <div className={styles.message}>{pledgeError}</div> : null}
                  {pledgeMessage ? (
                    <div className={`${styles.message} ${styles.success}`}>{pledgeMessage}</div>
                  ) : null}
                  <div className={styles.buttonRow}>
                    <button className={styles.buttonPrimary} type="submit" disabled={pledgeSubmitting}>
                      {pledgeSubmitting ? "Sending..." : "Send sponsorship offer"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className={styles.empty}>
                  Sign in with your wallet to sponsor this goal.
                </div>
              )}
            </section>

            {session ? (
              <section className={styles.card}>
                <div className={styles.sectionTitle}>Your sponsorships</div>
                {sponsorError ? <div className={styles.message}>{sponsorError}</div> : null}
                {sponsorMessage ? (
                  <div className={`${styles.message} ${styles.success}`}>
                    {sponsorMessage}
                  </div>
                ) : null}
                {sponsorPledges.length === 0 ? (
                  <div className={styles.empty}>
                    No sponsorships on this goal yet.
                  </div>
                ) : (
                  <div className={styles.list}>
                    {sponsorPledges.map((pledge) => {
                      const approvalExpired =
                        pledge.status === "settled" && !pledge.approval_at;

                      return (
                        <div key={pledge.id} className={styles.listItem}>
                          <div className={styles.listMeta}>
                            Offer {new Date(pledge.created_at).toLocaleDateString()}
                          </div>
                          <div>
                            ${Math.round(pledge.amount_cents / 100)} ·{" "}
                            {pledge.status === "settled" && !pledge.approval_at
                              ? "settled (no response)"
                              : pledge.status}
                          </div>
                          {goal?.completed_at && pledge.status === "accepted" ? (
                            <div className={styles.listMeta}>
                              Approval window is open for 7 days after completion.
                            </div>
                          ) : null}
                          {pledge.min_check_ins !== null ? (
                            <div className={styles.listMeta}>
                              Minimum progress: {pledge.min_check_ins} {minProgressUnitLabel}
                            </div>
                          ) : null}
                          <div className={styles.buttonRow}>
                            <button
                              className={styles.buttonPrimary}
                              type="button"
                              onClick={() => handleApprove(pledge.id)}
                              disabled={
                                pledge.status !== "accepted" ||
                                !goal?.completed_at ||
                                approvalExpired ||
                                approvingId === pledge.id
                              }
                            >
                              {pledge.status === "accepted"
                                ? approvingId === pledge.id
                                  ? "Approving..."
                                  : "Approve completion"
                                : "Approval unavailable"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}

            <section className={styles.card}>
              <div className={styles.sectionTitle}>Comments</div>
              {session ? (
                <form className={styles.form} onSubmit={handleCommentSubmit}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="comment-text">
                      Add a comment
                    </label>
                    <textarea
                      id="comment-text"
                      className={styles.textarea}
                      value={commentText}
                      onChange={(event) => setCommentText(event.target.value)}
                      placeholder="Share encouragement or a quick note."
                    />
                  </div>
                  {commentSubmitError ? (
                    <div className={styles.message}>{commentSubmitError}</div>
                  ) : null}
                  {commentMessage ? (
                    <div className={`${styles.message} ${styles.success}`}>{commentMessage}</div>
                  ) : null}
                  <div className={styles.buttonRow}>
                    <button className={styles.buttonPrimary} type="submit">
                      Post comment
                    </button>
                  </div>
                </form>
              ) : (
                <div className={styles.empty}>
                  Sign in with your wallet to comment.
                </div>
              )}

              {commentsLoading ? (
                <div className={styles.message}>Loading comments...</div>
              ) : commentsError ? (
                <div className={styles.message}>{commentsError}</div>
              ) : comments.length === 0 ? (
                <div className={styles.empty}>No comments yet.</div>
              ) : (
                <div className={styles.list}>
                  {comments.map((comment) => (
                    <div key={comment.id} className={styles.listItem}>
                      <div className={styles.listMeta}>
                        Supporter · {new Date(comment.created_at).toLocaleString()}
                      </div>
                      <div>{comment.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <div className={styles.card}>Goal not found or private.</div>
        )}
      </div>
    </div>
  );
}
