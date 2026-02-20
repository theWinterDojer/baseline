import type { Hex } from "viem";

const MAX_ERROR_LENGTH = 160;

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

const shortHex = (value: string) =>
  value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;

const extractRevertReason = (message: string): string | null => {
  const quotedReason = message.match(
    /reverted(?: with reason string)?[:\s]+["']([^"']+)["']/i
  )?.[1];
  if (quotedReason) {
    return compactWhitespace(quotedReason).replace(/[.;]+$/, "");
  }

  const executionTail = message.match(/execution reverted(?::\s*)?(.*)$/i)?.[1];
  if (!executionTail) return null;
  let reason = compactWhitespace(executionTail);
  if (!reason) return null;

  const stopTokens = [
    " request arguments",
    " raw call arguments",
    " version: viem",
    " details:",
    " url:",
    " at ",
  ];
  const lowerReason = reason.toLowerCase();
  for (const token of stopTokens) {
    const tokenIndex = lowerReason.indexOf(token);
    if (tokenIndex > 0) {
      reason = reason.slice(0, tokenIndex);
      break;
    }
  }

  reason = compactWhitespace(reason).replace(/[.;]+$/, "");
  return reason || null;
};

const looksLikeProviderDump = (message: string) => {
  const normalized = message.toLowerCase();
  const payloadSignals = [
    '"jsonrpc"',
    '"method"',
    '"params"',
    "request arguments",
    "raw call arguments",
    "version: viem",
    "details:",
    "url:",
    "request body",
  ];
  const payloadSignalCount = payloadSignals.reduce(
    (count, signal) => count + (normalized.includes(signal) ? 1 : 0),
    0
  );

  return (
    payloadSignalCount >= 2 ||
    normalized.includes("signature: 0x") ||
    normalized.includes("signed message: 0x") ||
    normalized.includes("raw transaction: 0x")
  );
};

const sanitizeWalletError = (message: string) => {
  const normalized = compactWhitespace(message)
    .replace(/^error:\s*/i, "")
    .replace(/^transactionexecutionerror:\s*/i, "")
    .replace(/^contractfunctionexecutionerror:\s*/i, "")
    .replace(/^callexecutionerror:\s*/i, "")
    .replace(/^rpc request failed:\s*/i, "")
    .trim();

  if (!normalized || looksLikeProviderDump(normalized)) {
    return null;
  }

  const lower = normalized.toLowerCase();
  if (lower.includes("execution reverted")) {
    const reason = extractRevertReason(normalized);
    if (!reason) return "Transaction reverted on-chain.";
    return truncateError(`Transaction reverted: ${reason}.`);
  }

  const redacted = normalized
    .replace(
      /(signature|signed message|raw transaction)\s*:\s*0x[a-f0-9]+/gi,
      (_, label: string) => `${label}: [redacted]`
    )
    .replace(/0x[a-f0-9]{40,}/gi, (hex) => shortHex(hex));

  return truncateError(redacted);
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
  const normalized = raw.toLowerCase();

  if (isUserRejectedError(raw)) return userRejected;
  if (normalized.includes("insufficient funds")) {
    return "Insufficient funds to complete this transaction.";
  }
  if (normalized.includes("insufficient allowance")) {
    return "Insufficient token allowance. Approve token spend, then retry.";
  }
  if (
    normalized.includes("nonce too low") ||
    normalized.includes("replacement transaction underpriced") ||
    normalized.includes("already known")
  ) {
    return "A similar transaction is already pending. Wait for confirmation, then retry.";
  }
  if (
    normalized.includes("network request failed") ||
    normalized.includes("fetch failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out")
  ) {
    return "Network error while talking to wallet/RPC. Retry in a moment.";
  }
  if (
    normalized.includes("wrong network") ||
    normalized.includes("unsupported chain") ||
    normalized.includes("chain mismatch")
  ) {
    return "Switch wallet network to Base mainnet to continue.";
  }
  if (
    normalized.includes("commitmentnotfound") ||
    normalized.includes("0xb6682ad2")
  ) {
    return "This goal's on-chain anchor was not found on the active contract. Re-anchor and try again.";
  }
  if (
    normalized.includes("connector not connected") ||
    normalized.includes("wallet not connected") ||
    normalized.includes("disconnected")
  ) {
    return "Connect your wallet to continue.";
  }
  return sanitizeWalletError(raw) ?? fallback;
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
