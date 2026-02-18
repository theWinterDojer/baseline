import type { Hex } from "viem";

const MAX_ERROR_LENGTH = 220;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const compactWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").replace(/[\r\n\t]+/g, " ").trim();

const extractErrorMessage = (error: unknown): string | null => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (isObject(error)) {
    const shortMessage = error.shortMessage;
    if (typeof shortMessage === "string" && shortMessage.trim()) {
      return shortMessage;
    }
    const details = error.details;
    if (typeof details === "string" && details.trim()) {
      return details;
    }
    const message = error.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return null;
};

const isUserRejectedError = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("user rejected") ||
    normalized.includes("user denied") ||
    normalized.includes("request rejected") ||
    normalized.includes("rejected request") ||
    normalized.includes("action_rejected") ||
    normalized.includes("denied transaction signature") ||
    normalized.includes("transaction was rejected") ||
    normalized.includes("code: 4001")
  );
};

const truncateError = (message: string) => {
  const normalized = compactWhitespace(message);
  if (!normalized) return null;
  if (normalized.length <= MAX_ERROR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_ERROR_LENGTH - 3)}...`;
};

export const toWalletActionError = ({
  error,
  fallback,
  userRejected = "Transaction canceled in wallet.",
}: {
  error: unknown;
  fallback: string;
  userRejected?: string;
}) => {
  const raw = extractErrorMessage(error);
  if (!raw) return fallback;
  if (isUserRejectedError(raw)) return userRejected;
  if (raw.toLowerCase().includes("insufficient funds")) {
    return "Insufficient funds to complete this transaction.";
  }
  if (raw.toLowerCase().includes("connector not connected")) {
    return "Connect your wallet to continue.";
  }
  return truncateError(raw) ?? fallback;
};

const shortTxHash = (txHash: Hex | string) =>
  txHash.length > 18 ? `${txHash.slice(0, 10)}...${txHash.slice(-6)}` : txHash;

export const toPostTxPersistenceError = ({
  action,
  txHash,
}: {
  action: string;
  txHash: Hex | string;
}) =>
  `Transaction confirmed on-chain, but Baseline could not save the ${action}. Please retry refresh/reload and verify tx ${shortTxHash(txHash)} on BaseScan.`;
