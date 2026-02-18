"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccount, WagmiProvider } from "wagmi";
import { base } from "wagmi/chains";
import { supabase } from "@/lib/supabaseClient";
import { clearWalletConnectionPersistence } from "@/lib/walletConnectionPersistence";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

if (!walletConnectProjectId) {
  console.warn(
    "Missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. Wallet connections will fail without it."
  );
}

const config = getDefaultConfig({
  appName: "Baseline",
  projectId: walletConnectProjectId,
  chains: [base],
  ssr: true,
});

const queryClient = new QueryClient();

const normalizeAddress = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

function WalletSessionGuard() {
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const [sessionWalletAddress, setSessionWalletAddress] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const mismatchHandledRef = useRef<string | null>(null);

  const connectedWalletAddress = useMemo(() => normalizeAddress(address), [address]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const walletAddress = normalizeAddress(
        data.session?.user?.user_metadata?.wallet_address
      );
      setSessionWalletAddress(walletAddress);
      setSessionReady(true);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        const walletAddress = normalizeAddress(
          newSession?.user?.user_metadata?.wallet_address
        );
        setSessionWalletAddress(walletAddress);
        setSessionReady(true);

        if (!newSession) {
          mismatchHandledRef.current = null;
        }
      }
    );

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionReady || !isConnected || !connectedWalletAddress || !sessionWalletAddress) {
      return;
    }

    if (connectedWalletAddress === sessionWalletAddress) {
      mismatchHandledRef.current = null;
      return;
    }

    const mismatchKey = `${sessionWalletAddress}:${connectedWalletAddress}`;
    if (mismatchHandledRef.current === mismatchKey) return;
    mismatchHandledRef.current = mismatchKey;

    void (async () => {
      await supabase.auth.signOut();
      clearWalletConnectionPersistence();
      if (pathname !== "/") {
        router.replace("/");
      }
    })();
  }, [
    connectedWalletAddress,
    isConnected,
    pathname,
    router,
    sessionReady,
    sessionWalletAddress,
  ]);

  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }, []);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <WalletSessionGuard />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
