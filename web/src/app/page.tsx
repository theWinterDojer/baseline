"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { SiweMessage } from "siwe";
import { useAccount, useChainId, useDisconnect, useSignMessage } from "wagmi";
import { supabase } from "@/lib/supabaseClient";
import { logEvent } from "@/lib/eventLogger";
import { BASELINE_TAGLINE } from "@/lib/brand";
import type { GoalModelType } from "@/lib/goalTypes";
import styles from "./page.module.css";

type Goal = {
  id: string;
  title: string;
  start_at: string | null;
  deadline_at: string;
  model_type: GoalModelType;
  target_value: number | null;
  target_unit: string | null;
  privacy: "private" | "public";
  status: "active" | "completed" | "archived";
  created_at: string;
};

const modelLabels: Record<GoalModelType, string> = {
  count: "Count-based",
  time: "Time-based",
  milestone: "Milestone-based",
};

export default function Home() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [walletAuthLoading, setWalletAuthLoading] = useState(false);
  const [walletAuthError, setWalletAuthError] = useState<string | null>(null);
  const [lastAuthAddress, setLastAuthAddress] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState({
    title: "",
    hasStartDate: false,
    startDate: "",
    deadline: "",
    modelType: "count" as GoalModelType,
    targetValue: "",
    targetUnit: "",
  });
  const [goalError, setGoalError] = useState<string | null>(null);
  const [goalMessage, setGoalMessage] = useState<string | null>(null);

  const walletAddress =
    (session?.user?.user_metadata?.wallet_address as string | undefined) ??
    address;

  const formatAddress = (value: string) =>
    `${value.slice(0, 6)}...${value.slice(-4)}`;

  const userLabel = useMemo(() => {
    if (walletAddress) {
      return `Wallet ${formatAddress(walletAddress)}`;
    }
    if (session?.user?.email) {
      return session.user.email;
    }
    return "Signed in";
  }, [walletAddress, session?.user?.email]);

  const loadGoals = async (activeSession: Session | null) => {
    if (!activeSession) return;
    setGoalsLoading(true);
    const { data, error } = await supabase
      .from("goals")
      .select(
        "id,title,start_at,deadline_at,model_type,target_value,target_unit,privacy,status,created_at"
      )
      .order("created_at", { ascending: false });

    if (error) {
      setGoalError(error.message);
      setGoals([]);
    } else {
      setGoals(data ?? []);
    }
    setGoalsLoading(false);
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setInitializing(false);
      loadGoals(data.session ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setWalletAuthError(null);
        if (newSession) {
          loadGoals(newSession);
        } else {
          setGoals([]);
          setLastAuthAddress(null);
        }
      }
    );

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signInWithWallet = useCallback(async () => {
    if (!address) {
      setWalletAuthError("Connect a wallet to continue.");
      return;
    }

    setWalletAuthLoading(true);
    setWalletAuthError(null);
    setLastAuthAddress(address.toLowerCase());

    try {
      const nonceResponse = await fetch("/api/auth/siwe/nonce", {
        method: "POST",
      });
      const nonceData = await nonceResponse.json().catch(() => null);

      if (!nonceResponse.ok) {
        throw new Error(nonceData?.error ?? "Failed to request nonce.");
      }

      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to Baseline using your wallet.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce: nonceData.nonce,
      });

      const signature = await signMessageAsync({
        message: message.prepareMessage(),
      });

      const verifyResponse = await fetch("/api/auth/siwe/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.prepareMessage(),
          signature,
        }),
      });

      const verifyData = await verifyResponse.json().catch(() => null);

      if (!verifyResponse.ok) {
        throw new Error(verifyData?.error ?? "Wallet sign-in failed.");
      }

      if (!verifyData?.session) {
        throw new Error("Missing session from wallet sign-in.");
      }

      const { error } = await supabase.auth.setSession(verifyData.session);

      if (error) {
        throw error;
      }

    } catch (error) {
      setWalletAuthError(
        error instanceof Error ? error.message : "Wallet sign-in failed."
      );
    } finally {
      setWalletAuthLoading(false);
    }
  }, [address, chainId, signMessageAsync]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    disconnect();
  };

  const handleWalletRetry = () => {
    setLastAuthAddress(null);
    void signInWithWallet();
  };

  useEffect(() => {
    if (initializing || !isConnected || !address || session || walletAuthLoading) return;
    if (lastAuthAddress?.toLowerCase() === address.toLowerCase()) return;
    void signInWithWallet();
  }, [
    address,
    initializing,
    isConnected,
    lastAuthAddress,
    session,
    walletAuthLoading,
    signInWithWallet,
  ]);

  const handleCreateGoal = async (event: FormEvent) => {
    event.preventDefault();
    setGoalError(null);
    setGoalMessage(null);

    if (!session?.user?.id) {
      setGoalError("Sign in to create a goal.");
      return;
    }

    if (!goalForm.title.trim()) {
      setGoalError("Goal title is required.");
      return;
    }

    if (!goalForm.deadline) {
      setGoalError("Deadline is required.");
      return;
    }

    if (goalForm.hasStartDate && !goalForm.startDate) {
      setGoalError("Start date is required when enabled.");
      return;
    }

    const requiresTarget = goalForm.modelType !== "milestone";
    const targetValueNumber = requiresTarget
      ? Number(goalForm.targetValue)
      : null;

    if (requiresTarget && (!targetValueNumber || targetValueNumber <= 0)) {
      setGoalError("Goal value must be greater than 0.");
      return;
    }

    const startISO = goalForm.hasStartDate && goalForm.startDate
      ? new Date(`${goalForm.startDate}T00:00:00`).toISOString()
      : null;
    const deadlineISO = new Date(`${goalForm.deadline}T00:00:00`).toISOString();

    const { data: goalData, error } = await supabase
      .from("goals")
      .insert({
        user_id: session.user.id,
        title: goalForm.title.trim(),
        start_at: startISO,
        deadline_at: deadlineISO,
        model_type: goalForm.modelType,
        target_value: targetValueNumber,
        target_unit: goalForm.targetUnit.trim() || null,
        privacy: "private",
        status: "active",
      })
      .select("id")
      .single();

    if (error) {
      setGoalError(error.message);
      return;
    }

    if (goalData?.id) {
      const { error: eventError } = await logEvent({
        eventType: "goal.created",
        actorId: session.user.id,
        recipientId: session.user.id,
        goalId: goalData.id,
        data: {
          title: goalForm.title.trim(),
          modelType: goalForm.modelType,
        },
      });

      if (eventError) {
        console.warn("Failed to log goal.created event", eventError);
      }
    }

    setGoalForm({
      title: "",
      hasStartDate: false,
      startDate: "",
      deadline: "",
      modelType: "count",
      targetValue: "",
      targetUnit: "",
    });
    setGoalMessage("Goal created.");
    await loadGoals(session);
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <div className={styles.brand}>Baseline</div>
            <div className={styles.tagline}>{BASELINE_TAGLINE}</div>
          </div>
          {session ? (
            <div className={styles.buttonRow}>
              <span className={styles.pill}>{userLabel}</span>
              <Link className={`${styles.buttonGhost} ${styles.linkButton}`} href="/settings">
                Settings
              </Link>
              <button className={styles.buttonGhost} onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : null}
        </header>

        <div className={styles.main}>
          <section className={`${styles.panel} ${styles.delay1}`}>
            {!session ? (
              <>
                <h1 className={styles.panelHeading}>Start a goal that stays yours.</h1>
                <p className={styles.panelSubheading}>
                  Baseline is a private-first habit tracker with optional sponsorship. Keep your
                  progress off-chain, publish only when you want support.
                </p>
                <div className={styles.heroList}>
                  <span>
                    <span className={styles.dot} /> Private by default, public by choice
                  </span>
                  <span>
                    <span className={styles.dot} /> Flexible check-ins, no streak pressure
                  </span>
                  <span>
                    <span className={styles.dot} /> Deterministic payouts, minimal on-chain data
                  </span>
                </div>
              </>
            ) : (
              <>
                <h1 className={styles.panelHeading}>Create your first goal</h1>
                <p className={styles.panelSubheading}>
                  Keep it lightweight. You can publish for sponsorship when you are ready.
                </p>
                <form className={styles.form} onSubmit={handleCreateGoal}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="goal-title">
                      Goal title
                    </label>
                    <input
                      id="goal-title"
                      className={styles.input}
                      value={goalForm.title}
                      onChange={(event) =>
                        setGoalForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      placeholder="Run 12 miles by April"
                    />
                  </div>
                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="goal-deadline">
                        <span className={styles.labelInline}>
                          Deadline
                          <span className={styles.checkboxInline}>
                            <input
                              type="checkbox"
                              className={styles.checkbox}
                              checked={goalForm.hasStartDate}
                              onChange={(event) =>
                                setGoalForm((current) => ({
                                  ...current,
                                  hasStartDate: event.target.checked,
                                  startDate: event.target.checked ? current.startDate : "",
                                }))
                              }
                            />
                            Add start date
                          </span>
                        </span>
                      </label>
                      <input
                        id="goal-deadline"
                        type="date"
                        className={styles.input}
                        value={goalForm.deadline}
                        onChange={(event) =>
                          setGoalForm((current) => ({
                            ...current,
                            deadline: event.target.value,
                          }))
                        }
                      />
                    </div>
                    {goalForm.hasStartDate ? (
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="goal-start">
                          Start date
                        </label>
                        <input
                          id="goal-start"
                          type="date"
                          className={styles.input}
                          value={goalForm.startDate}
                          onChange={(event) =>
                            setGoalForm((current) => ({
                              ...current,
                              startDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ) : (
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="goal-model">
                          <span className={styles.labelRow}>
                            Model
                            <span className={styles.tooltip}>
                              <button
                                type="button"
                                className={styles.tooltipTrigger}
                                aria-label="Model help"
                              >
                                ?
                              </button>
                              <span className={styles.tooltipContent}>
                                <span className={styles.tooltipLine}>
                                  Model – Count-based: Track a number-based goal. e.g. Run 12
                                  miles by April or Lose 10 lbs this month.
                                </span>
                                <span className={styles.tooltipLine}>
                                  Model – Time-based: Track total time. e.g. 600 minutes of yoga
                                  in 30 days.
                                </span>
                                <span className={styles.tooltipLine}>
                                  Model – Milestone-based: Track steps by date. e.g. 5k in
                                  March, 10k in May.
                                </span>
                              </span>
                            </span>
                          </span>
                        </label>
                        <select
                          id="goal-model"
                          className={styles.select}
                          value={goalForm.modelType}
                          onChange={(event) =>
                            setGoalForm((current) => ({
                              ...current,
                              modelType: event.target.value as GoalModelType,
                            }))
                          }
                        >
                          <option value="count">Count-based</option>
                          <option value="time">Time-based</option>
                          <option value="milestone">Milestone-based</option>
                        </select>
                      </div>
                    )}
                  </div>
                  {goalForm.hasStartDate ? (
                    <div className={styles.row}>
                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="goal-model">
                          <span className={styles.labelRow}>
                            Model
                            <span className={styles.tooltip}>
                              <button
                                type="button"
                                className={styles.tooltipTrigger}
                                aria-label="Model help"
                              >
                                ?
                              </button>
                              <span className={styles.tooltipContent}>
                                <span className={styles.tooltipLine}>
                                  Model – Count-based: Track a number-based goal. e.g. Run 12
                                  miles by April or Lose 10 lbs this month.
                                </span>
                                <span className={styles.tooltipLine}>
                                  Model – Time-based: Track total time. e.g. 600 minutes of yoga
                                  in 30 days.
                                </span>
                                <span className={styles.tooltipLine}>
                                  Model – Milestone-based: Track steps by date. e.g. 5k in
                                  March, 10k in May.
                                </span>
                              </span>
                            </span>
                          </span>
                        </label>
                        <select
                          id="goal-model"
                          className={styles.select}
                          value={goalForm.modelType}
                          onChange={(event) =>
                            setGoalForm((current) => ({
                              ...current,
                              modelType: event.target.value as GoalModelType,
                            }))
                          }
                        >
                          <option value="count">Count-based</option>
                          <option value="time">Time-based</option>
                          <option value="milestone">Milestone-based</option>
                        </select>
                      </div>
                    </div>
                  ) : null}
                  <div className={styles.row}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="goal-target">
                        <span className={styles.labelRow}>
                          Goal value
                          <span className={styles.tooltip}>
                            <button
                              type="button"
                              className={styles.tooltipTrigger}
                              aria-label="Goal value help"
                            >
                              ?
                            </button>
                            <span className={styles.tooltipContent}>
                              <span className={styles.tooltipLine}>
                                The number of units you want to reach
                              </span>
                            </span>
                          </span>
                        </span>
                      </label>
                      <input
                        id="goal-target"
                        type="number"
                        className={styles.input}
                        value={goalForm.targetValue}
                        onChange={(event) =>
                          setGoalForm((current) => ({
                            ...current,
                            targetValue: event.target.value,
                          }))
                        }
                        placeholder="12"
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor="goal-unit">
                        <span className={styles.labelRow}>
                          Goal unit
                          <span className={styles.tooltip}>
                            <button
                              type="button"
                              className={styles.tooltipTrigger}
                              aria-label="Goal unit help"
                            >
                              ?
                            </button>
                            <span className={styles.tooltipContent}>
                              <span className={styles.tooltipLine}>
                                What the Goal Value represents. e.g. miles, lbs, minutes
                              </span>
                            </span>
                          </span>
                        </span>
                      </label>
                      <input
                        id="goal-unit"
                        className={styles.input}
                        value={goalForm.targetUnit}
                        onChange={(event) =>
                          setGoalForm((current) => ({
                            ...current,
                            targetUnit: event.target.value,
                          }))
                        }
                        placeholder="miles"
                      />
                    </div>
                  </div>
                  {goalError ? <div className={styles.message}>{goalError}</div> : null}
                  {goalMessage ? (
                    <div className={`${styles.message} ${styles.success}`}>{goalMessage}</div>
                  ) : null}
                  <div className={styles.buttonRow}>
                    <button className={styles.buttonPrimary} type="submit">
                      Save goal
                    </button>
                    <span className={styles.footerNote}>
                      Your goals stay private until you publish them.
                    </span>
                  </div>
                </form>
              </>
            )}
          </section>

          <section className={`${styles.panel} ${styles.delay2}`}>
            {!session ? (
              <>
                <h2 className={styles.panelHeading}>Connect your wallet</h2>
                <p className={styles.panelSubheading}>
                  Wallet connection is the primary sign-in. Attach email later in settings for
                  backup access.
                </p>
                <div className={styles.walletRow}>
                  <ConnectButton.Custom>
                    {({
                      account,
                      mounted,
                      openAccountModal,
                      openConnectModal,
                    }) => {
                      const ready = mounted;
                      const connected = ready && account;
                      return (
                        <button
                          type="button"
                          className={styles.buttonGhost}
                          onClick={connected ? openAccountModal : openConnectModal}
                          disabled={!ready}
                        >
                          {connected ? account.displayName : "Connect wallet"}
                        </button>
                      );
                    }}
                  </ConnectButton.Custom>
                  {isConnected ? (
                    <button
                      className={styles.buttonPrimary}
                      type="button"
                      onClick={signInWithWallet}
                      disabled={walletAuthLoading}
                    >
                      {walletAuthLoading ? "Signing in..." : "Sign in with wallet"}
                    </button>
                  ) : null}
                  {walletAuthError ? (
                    <button
                      className={styles.buttonGhost}
                      type="button"
                      onClick={handleWalletRetry}
                    >
                      Try again
                    </button>
                  ) : null}
                </div>
                {walletAuthError ? <div className={styles.message}>{walletAuthError}</div> : null}
                <div className={styles.walletNote}>
                  {isConnected
                    ? "Sign in to unlock goal creation and check-ins."
                    : "Connect a wallet to start."}
                </div>
              </>
            ) : (
              <>
                <h2 className={styles.panelHeading}>Your goals</h2>
                <p className={styles.panelSubheading}>
                  Review your goals and add check-ins as you go.
                </p>
                {initializing || goalsLoading ? (
                  <div className={styles.emptyState}>Loading your goals...</div>
                ) : goals.length === 0 ? (
                  <div className={styles.emptyState}>
                    No goals yet. Create your first goal to begin.
                  </div>
                ) : (
                  <div className={styles.goalList}>
                    {goals.map((goal) => (
                      <Link key={goal.id} href={`/goals/${goal.id}`} className={styles.goalCard}>
                        <div className={styles.goalMeta}>
                          {modelLabels[goal.model_type]} • {goal.privacy}
                          {goal.start_at
                            ? ` • Starts ${new Date(goal.start_at).toLocaleDateString()}`
                            : ""}
                        </div>
                        <div className={styles.goalTitle}>{goal.title}</div>
                        <div className={styles.goalFoot}>
                          <span>
                            Due {new Date(goal.deadline_at).toLocaleDateString()}
                          </span>
                          <span>
                            {goal.target_value
                              ? `${goal.target_value} ${goal.target_unit ?? "check-ins"}`
                              : ""}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                {goalError ? <div className={styles.message}>{goalError}</div> : null}
                <div className={`${styles.buttonRow} ${styles.discoverCtaRow}`}>
                  <Link className={`${styles.buttonGhost} ${styles.linkButton}`} href="/discover">
                    Browse public goals
                  </Link>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
