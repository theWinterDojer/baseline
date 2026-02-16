"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { BASELINE_TAGLINE } from "@/lib/brand";
import {
  SPONSORSHIP_NOTIFICATION_EVENT_TYPES,
  readSponsorshipEmailPreferences,
  withSponsorshipEmailPreferences,
  type SponsorshipEmailPreferences,
  type SponsorshipNotificationEventType,
} from "@/lib/notificationPreferences";
import { supabase } from "@/lib/supabaseClient";
import styles from "./settings.module.css";

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const toLower = (value: string) => value.trim().toLowerCase();
const isWalletPlaceholderInvalidEmailError = (message: string) => {
  const normalized = message.toLowerCase();
  return normalized.includes("wallet_") && normalized.includes("invalid");
};

const sponsorshipNotificationCopy: Record<
  SponsorshipNotificationEventType,
  { title: string; detail: string }
> = {
  "pledge.offered": {
    title: "New sponsorship offers",
    detail: "Email me when someone offers to sponsor my goal.",
  },
  "pledge.accepted": {
    title: "Offer accepted",
    detail: "Email me when a goal owner accepts my sponsorship offer.",
  },
  "pledge.approved": {
    title: "Completion approved",
    detail: "Email me when a sponsor approves goal completion.",
  },
  "pledge.settled_no_response": {
    title: "Auto-settled after no response",
    detail: "Email me when a sponsorship auto-settles after the review window.",
  },
};

