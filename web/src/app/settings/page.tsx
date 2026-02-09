"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import styles from "./settings.module.css";

export default function SettingsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const walletAddress =
    (session?.user?.user_metadata?.wallet_address as string | undefined) ?? "";

  const shortWallet = useMemo(() => {
    if (!walletAddress) return "";
    return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  }, [walletAddress]);

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

  const handleAttachEmail = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({
      email: email.trim(),
    });

    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage("Check your inbox to confirm the email address.");
      setEmail("");
    }
    setLoading(false);
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
          {shortWallet ? <span className={styles.pill}>{shortWallet}</span> : null}
        </header>

        <section className={styles.card}>
          <div className={styles.title}>Account settings</div>
          <p className={styles.subheading}>
            Attach an email address for recovery and secondary authentication. Wallet sign-in
            remains the primary method.
          </p>
          {session?.user?.email ? (
            <div className={styles.pillRow}>
              <span className={styles.pill}>Current email: {session.user.email}</span>
            </div>
          ) : null}
          {session ? (
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
                  {loading ? "Saving..." : "Attach email"}
                </button>
              </div>
            </form>
          ) : (
            <div className={styles.empty}>Sign in with your wallet to manage settings.</div>
          )}
        </section>
      </div>
    </div>
  );
}
