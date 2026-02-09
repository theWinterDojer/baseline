"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import styles from "./goal.module.css";

type GoalModelType = "count" | "time" | "milestone";

type Goal = {
  id: string;
  title: string;
  description: string | null;
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

  const walletAddress = session?.user?.user_metadata?.wallet_address as
    | string
    | undefined;

  const progressPercent = useMemo(() => {
    if (!goal?.target_value || goal.target_value <= 0) return 0;
    return Math.min(Math.round((checkIns.length / goal.target_value) * 100), 100);
  }, [goal, checkIns.length]);

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
        "id,title,description,deadline_at,model_type,target_value,target_unit,privacy,status,created_at"
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

    setNote("");
    setProofHash("");
    setSubmitMessage("Check-in saved.");
    if (goalId) {
      await loadGoal(goalId);
    }
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
