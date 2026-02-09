"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { logEvent } from "@/lib/eventLogger";
import styles from "./goal.module.css";

type GoalModelType = "count" | "time" | "milestone";

type Goal = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  start_at: string | null;
  deadline_at: string;
  model_type: GoalModelType;
  target_value: number | null;
  target_unit: string | null;
  privacy: "private" | "public";
  status: "active" | "completed" | "archived";
  created_at: string;
};

type CheckIn = {
  id: string;
  check_in_at: string;
  note: string | null;
  proof_hash: string | null;
  created_at: string;
};

export default function GoalPage() {
  const params = useParams<{ id: string }>();
  const goalId = params?.id;
  const [session, setSession] = useState<Session | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [proofHash, setProofHash] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [privacyUpdating, setPrivacyUpdating] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState<string | null>(null);
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  const walletAddress = session?.user?.user_metadata?.wallet_address as
    | string
    | undefined;

  const progressPercent = useMemo(() => {
    if (!goal?.target_value || goal.target_value <= 0) return 0;
    return Math.min(Math.round((checkIns.length / goal.target_value) * 100), 100);
  }, [goal, checkIns.length]);

  const isOwner = Boolean(session?.user?.id && goal?.user_id === session.user.id);

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

  const loadGoal = async (id: string) => {
    setLoading(true);
    setError(null);
    const { data, error: goalError } = await supabase
      .from("goals")
      .select(
        "id,user_id,title,description,start_at,deadline_at,model_type,target_value,target_unit,privacy,status,created_at"
      )
      .eq("id", id)
      .single();

    if (goalError) {
      setError(goalError.message);
      setGoal(null);
      setCheckIns([]);
      setLoading(false);
      return;
    }

    setGoal(data);

    setCheckInError(null);
    const { data: checkInData, error: checkInError } = await supabase
      .from("check_ins")
      .select("id,check_in_at,note,proof_hash,created_at")
      .eq("goal_id", id)
      .order("check_in_at", { ascending: false });

    if (checkInError) {
      setCheckInError(checkInError.message);
      setCheckIns([]);
    } else {
      setCheckIns(checkInData ?? []);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (!goalId) return;
    void loadGoal(goalId);
  }, [goalId]);

  const handleCheckIn = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    setSubmitMessage(null);

    if (!session?.user?.id) {
      setSubmitError("Sign in to add a check-in.");
      return;
    }

    if (!goalId) {
      setSubmitError("Missing goal id.");
      return;
    }

    const { error: insertError } = await supabase.from("check_ins").insert({
      goal_id: goalId,
      user_id: session.user.id,
      check_in_at: new Date().toISOString(),
      note: note.trim() || null,
      proof_hash: proofHash.trim() || null,
    });

    if (insertError) {
      setSubmitError(insertError.message);
      return;
    }

    if (goal) {
      const { error: eventError } = await logEvent({
        eventType: "check_in.created",
        actorId: session.user.id,
        recipientId: goal.user_id,
        goalId: goal.id,
        data: {
          noteLength: note.trim().length,
        },
      });

      if (eventError) {
        console.warn("Failed to log check_in.created event", eventError);
      }
    }

    setNote("");
    setProofHash("");
    setSubmitMessage("Check-in saved.");
    if (goalId) {
      await loadGoal(goalId);
    }
  };

  const handleTogglePrivacy = async () => {
    if (!goal || !session?.user?.id) return;
    const nextPrivacy = goal.privacy === "public" ? "private" : "public";

    if (
      nextPrivacy === "public" &&
      !window.confirm("Make this goal public so others can view and sponsor it?")
    ) {
      return;
    }

    setPrivacyUpdating(true);
    setPrivacyError(null);
    setPrivacyMessage(null);

    const { data, error: updateError } = await supabase
      .from("goals")
      .update({ privacy: nextPrivacy })
      .eq("id", goal.id)
      .select(
        "id,user_id,title,description,start_at,deadline_at,model_type,target_value,target_unit,privacy,status,created_at"
      )
      .single();

    if (updateError) {
      setPrivacyError(updateError.message);
      setPrivacyUpdating(false);
      return;
    }

    setGoal(data);
    setPrivacyMessage(
      nextPrivacy === "public"
        ? "Goal is now public."
        : "Goal is now private."
    );
    setPrivacyUpdating(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <div className={styles.brand}>Baseline</div>
            <div className={styles.tagline}>Invest in each other's success.</div>
            <Link href="/" className={styles.backLink}>
              Back to dashboard
            </Link>
          </div>
          <div className={styles.metaRow}>
            {walletAddress ? (
              <span className={styles.pill}>
                Wallet {`${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`}
              </span>
            ) : session?.user?.email ? (
              <span className={styles.pill}>{session.user.email}</span>
            ) : (
              <span className={styles.pill}>Sign in required</span>
            )}
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
              <div className={styles.metaRow}>
                <span className={styles.pill}>{goal.model_type}</span>
                <span className={styles.pill}>{goal.privacy}</span>
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
              </div>
            </section>

            {isOwner ? (
              <section className={styles.card}>
                <div className={styles.sectionTitle}>Visibility</div>
                <div className={styles.visibilityRow}>
                  <div className={styles.visibilityText}>
                    <div className={styles.visibilityLabel}>
                      {goal.privacy === "public" ? "Public goal" : "Private goal"}
                    </div>
                    <div className={styles.visibilityHint}>
                      Public goals can receive comments and sponsorship.
                    </div>
                  </div>
                  <div className={styles.buttonRow}>
                    {goal.privacy === "public" ? (
                      <Link
                        href={`/public/goals/${goal.id}`}
                        className={`${styles.buttonGhost} ${styles.linkButton}`}
                      >
                        View public page
                      </Link>
                    ) : null}
                    <button
                      className={styles.buttonPrimary}
                      type="button"
                      onClick={handleTogglePrivacy}
                      disabled={privacyUpdating}
                    >
                      {privacyUpdating
                        ? "Updating..."
                        : goal.privacy === "public"
                          ? "Make private"
                          : "Make public"}
                    </button>
                  </div>
                </div>
                {privacyError ? <div className={styles.message}>{privacyError}</div> : null}
                {privacyMessage ? (
                  <div className={`${styles.message} ${styles.success}`}>
                    {privacyMessage}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className={styles.card}>
              <div className={styles.sectionTitle}>Add check-in</div>
              <form className={styles.form} onSubmit={handleCheckIn}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="checkin-note">
                    Note (optional)
                  </label>
                  <textarea
                    id="checkin-note"
                    className={styles.textarea}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="What moved you forward today?"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="checkin-proof">
                    Proof hash (optional)
                  </label>
                  <input
                    id="checkin-proof"
                    className={styles.input}
                    value={proofHash}
                    onChange={(event) => setProofHash(event.target.value)}
                    placeholder="0x..."
                  />
                </div>
                {submitError ? <div className={styles.message}>{submitError}</div> : null}
                {submitMessage ? (
                  <div className={`${styles.message} ${styles.success}`}>{submitMessage}</div>
                ) : null}
                <div className={styles.buttonRow}>
                  <button className={styles.buttonPrimary} type="submit">
                    Save check-in
                  </button>
                </div>
              </form>
            </section>

            <section className={styles.card}>
              <div className={styles.sectionTitle}>Recent check-ins</div>
              {checkInError ? <div className={styles.message}>{checkInError}</div> : null}
              {checkIns.length === 0 ? (
                <div className={styles.empty}>No check-ins yet.</div>
              ) : (
                <div className={styles.list}>
                  {checkIns.map((checkIn) => (
                    <div key={checkIn.id} className={styles.listItem}>
                      <div className={styles.listMeta}>
                        {new Date(checkIn.check_in_at).toLocaleString()}
                      </div>
                      <div>{checkIn.note || "No note"}</div>
                      {checkIn.proof_hash ? (
                        <div className={styles.listMeta}>{checkIn.proof_hash}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <div className={styles.card}>Goal not found.</div>
        )}
      </div>
    </div>
  );
}
