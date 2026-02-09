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
          "id,title,description,start_at,deadline_at,model_type,target_value,target_unit,privacy,status,check_in_count,created_at"
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
  };

  useEffect(() => {
    if (!goalId) return;
    void loadGoal(goalId);
  }, [goalId]);

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
              <div className={styles.sectionTitle}>Sponsors</div>
              <div className={styles.empty}>Sponsor list will appear here soon.</div>
            </section>

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
