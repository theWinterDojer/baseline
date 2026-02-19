#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createPublicClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const VERIFY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "reviewWindowSeconds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "settlementOperators",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
];

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return {};
  const parsed = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
};

const truthy = new Set(["1", "true", "yes", "on"]);
const falsey = new Set(["0", "false", "no", "off"]);

const parseBoolean = (value, fallback) => {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (truthy.has(normalized)) return true;
  if (falsey.has(normalized)) return false;
  throw new Error(`Invalid boolean value "${value}". Use true/false.`);
};

const parseInteger = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) {
    throw new Error(`Invalid integer value "${value}".`);
  }
  return Number(value);
};

const redactRpc = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "invalid-url";
  }
};

const args = process.argv.slice(2);
const cli = {};
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const maybeValue = args[i + 1];
  if (!maybeValue || maybeValue.startsWith("--")) {
    cli[key] = "true";
    continue;
  }
  cli[key] = maybeValue;
  i += 1;
}

const cwd = process.cwd();
const env = {
  ...parseEnvFile(path.resolve(cwd, ".env.local")),
  ...parseEnvFile(path.resolve(cwd, "../.env.local")),
  ...process.env,
};

const contractAddress = cli.contract ?? env.NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS;
const rpcUrl = cli["rpc-url"] ?? env.BASE_RPC_URL;
const expectedReviewWindowSeconds = parseInteger(
  cli["expect-review-window-seconds"] ?? env.EXPECT_REVIEW_WINDOW_SECONDS,
  7 * 24 * 60 * 60
);
const expectedPaused = parseBoolean(
  cli["expect-paused"] ?? env.EXPECT_PAUSED,
  false
);

let operatorAddress = cli.operator ?? env.CONTRACT_SETTLEMENT_OPERATOR ?? null;
const relayerPrivateKey = env.PLEDGE_SETTLER_PRIVATE_KEY;
if (!operatorAddress && /^0x[a-fA-F0-9]{64}$/.test(relayerPrivateKey ?? "")) {
  operatorAddress = privateKeyToAccount(relayerPrivateKey).address;
}

if (!rpcUrl) {
  console.error("Missing BASE_RPC_URL or --rpc-url.");
  process.exit(1);
}
if (!contractAddress || !isAddress(contractAddress)) {
  console.error(
    "Missing/invalid NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS or --contract."
  );
  process.exit(1);
}
if (operatorAddress && !isAddress(operatorAddress)) {
  console.error("Invalid operator address (CONTRACT_SETTLEMENT_OPERATOR/--operator).");
  process.exit(1);
}

const client = createPublicClient({ chain: base, transport: http(rpcUrl) });

let chainId;
let owner;
let paused;
let reviewWindowSeconds;
let operatorEnabled = null;

try {
  chainId = await client.getChainId();
  [owner, paused, reviewWindowSeconds] = await Promise.all([
    client.readContract({
      address: contractAddress,
      abi: VERIFY_ABI,
      functionName: "owner",
      args: [],
    }),
    client.readContract({
      address: contractAddress,
      abi: VERIFY_ABI,
      functionName: "paused",
      args: [],
    }),
    client.readContract({
      address: contractAddress,
      abi: VERIFY_ABI,
      functionName: "reviewWindowSeconds",
      args: [],
    }),
  ]);

  if (operatorAddress) {
    operatorEnabled = await client.readContract({
      address: contractAddress,
      abi: VERIFY_ABI,
      functionName: "settlementOperators",
      args: [operatorAddress],
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Contract ops verification failed: ${message}`);
  process.exit(1);
}

const reviewWindowSecondsNumber = Number(reviewWindowSeconds);
const checks = [
  {
    id: "paused_matches_expectation",
    passed: paused === expectedPaused,
    expected: expectedPaused,
    actual: paused,
  },
  {
    id: "review_window_matches_expectation",
    passed: reviewWindowSecondsNumber === expectedReviewWindowSeconds,
    expected: expectedReviewWindowSeconds,
    actual: reviewWindowSecondsNumber,
  },
];

if (operatorAddress) {
  checks.push({
    id: "settlement_operator_enabled",
    passed: operatorEnabled === true,
    expected: true,
    actual: operatorEnabled,
    operatorAddress,
  });
}

const passed = checks.every((check) => check.passed);
const report = {
  generatedAt: new Date().toISOString(),
  chainId,
  contractAddress,
  rpcEndpoint: redactRpc(rpcUrl),
  owner,
  paused,
  expectedPaused,
  reviewWindowSeconds: reviewWindowSecondsNumber,
  expectedReviewWindowSeconds,
  operatorAddress,
  operatorEnabled,
  passed,
  checks,
};

console.log(JSON.stringify(report, null, 2));
process.exit(passed ? 0 : 2);
