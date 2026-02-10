"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { BASELINE_TAGLINE } from "@/lib/brand";
import { supabase } from "@/lib/supabaseClient";
import styles from "./offers.module.css";

type Goal = {
  id: string;
  user_id: string;
  title: string;
  privacy: "private" | "public";
  status: "active" | "completed" | "archived";
  completed_at: string | null;
};

type PledgeStatus = "offered" | "accepted" | "settled" | "expired" | "cancelled";

type Pledge = {
  id: string;
  amount_cents: number;
  deadline_at: string;
  min_check_ins: number | null;
  status: PledgeStatus;
  created_at: string;
  accepted_at: string | null;
  approval_at: string | null;
  settled_at: string | null;
  sponsor_id: string;
};

export default function GoalOffersPage() {
  const params = useParams<{ id: string }>();
  const goalId = params?.id;
  const [session, setSession] = useState<Session | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const activeOffers = useMemo(
    () => pledges.filter((pledge) => pledge.status === "offered"),
    [pledges]
  );

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
    const { data, error: goalError } = await supabase
      .from("goals")
      .select("*")
      .eq("id", id)
      .single();

    if (goalError) {
      setError(goalError.message);
      setGoal(null);
      return;
    }

    setGoal(data);
  };

  const loadPledges = async (id: string) => {
    const { data, error: pledgeError } = await supabase
      .from("pledges")
      .select(
        "id,amount_cents,deadline_at,min_check_ins,status,created_at,accepted_at,approval_at,settled_at,sponsor_id"
      )
      .eq("goal_id", id)
      .order("amount_cents", { ascending: false })
      .order("created_at", { ascending: false });

    if (pledgeError) {
      setError(pledgeError.message);
      setPledges([]);
      return;
    }

    setPledges(data ?? []);
  };

  const expireOverdueOffers = async (items: Pledge[]) => {
    const now = new Date();
    const overdueIds = items
      .filter((pledge) =>
        pledge.status === "offered" && new Date(pledge.deadline_at) < now
      )
      .map((pledge) => pledge.id);

    if (overdueIds.length === 0) return;

    const { error: expireError } = await supabase
      .from("pledges")
      .update({ status: "expired" })
      .in("id", overdueIds);

    if (!expireError) {
      setPledges((current) =>
        current.map((pledge) =>
          overdueIds.includes(pledge.id)
            ? { ...pledge, status: "expired" }
            : pledge
        )
      );
    }
  };

  useEffect(() => {
    if (!goalId) return;
    const timeoutId = setTimeout(() => {
      setLoading(true);
      setError(null);

      const loadAll = async () => {
        await loadGoal(goalId);
        await loadPledges(goalId);
        setLoading(false);
      };

      void loadAll();
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [goalId]);

  useEffect(() => {
    if (pledges.length === 0) return;
    const timeoutId = setTimeout(() => {
      void expireOverdueOffers(pledges);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [pledges]);

  useEffect(() => {
    if (!goal?.completed_at || pledges.length === 0) return;
    const completedAt = new Date(goal.completed_at);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();

    const overdue = pledges.filter(
      (pledge) =>
        pledge.status === "accepted" &&
        completedAt.getTime() + sevenDaysMs < now.getTime()
    );

    if (overdue.length === 0) return;

    const settleOverdue = async () => {
      const { error: settleError } = await supabase
        .from("pledges")
        .update({ status: "settled", settled_at: new Date().toISOString() })
        .in(
          "id",
          overdue.map((pledge) => pledge.id)
        );

      if (!settleError) {
        setPledges((current) =>
          current.map((pledge) =>
            overdue.some((item) => item.id === pledge.id)
              ? { ...pledge, status: "settled" }
              : pledge
          )
        );
      }
    };

    void settleOverdue();
  }, [goal?.completed_at, pledges]);

  const handleAccept = async (pledgeId: string) => {
    setActionMessage(null);
    setActionError(null);
    setAcceptingId(pledgeId);
    const acceptedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("pledges")
      .update({
        status: "accepted",
        accepted_at: acceptedAt,
        escrow_tx: `mock:${acceptedAt}`,
      })
      .eq("id", pledgeId);

    if (updateError) {
      setActionError(updateError.message);
      setAcceptingId(null);
      return;
    }

    setActionMessage("Offer accepted. Escrow created.");
    await loadPledges(goalId as string);
    setAcceptingId(null);
  };

  const formatMoney = (cents: number) => `$${(cents / 100).toFixed(0)}`;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <div className={styles.brand}>Baseline</div>
            <div className={styles.tagline}>{BASELINE_TAGLINE}</div>
            <Link href={`/goals/${goalId ?? ""}`} className={styles.backLink}>
              Back to goal
            </Link>
          </div>
        </header>

        {loading ? (
          <div className={styles.card}>Loading offers...</div>
        ) : error ? (
          <div className={styles.card}>{error}</div>
        ) : !goal ? (
          <div className={styles.card}>Goal not found.</div>
        ) : session?.user?.id !== goal.user_id ? (
          <div className={styles.card}>You do not have access to this page.</div>
        ) : (
          <>
            <section className={styles.card}>
              <div className={styles.title}>Offers for {goal.title}</div>
              <div className={styles.metaRow}>
                <span className={styles.pill}>{goal.privacy}</span>
                <span className={styles.pill}>{goal.status}</span>
                <span className={styles.pill}>{activeOffers.length} active</span>
              </div>
              <div className={styles.notice}>
                Accepting an offer creates escrow (mocked for now). Offers are sorted by amount.
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.sectionTitle}>Offers</div>
              {actionError ? <div className={styles.message}>{actionError}</div> : null}
              {actionMessage ? (
                <div className={`${styles.message} ${styles.success}`}>{actionMessage}</div>
              ) : null}
              {pledges.length === 0 ? (
                <div className={styles.empty}>No offers yet.</div>
              ) : (
                <div className={styles.list}>
                  {pledges.map((pledge) => (
                    <div key={pledge.id} className={styles.listItem}>
                      <div className={styles.listHead}>
                        <div className={styles.listAmount}>
                          {formatMoney(pledge.amount_cents)}
                        </div>
                        <span className={styles.statusPill}>{pledge.status}</span>
                      </div>
                      <div className={styles.listMeta}>
                        Sponsor · Created {new Date(pledge.created_at).toLocaleDateString()}
                      </div>
                      <div className={styles.listMeta}>
                        Status:{" "}
                        {pledge.status === "settled" && !pledge.approval_at
                          ? "settled (no response)"
                          : pledge.status}
                      </div>
                      <div className={styles.listMeta}>
                        Deadline {new Date(pledge.deadline_at).toLocaleDateString()}
                      </div>
                      {pledge.min_check_ins !== null ? (
                        <div className={styles.listMeta}>
                          Minimum check-ins: {pledge.min_check_ins}
                        </div>
                      ) : null}
                      <div className={styles.buttonRow}>
                        <button
                          className={styles.buttonPrimary}
                          type="button"
                          onClick={() => handleAccept(pledge.id)}
                          disabled={
                            pledge.status !== "offered" || acceptingId === pledge.id
                          }
                        >
                          {pledge.status === "offered"
                            ? acceptingId === pledge.id
                              ? "Accepting..."
                              : "Accept offer"
                            : "Offer locked"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
