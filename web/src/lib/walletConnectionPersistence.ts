const WALLET_STORAGE_KEYS = [
  "wagmi.recentConnectorId",
  "rk-latest-id",
  "rk-recent",
  "WALLETCONNECT_DEEPLINK_CHOICE",
] as const;

const WALLET_STORAGE_PREFIXES = ["wc@", "WCM_"] as const;

export const clearWalletConnectionPersistence = () => {
  if (typeof window === "undefined") return;

  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }

  for (const key of WALLET_STORAGE_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage errors and keep clearing remaining keys.
    }
  }

  const keysToClear: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;
      if (WALLET_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keysToClear.push(key);
      }
    }
  } catch {
    return;
  }

  for (const key of keysToClear) {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage errors and continue.
    }
  }
};
