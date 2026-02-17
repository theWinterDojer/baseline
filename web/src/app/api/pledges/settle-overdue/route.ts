import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { habitRegistryAbi } from "@/lib/contracts";
import { HABIT_REGISTRY_ADDRESS } from "@/lib/sponsorshipChain";
import { legacyMinCheckInsToMinimumProgress } from "@/lib/sponsorshipThreshold";
import { supabaseAdmin } from "@/lib/supabaseServer";

const REVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const isContractSkipCondition = (error: unknown): boolean => {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("commitmentnotcompleted") ||
    message.includes("deadlinenotreached") ||
    message.includes("settlementwindowopen") ||
    message.includes("minimumcheckinsnotmet") ||
    message.includes("pledgeinactive") ||
    message.includes("pledgenotfound")
  );
};

type PledgeRow = {
  id: string;
  goal_id: string;
  sponsor_id: string;
  amount_cents: number;
  min_check_ins: number | null;
  deadline_at: string;
  onchain_pledge_id: string | null;
  status: "offered" | "accepted" | "settled" | "expired" | "cancelled";
  settled_at: string | null;
};

type GoalRow = {
  id: string;
  user_id: string;
  completed_at: string | null;
};

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const isAuthorizedPost = (request: Request): boolean => {
  const secret = process.env.PLEDGE_SETTLEMENT_KEY ?? process.env.DISCOVERY_REBUILD_KEY;
  const provided = request.headers.get("x-settlement-key") ?? request.headers.get("x-discovery-key");
  return Boolean(secret && provided && provided === secret);
};

const isAuthorizedCron = (request: Request): boolean => {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (cronSecret && authorization === `Bearer ${cronSecret}`) {
    return true;
  }
  return isAuthorizedPost(request);
};

const settleOverduePledges = async () => {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  if (!HABIT_REGISTRY_ADDRESS) {
    return NextResponse.json(
      { error: "Missing/invalid NEXT_PUBLIC_HABIT_REGISTRY_ADDRESS." },
      { status: 500 }
    );
  }

  const relayerPrivateKeyRaw = process.env.PLEDGE_SETTLER_PRIVATE_KEY;
  if (!/^0x[a-fA-F0-9]{64}$/.test(relayerPrivateKeyRaw ?? "")) {
    return NextResponse.json(
      { error: "Missing/invalid PLEDGE_SETTLER_PRIVATE_KEY." },
      { status: 500 }
    );
  }

  const relayerAccount = privateKeyToAccount(relayerPrivateKeyRaw as Hex);
  const transport = http(process.env.BASE_RPC_URL);
  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({
    account: relayerAccount,
    chain: base,
    transport,
  });
  let reviewWindowMs = REVIEW_WINDOW_MS;
  try {
    const reviewWindowSeconds = await publicClient.readContract({
      address: HABIT_REGISTRY_ADDRESS,
      abi: habitRegistryAbi,
      functionName: "reviewWindowSeconds",
      args: [],
    });
    const maxSafeSeconds = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
    if (
      typeof reviewWindowSeconds === "bigint" &&
      reviewWindowSeconds > BigInt(0) &&
      reviewWindowSeconds <= BigInt(maxSafeSeconds)
    ) {
      reviewWindowMs = Number(reviewWindowSeconds) * 1000;
    }
  } catch {
    // Fallback to default review window if contract read is unavailable.
  }

  const { data: pledges, error: pledgesError } = await supabaseAdmin
    .from("pledges")
    .select(
      "id,goal_id,sponsor_id,amount_cents,min_check_ins,deadline_at,onchain_pledge_id,status,settled_at"
    )
    .eq("status", "accepted")
    .is("settled_at", null)
    .not("onchain_pledge_id", "is", null);

  if (pledgesError) {
    return NextResponse.json({ error: pledgesError.message }, { status: 500 });
  }

  const pledgeRows = (pledges ?? []) as PledgeRow[];
  if (pledgeRows.length === 0) {
    return NextResponse.json({ settled: 0, skipped: 0, failed: 0 });
  }

  const goalIds = [...new Set(pledgeRows.map((pledge) => pledge.goal_id))];
  const { data: goals, error: goalsError } = await supabaseAdmin
    .from("goals")
    .select("id,user_id,completed_at")
    .in("id", goalIds);

  if (goalsError) {
    return NextResponse.json({ error: goalsError.message }, { status: 500 });
  }

  const goalById = new Map<string, GoalRow>();
  (goals ?? []).forEach((goal) => {
    goalById.set(goal.id, goal as GoalRow);
  });

  const now = Date.now();
  let settled = 0;
  let skipped = 0;
  let failed = 0;
  const failures: Array<{ pledgeId: string; error: string }> = [];

  for (const pledge of pledgeRows) {
    const goal = goalById.get(pledge.goal_id);
    if (!goal?.completed_at || !pledge.onchain_pledge_id) {
      skipped += 1;
      continue;
    }

    const completedAtMs = new Date(goal.completed_at).getTime();
    const deadlineMs = new Date(pledge.deadline_at).getTime();
    const reviewExpired =
      Number.isFinite(completedAtMs) && completedAtMs + reviewWindowMs <= now;
    const deadlineExpired = Number.isFinite(deadlineMs) && deadlineMs <= now;

    if (!reviewExpired || !deadlineExpired) {
      skipped += 1;
      continue;
    }

    let onchainPledgeId: bigint;
    try {
      onchainPledgeId = BigInt(pledge.onchain_pledge_id);
    } catch {
      failed += 1;
      failures.push({ pledgeId: pledge.id, error: "Invalid on-chain pledge id." });
      continue;
    }

    try {
      const simulation = await publicClient.simulateContract({
        account: relayerAccount.address,
        address: HABIT_REGISTRY_ADDRESS,
        abi: habitRegistryAbi,
        functionName: "settlePledgeNoResponse",
        args: [onchainPledgeId],
        chain: base,
      });

      const txHash = await walletClient.writeContract(simulation.request);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const settledAtIso = new Date().toISOString();
      const { error: updateError } = await supabaseAdmin
        .from("pledges")
        .update({
          status: "settled",
          settled_at: settledAtIso,
          settlement_tx: txHash,
        })
        .eq("id", pledge.id);

      if (updateError) {
        failed += 1;
        failures.push({ pledgeId: pledge.id, error: updateError.message });
        continue;
      }

      const { error: eventError } = await supabaseAdmin.from("events").insert({
        event_type: "pledge.settled_no_response",
        actor_id: goal.user_id,
        recipient_id: pledge.sponsor_id,
        goal_id: pledge.goal_id,
        pledge_id: pledge.id,
        data: {
          amountCents: pledge.amount_cents,
          deadlineAt: pledge.deadline_at,
          minimumProgress: legacyMinCheckInsToMinimumProgress(pledge.min_check_ins),
          settlementTx: txHash,
        },
      });

      if (eventError) {
        failed += 1;
        failures.push({ pledgeId: pledge.id, error: eventError.message });
        continue;
      }

      settled += 1;
    } catch (error) {
      if (isContractSkipCondition(error)) {
        skipped += 1;
      } else {
        failed += 1;
        failures.push({
          pledgeId: pledge.id,
          error: error instanceof Error ? error.message : "Unknown settlement error.",
        });
      }
    }
  }

  return NextResponse.json({
    settled,
    skipped,
    failed,
    failures,
  });
};

export async function POST(request: Request) {
  if (!isAuthorizedPost(request)) {
    return unauthorized();
  }
  return settleOverduePledges();
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return unauthorized();
  }
  return settleOverduePledges();
}
