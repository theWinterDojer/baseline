const ACTIVE_WALLET_PLACEHOLDER_DOMAIN = "wallet.baseline.app";

const LEGACY_WALLET_PLACEHOLDER_DOMAINS = [
  "example.com",
  "baseline.invalid",
  "baseline.test",
] as const;

const allWalletPlaceholderDomains = [
  ACTIVE_WALLET_PLACEHOLDER_DOMAIN,
  ...LEGACY_WALLET_PLACEHOLDER_DOMAINS,
];

export const walletPlaceholderEmail = (address: string) =>
  `wallet_${address.toLowerCase()}@${ACTIVE_WALLET_PLACEHOLDER_DOMAIN}`;

export const isWalletPlaceholderEmail = (email: string) => {
  const normalized = email.trim().toLowerCase();
  return allWalletPlaceholderDomains.some((domain) =>
    normalized.endsWith(`@${domain}`)
  );
};
