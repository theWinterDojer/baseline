#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  createPublicClient,
  formatEther,
  http,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

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

const toBool = (value) => {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean value "${value}".`);
};

const toEthWei = (ethString) => {
  if (ethString === undefined || ethString === "") return 0n;
  if (!/^\d+(\.\d+)?$/.test(String(ethString))) {
    throw new Error(`Invalid MIN_RELAYER_BASE_ETH value "${ethString}".`);
  }
  const [whole, frac = ""] = String(ethString).split(".");
  const wholeWei = BigInt(whole) * 10n ** 18n;
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  const fracWei = BigInt(fracPadded);
  return wholeWei + fracWei;
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

const rpcUrl = cli["rpc-url"] ?? env.BASE_RPC_URL;
const contractAddress = cli.contract ?? env.NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS;
const cronSecretPresent = Boolean(env.CRON_SECRET);
const discoveryKeyPresent = Boolean(env.DISCOVERY_REBUILD_KEY);
const settlementKeyPresent = Boolean(env.PLEDGE_SETTLEMENT_KEY);
const privateKey = env.PLEDGE_SETTLER_PRIVATE_KEY;
const requireDistinctKeys = toBool(
  cli["require-distinct-keys"] ?? env.REQUIRE_DISTINCT_SETTLEMENT_KEYS ?? "false"
);
const minRelayerWei = toEthWei(
  cli["min-relayer-base-eth"] ?? env.MIN_RELAYER_BASE_ETH ?? "0"
);

const checks = [];

checks.push({
  id: "env.cron_secret_present",
  passed: cronSecretPresent,
  expected: "present",
  actual: cronSecretPresent ? "present" : "missing",
});
checks.push({
  id: "env.discovery_rebuild_key_present",
  passed: discoveryKeyPresent,
  expected: "present",
  actual: discoveryKeyPresent ? "present" : "missing",
});
checks.push({
  id: "env.pledge_settlement_key_present",
  passed: settlementKeyPresent,
  expected: "present",
  actual: settlementKeyPresent ? "present" : "missing",
});
checks.push({
  id: "env.habit_registry_address_valid",
  passed: Boolean(contractAddress && isAddress(contractAddress)),
  expected: "valid address",
  actual:
    contractAddress && isAddress(contractAddress) ? "valid address" : "missing/invalid",
});
checks.push({
  id: "env.base_rpc_url_present",
  passed: Boolean(rpcUrl),
  expected: "present",
  actual: rpcUrl ? "present" : "missing",
});
checks.push({
  id: "env.pledge_settler_private_key_valid",
  passed: /^0x[a-fA-F0-9]{64}$/.test(privateKey ?? ""),
  expected: "0x + 64 hex chars",
  actual: /^0x[a-fA-F0-9]{64}$/.test(privateKey ?? "") ? "valid" : "missing/invalid",
});

if (requireDistinctKeys) {
  checks.push({
    id: "env.settlement_keys_distinct",
    passed:
      discoveryKeyPresent &&
      settlementKeyPresent &&
      env.DISCOVERY_REBUILD_KEY !== env.PLEDGE_SETTLEMENT_KEY,
    expected: "DISCOVERY_REBUILD_KEY != PLEDGE_SETTLEMENT_KEY",
    actual:
      discoveryKeyPresent && settlementKeyPresent
        ? env.DISCOVERY_REBUILD_KEY === env.PLEDGE_SETTLEMENT_KEY
          ? "equal"
          : "distinct"
        : "not-applicable",
  });
}

let chainId = null;
let latestBlock = null;
let relayerAddress = null;
let relayerBalanceWei = null;

if (rpcUrl && /^0x[a-fA-F0-9]{64}$/.test(privateKey ?? "")) {
  try {
    const client = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const account = privateKeyToAccount(privateKey);
    relayerAddress = account.address;
    [chainId, latestBlock, relayerBalanceWei] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      client.getBalance({ address: account.address }),
    ]);

    checks.push({
      id: "rpc.chain_id_is_base_mainnet",
      passed: chainId === base.id,
      expected: base.id,
      actual: chainId,
    });
    checks.push({
      id: "rpc.latest_block_readable",
      passed: typeof latestBlock === "bigint" && latestBlock > 0n,
      expected: "blockNumber > 0",
      actual: latestBlock?.toString() ?? "unavailable",
    });
    checks.push({
      id: "relayer.base_eth_balance_threshold",
      passed: relayerBalanceWei >= minRelayerWei,
      expected: `>= ${formatEther(minRelayerWei)} ETH`,
      actual: `${formatEther(relayerBalanceWei)} ETH`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      id: "rpc.connectivity_and_balance",
      passed: false,
      expected: "successful chain/read/balance checks",
      actual: message,
    });
  }
} else {
  checks.push({
    id: "rpc.connectivity_and_balance",
    passed: false,
    expected: "BASE_RPC_URL + valid PLEDGE_SETTLER_PRIVATE_KEY",
    actual: "prerequisites missing",
  });
}

const passed = checks.every((check) => check.passed);
const report = {
  generatedAt: new Date().toISOString(),
  rpcEndpoint: rpcUrl ? redactRpc(rpcUrl) : null,
  chainId,
  latestBlock: latestBlock?.toString() ?? null,
  contractAddress: contractAddress ?? null,
  relayerAddress,
  relayerBalanceWei: relayerBalanceWei?.toString() ?? null,
  relayerBalanceEth:
    typeof relayerBalanceWei === "bigint" ? formatEther(relayerBalanceWei) : null,
  thresholds: {
    minRelayerBaseEth: formatEther(minRelayerWei),
  },
  keysPresent: {
    CRON_SECRET: cronSecretPresent,
    DISCOVERY_REBUILD_KEY: discoveryKeyPresent,
    PLEDGE_SETTLEMENT_KEY: settlementKeyPresent,
    BASE_RPC_URL: Boolean(rpcUrl),
    PLEDGE_SETTLER_PRIVATE_KEY: /^0x[a-fA-F0-9]{64}$/.test(privateKey ?? ""),
  },
  passed,
  checks,
};

console.log(JSON.stringify(report, null, 2));
process.exit(passed ? 0 : 2);
