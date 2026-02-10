"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import styles from "./publicGoal.module.css";

type GoalModelType = "count" | "time" | "milestone";

type Goal = {
  id: string;
  title: string;
  description: string | null;
  start_at: string | null;
  completed_at: string | null;
  deadline_at: string;
  model_type: GoalModelType;
  target_value: number | null;
  target_unit: string | null;
  privacy: "private" | "public";
  status: "active" | "completed" | "archived";
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
  status: "offered" | "accepted" | "settled" | "expired" | "cancelled";
  accepted_at: string | null;
  approval_at: string | null;
  settled_at: string | null;
  created_at: string;
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
  const [sponsorMessage, setSponsorMessage] = useState<string | null>(null);
  const [sponsorError, setSponsorError] = useState<string | null>(null);
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

  const pledgePresets = [5, 10, 20, 50, 100];

  const progressPercent = useMemo(() => {
    if (!goal?.target_value || goal.target_value <= 0) return 0;
    return Math.min(Math.round((goal.check_in_count / goal.target_value) * 100), 100);
  }, [goal]);

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

  const loadComments = async (id: string) => {
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
  };

  const loadGoal = async (id: string) => {
    setLoading(true);
    setError(null);

    const { data, error: goalError } = await supabase
      .from("goals")
        .select(
          "id,title,description,start_at,completed_at,deadline_at,model_type,target_value,target_unit,privacy,status,check_in_count,created_at"
        )
      .eq("id", id)
      .single();

    if (goalError || !data || data.privacy !== "public") {
      setError("Goal not found or private.");
      setGoal(null);
      setLoading(false);
      return;
    }

    setGoal(data);
    setLoading(false);
    await loadComments(id);

    const { data: nftData } = await supabase
      .from("completion_nfts")
      .select("id,token_id,tx_hash,created_at")
      .eq("goal_id", id)
      .maybeSingle();

    setCompletionNft(nftData ?? null);
  };

  const loadSponsorPledges = async (id: string, userId: string) => {
    const { data, error: pledgeError } = await supabase
      .from("pledges")
      .select(
        "id,amount_cents,deadline_at,status,accepted_at,approval_at,settled_at,created_at"
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
  };

  useEffect(() => {
    if (!goalId) return;
    void loadGoal(goalId);
  }, [goalId]);

  useEffect(() => {
    if (!goalId || !session?.user?.id) return;
    void loadSponsorPledges(goalId, session.user.id);
  }, [goalId, session?.user?.id]);

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
  }, [goal?.completed_at, sponsorPledges, goalId, session?.user?.id]);

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
      setPledgeError("Minimum check-ins must be 0 or greater.");
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
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <div className={styles.brand}>Baseline</div>
            <div className={styles.tagline}>Invest in each other's success.</div>
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
                <span className={styles.pill}>{goal.status}</span>
                {completionNft ? (
                  <span className={styles.pill}>Completion NFT</span>
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
              </div>
              <div className={styles.progressWrap}>
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className={styles.progressLabel}>
                  {goal.target_value
                    ? `${progressPercent}% of ${goal.target_value} ${
                        goal.target_unit ?? "check-ins"
                      }`
                    : "Target not set yet"}
                </div>
                <div className={styles.progressMeta}>
                  {goal.check_in_count} check-ins logged
                </div>
              </div>
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
                      <label className={styles.label} htmlFor="pledge-min-checkins">
                        Minimum check-ins
                      </label>
                      <input
                        id="pledge-min-checkins"
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
                      const completedAt = goal?.completed_at
                        ? new Date(goal.completed_at)
                        : null;
                      const daysLeft =
                        completedAt && pledge.status === "accepted"
                          ? Math.max(
                              0,
                              Math.ceil(
                                (completedAt.getTime() +
                                  7 * 24 * 60 * 60 * 1000 -
                                  Date.now()) /
                                  (24 * 60 * 60 * 1000)
                              )
                            )
                          : null;
                      const approvalExpired = daysLeft !== null && daysLeft <= 0;

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
                              {approvalExpired
                                ? "Approval window ended."
                                : `Approval window: ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
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