export default function SettingsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationPreferences, setNotificationPreferences] =
    useState<SponsorshipEmailPreferences | null>(null);
  const [notificationExpanded, setNotificationExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [finalizingPending, setFinalizingPending] = useState(false);

  const walletAddress =
    (session?.user?.user_metadata?.wallet_address as string | undefined) ?? "";

  const shortWallet = useMemo(() => {
    if (!walletAddress) return "";
    return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  }, [walletAddress]);

  const attachedEmail = useMemo(() => {
    const metadataEmail = session?.user?.user_metadata?.attached_email;
    if (typeof metadataEmail === "string" && metadataEmail.trim()) {
      return metadataEmail;
    }
    return null;
  }, [session?.user?.user_metadata]);

  const pendingEmail = useMemo(() => {
    const metadataEmail = session?.user?.user_metadata?.pending_email;
    if (typeof metadataEmail === "string" && metadataEmail.trim()) {
      return metadataEmail;
    }
    return null;
  }, [session?.user?.user_metadata]);

  const storedNotificationPreferences = useMemo(
    () =>
      readSponsorshipEmailPreferences(
        (session?.user?.user_metadata ?? null) as Record<string, unknown> | null
      ),
    [session?.user?.user_metadata]
  );

  const effectiveNotificationPreferences =
    notificationPreferences ?? storedNotificationPreferences;
  const enabledNotificationCount = SPONSORSHIP_NOTIFICATION_EVENT_TYPES.filter(
    (eventType) => effectiveNotificationPreferences[eventType]
  ).length;

  const isPendingVerified = Boolean(
    session?.user?.email_confirmed_at &&
      pendingEmail &&
      session.user.email &&
      toLower(session.user.email) === toLower(pendingEmail)
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

  useEffect(() => {
    if (!session || !pendingEmail || !isPendingVerified || finalizingPending) return;

    const finalizePendingEmail = async () => {
      setFinalizingPending(true);
      const userMetadata = (session.user.user_metadata ?? {}) as Record<string, unknown>;

      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          ...userMetadata,
          attached_email: pendingEmail,
          pending_email: null,
        },
      });

      if (updateError) {
        setError(updateError.message);
        setFinalizingPending(false);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      setSession(sessionData.session ?? null);
      setMessage("Email verified and attached.");
      setFinalizingPending(false);
    };

    void finalizePendingEmail();
  }, [finalizingPending, isPendingVerified, pendingEmail, session]);

  const handleAttachEmail = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const nextEmail = toLower(email);

    if (!nextEmail) {
      setError("Email is required.");
      return;
    }

    if (!isValidEmail(nextEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    if (attachedEmail && toLower(attachedEmail) === nextEmail) {
      setMessage("That email is already attached.");
      return;
    }

    const userMetadata = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
    const savePendingEmail = async () =>
      supabase.auth.updateUser({
        email: nextEmail,
        data: {
          ...userMetadata,
          pending_email: nextEmail,
        },
      });

    setLoading(true);
    let { error: updateError } = await savePendingEmail();

    if (
      updateError &&
      isWalletPlaceholderInvalidEmailError(updateError.message) &&
      session?.access_token
    ) {
      const normalizeResponse = await fetch("/api/auth/wallet-email/normalize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const normalizeData = await normalizeResponse.json().catch(() => null);

      if (!normalizeResponse.ok) {
        setError(
          normalizeData?.error ??
            "Failed to normalize wallet email before verification."
        );
        setLoading(false);
        return;
      }

      const { data: refreshedSession } = await supabase.auth.getSession();
      setSession(refreshedSession.session ?? null);
      ({ error: updateError } = await savePendingEmail());
    }

    if (updateError) {
      if (isWalletPlaceholderInvalidEmailError(updateError.message)) {
        const { error: metadataOnlyError } = await supabase.auth.updateUser({
          data: {
            ...userMetadata,
            pending_email: nextEmail,
          },
        });

        if (!metadataOnlyError) {
          const { data: sessionData } = await supabase.auth.getSession();
          setSession(sessionData.session ?? null);
          setMessage("Check your inbox and confirm the email before it is attached.");
          setEmail("");
          setLoading(false);
          return;
        }
      }
      setError(updateError.message);
    } else {
      const { data: sessionData } = await supabase.auth.getSession();
      setSession(sessionData.session ?? null);
      setMessage("Check your inbox and confirm the email before it is attached.");
      setEmail("");
    }
    setLoading(false);
  };

  const handleRemoveEmail = async () => {
    setError(null);
    setMessage(null);

    const userMetadata = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        ...userMetadata,
        attached_email: null,
        pending_email: null,
      },
    });

    if (updateError) {
      setError(updateError.message);
    } else {
      const { data: sessionData } = await supabase.auth.getSession();
      setSession(sessionData.session ?? null);
      setMessage("Email removed.");
      setEmail("");
    }

    setLoading(false);
  };

  const handleNotificationToggle = (eventType: SponsorshipNotificationEventType) => {
    setNotificationPreferences((current) => ({
      ...(current ?? storedNotificationPreferences),
      [eventType]: !(current ?? storedNotificationPreferences)[eventType],
    }));
  };

  const handleNotificationPreferencesSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!session) {
      return;
    }

    setNotificationError(null);
    setNotificationMessage(null);
    setNotificationSaving(true);

    const userMetadata = (session.user.user_metadata ?? {}) as Record<string, unknown>;

    const { error: updateError } = await supabase.auth.updateUser({
      data: withSponsorshipEmailPreferences({
        metadata: userMetadata,
        preferences: effectiveNotificationPreferences,
      }),
    });

    if (updateError) {
      setNotificationError(updateError.message);
      setNotificationSaving(false);
      setNotificationExpanded(true);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    setSession(sessionData.session ?? null);
    setNotificationPreferences(null);
    setNotificationMessage("Notification settings saved.");
    setNotificationSaving(false);
    setNotificationExpanded(false);
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
              Back to dashboard
            </Link>
          </div>
          {shortWallet ? <span className={styles.pill}>{shortWallet}</span> : null}
        </header>

        <section className={styles.card}>
          <div className={styles.title}>Account settings</div>
          <p className={styles.subheading}>
            Attach an email address for recovery and secondary authentication. Wallet sign-in
            remains the primary method. Attached emails receive sponsorship notification emails.
          </p>
          {walletAddress ? (
            <div className={styles.pillRow}>
              <span className={styles.pill}>Connected wallet: {walletAddress}</span>
            </div>
          ) : null}
          <div className={styles.pillRow}>
            <span className={styles.pill}>
              {attachedEmail ? `Attached email: ${attachedEmail}` : "No attached email"}
            </span>
          </div>
          {attachedEmail ? (
            <div className={styles.pillRow}>
              <span className={styles.pill}>
                Sponsorship email notifications: {enabledNotificationCount}/
                {SPONSORSHIP_NOTIFICATION_EVENT_TYPES.length} enabled
              </span>
            </div>
          ) : null}
          {pendingEmail ? (
            <div className={styles.pillRow}>
              <span className={styles.pill}>Pending verification: {pendingEmail}</span>
            </div>
          ) : null}
          {session ? (
            <>
              <div className={styles.notificationForm}>
                <div className={styles.expandableHeader}>
                  <div>
                    <div className={styles.sectionTitle}>Sponsorship notifications</div>
                    <p className={styles.sectionCopy}>
                      Email sponsorship notifications are opted out by default. Enable only the
                      updates you want.
                    </p>
                  </div>
                  <button
                    className={styles.buttonGhost}
                    type="button"
                    onClick={() => setNotificationExpanded((current) => !current)}
                  >
                    {notificationExpanded ? "Hide options" : "Show options"}
                  </button>
                </div>
                {!notificationExpanded ? null : (
                  <form onSubmit={handleNotificationPreferencesSave} className={styles.notificationInnerForm}>
                    {!attachedEmail ? (
                      <div className={styles.infoBox}>
                        Attach an email to receive these notifications.
                      </div>
                    ) : null}
                    <div className={styles.notificationList}>
                      {SPONSORSHIP_NOTIFICATION_EVENT_TYPES.map((eventType) => (
                        <label key={eventType} className={styles.notificationItem}>
                          <input
                            className={styles.checkbox}
                            type="checkbox"
                            checked={effectiveNotificationPreferences[eventType]}
                            onChange={() => handleNotificationToggle(eventType)}
                          />
                          <span>
                            <span className={styles.notificationLabel}>
                              {sponsorshipNotificationCopy[eventType].title}
                            </span>
                            <span className={styles.notificationDetail}>
                              {sponsorshipNotificationCopy[eventType].detail}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                    {notificationError ? <div className={styles.message}>{notificationError}</div> : null}
                    {notificationMessage ? (
                      <div className={`${styles.message} ${styles.success}`}>{notificationMessage}</div>
                    ) : null}
                    <div className={styles.buttonRow}>
                      <button className={styles.buttonPrimary} type="submit" disabled={notificationSaving}>
                        {notificationSaving ? "Saving..." : "Save notification settings"}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <form className={styles.form} onSubmit={handleAttachEmail}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="recovery-email">
                    Email address
                  </label>
                  <input
                    id="recovery-email"
                    className={styles.input}
                    type="email"
                    placeholder="you@domain.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                {error ? <div className={styles.message}>{error}</div> : null}
                {message ? <div className={`${styles.message} ${styles.success}`}>{message}</div> : null}
                <div className={styles.buttonRow}>
                  <button className={styles.buttonPrimary} type="submit" disabled={loading}>
                    {loading ? "Saving..." : attachedEmail ? "Update email" : "Attach email"}
                  </button>
                  {attachedEmail || pendingEmail ? (
                    <button
                      className={styles.buttonGhost}
                      type="button"
                      onClick={handleRemoveEmail}
                      disabled={loading}
                    >
                      Remove email
                    </button>
                  ) : null}
                </div>
              </form>
            </>
          ) : (
            <div className={styles.empty}>Sign in with your wallet to manage settings.</div>
          )}
        </section>
      </div>
    </div>
  );
}
