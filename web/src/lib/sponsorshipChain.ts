import type { Address } from "viem";

export const BASE_MAINNET_CHAIN_ID = 8453;
export const DEFAULT_BASE_USDC_ADDRESS =
  "0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913" as const;

const habitRegistryAddressRaw = process.env.NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS;
const baseUsdcAddressRaw = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS ?? DEFAULT_BASE_USDC_ADDRESS;

const isAddress = (value: string | undefined | null): value is Address =>
  /^0x[a-fA-F0-9]{40}$/.test(value ?? "");

export const HAS_HABIT_REGISTRY_ADDRESS_CONFIG = Boolean(habitRegistryAddressRaw);
export const HABIT_REGISTRY_ADDRESS = isAddress(habitRegistryAddressRaw)
  ? (habitRegistryAddressRaw as Address)
  : null;

export const BASE_USDC_ADDRESS = isAddress(baseUsdcAddressRaw)
  ? (baseUsdcAddressRaw as Address)
  : null;

const USDC_RAW_PER_CENT = BigInt(10_000);

export const centsToUsdcRaw = (amountCents: number): bigint => {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("USDC amount must be a positive integer number of cents.");
  }
  return BigInt(amountCents) * USDC_RAW_PER_CENT;
};
