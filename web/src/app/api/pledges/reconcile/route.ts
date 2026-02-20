import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { base } from "viem/chains";
import { habitRegistryAbi } from "@/lib/contracts";
import { HABIT_REGISTRY_ADDRESS } from "@/lib/sponsorshipChain";
import { supabaseAdmin } from "@/lib/supabaseServer";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

type PledgeStatus = "offered" | "accepted" | "settled" | "expired" | "cancelled";

type PledgeRow = {
  id: string;
  goal_id: string;
  status: PledgeStatus;
  deadline_at: string;
  min_check_ins: number | null;
  settled_at: string | null;
  onchain_pledge_id: string | null;
  escrow_amount_raw: string | null;
  escrow_contract_address: string | null;
};

type GoalRow = {
  id: string;
  commitment_id: string | null;
  commitment_contract_address: string | null;
};

type DriftEntry = {
  pledgeId: string;
  issue: string;
  expected: string;
  actual: string;
  contractAddress: string | null;
  onchainPledgeId: string | null;
};

type OnchainPledgeTuple = readonly [
  bigint,
  Address,
  Address,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  number,
  boolean,
];

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const isAuthorizedPost = (request: Request): boolean => {
  const secret =
    process.env.PLEDGE_SETTLEMENT_KEY ?? process.env.DISCOVERY_REBUILD_KEY;
  const provided =
    request.headers.get("x-settlement-key") ??
    request.headers.get("x-discovery-key");
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

const parseLimit = (request: Request) => {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(raw, MAX_LIMIT);
};

const expectedOnchainStatus = (dbStatus: PledgeStatus): number | null => {
  if (dbStatus === "accepted") return 0;
  if (dbStatus === "settled") return 1;
  return null;
};

const resolveEscrowContractAddress = (
  pledge: PledgeRow,
  goal: GoalRow | undefined
): Address | null => {
  const candidates = [
    pledge.escrow_contract_address,
    goal?.commitment_contract_address ?? null,
    HABIT_REGISTRY_ADDRESS,
  ];
  for (const candidate of candidates) {
    if (candidate && isAddress(candidate)) {
      return candidate;
    }
  }
  return null;
};

const reconcilePledges = async (request: Request) => {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  if (!process.env.BASE_RPC_URL) {
    return NextResponse.json({ error: "Missing BASE_RPC_URL." }, { status: 500 });
  }

  const limit = parseLimit(request);
  const publicClient = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });

  const { data: pledgeData, error: pledgeError } = await supabaseAdmin
    .from("pledges")
    .select(
      "id,goal_id,status,deadline_at,min_check_ins,settled_at,onchain_pledge_id,escrow_amount_raw,escrow_contract_address"
    )
    .not("onchain_pledge_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (pledgeError) {
    return NextResponse.json({ error: pledgeError.message }, { status: 500 });
  }

  const pledges = (pledgeData ?? []) as PledgeRow[];
  if (pledges.length === 0) {
    return NextResponse.json({
      scanned: 0,
      matched: 0,
      drifted: 0,
      drifts: [] as DriftEntry[],
    });
  }

  const goalIds = [...new Set(pledges.map((pledge) => pledge.goal_id))];
  const { data: goalData, error: goalError } = await supabaseAdmin
    .from("goals")
    .select("id,commitment_id,commitment_contract_address")
    .in("id", goalIds);

  if (goalError) {
    return NextResponse.json({ error: goalError.message }, { status: 500 });
  }

  const goalById = new Map<string, GoalRow>();
  for (const goal of (goalData ?? []) as GoalRow[]) {
    goalById.set(goal.id, goal);
  }

  const drifts: DriftEntry[] = [];
  let scanned = 0;

  for (const pledge of pledges) {
    scanned += 1;
    const goal = goalById.get(pledge.goal_id);
    const contractAddress = resolveEscrowContractAddress(pledge, goal);
    if (!contractAddress) {
      drifts.push({
        pledgeId: pledge.id,
        issue: "escrow_contract_address_missing",
        expected: "valid pledge or goal escrow contract address",
        actual: "missing/invalid",
        contractAddress: null,
        onchainPledgeId: pledge.onchain_pledge_id,
      });
      continue;
    }

    let onchainPledgeId: bigint;
    try {
      onchainPledgeId = BigInt(pledge.onchain_pledge_id as string);
    } catch {
      drifts.push({
        pledgeId: pledge.id,
        issue: "onchain_pledge_id_invalid",
        expected: "numeric onchain pledge id",
        actual: String(pledge.onchain_pledge_id),
        contractAddress,
        onchainPledgeId: pledge.onchain_pledge_id,
      });
      continue;
    }

    let onchain: OnchainPledgeTuple;
    try {
      onchain = (await publicClient.readContract({
        address: contractAddress,
        abi: habitRegistryAbi,
        functionName: "pledges",
        args: [onchainPledgeId],
      })) as OnchainPledgeTuple;
    } catch (error) {
      drifts.push({
        pledgeId: pledge.id,
        issue: "onchain_read_failed",
        expected: "successful read from contract pledges()",
        actual: error instanceof Error ? error.message : "unknown read error",
        contractAddress,
        onchainPledgeId: pledge.onchain_pledge_id,
      });
      continue;
    }

    const [commitmentId, , , amount, deadline, minCheckIns, , settledAt, status, exists] =
      onchain;

    if (!exists) {
      drifts.push({
        pledgeId: pledge.id,
        issue: "onchain_pledge_missing",
        expected: "existing onchain pledge record",
        actual: "exists=false",
        contractAddress,
        onchainPledgeId: pledge.onchain_pledge_id,
      });
      continue;
    }

    const expectedStatus = expectedOnchainStatus(pledge.status);
    if (expectedStatus === null) {
      drifts.push({
        pledgeId: pledge.id,
        issue: "unexpected_db_status_for_onchain_pledge",
        expected: "accepted or settled",
        actual: pledge.status,
        contractAddress,
        onchainPledgeId: pledge.onchain_pledge_id,
      });
    } else if (Number(status) !== expectedStatus) {
      drifts.push({
        pledgeId: pledge.id,
        issue: "status_drift",
        expected: `onchain status ${expectedStatus}`,
        actual: `onchain status ${Number(status)}`,
        contractAddress,
        onchainPledgeId: pledge.onchain_pledge_id,
      });
    }

    const expectedSettled = Boolean(pledge.settled_at);
    const onchainSettled = settledAt > BigInt(0);
    if (expectedSettled !== onchainSettled) {
      drifts.push({
        pledgeId: pledge.id,
        issue: "settled_at_drift",
        expected: expectedSettled ? "onchain settledAt > 0" : "onchain settledAt = 0",
        actual: onchainSettled ? "onchain settledAt > 0" : "onchain settledAt = 0",
        contractAddress,
        onchainPledgeId: pledge.onchain_pledge_id,
      });
    }

    if (pledge.escrow_amount_raw !== null) {
      let expectedAmount: bigint | null = null;
      try {
        expectedAmount = BigInt(pledge.escrow_amount_raw);
      } catch {
        drifts.push({
          pledgeId: pledge.id,
          issue: "escrow_amount_raw_invalid",
          expected: "numeric escrow_amount_raw",
          actual: pledge.escrow_amount_raw,
          contractAddress,
          onchainPledgeId: pledge.onchain_pledge_id,
        });
      }

      if (expectedAmount !== null && amount !== expectedAmount) {
        drifts.push({
          pledgeId: pledge.id,
          issue: "escrow_amount_drift",
          expected: expectedAmount.toString(),
          actual: amount.toString(),
          contractAddress,
          onchainPledgeId: pledge.onchain_pledge_id,
        });
      }
    }

    if (goal?.commitment_id) {
      try {
        const expectedCommitmentId = BigInt(goal.commitment_id);
        if (commitmentId !== expectedCommitmentId) {
          drifts.push({
            pledgeId: pledge.id,
            issue: "commitment_id_drift",
            expected: expectedCommitmentId.toString(),
            actual: commitmentId.toString(),
            contractAddress,
            onchainPledgeId: pledge.onchain_pledge_id,
          });
        }
      } catch {
        drifts.push({
          pledgeId: pledge.id,
          issue: "goal_commitment_id_invalid",
          expected: "numeric goals.commitment_id",
          actual: String(goal.commitment_id),
          contractAddress,
          onchainPledgeId: pledge.onchain_pledge_id,
        });
      }
    }

    const expectedDeadline = Math.floor(new Date(pledge.deadline_at).getTime() / 1000);
    if (!Number.isFinite(expectedDeadline)) {
      drifts.push({
        pledgeId: pledge.id,
        issue: "deadline_at_invalid",
        expected: "valid ISO datetime",
        actual: pledge.deadline_at,
        contractAddress,
        onchainPledgeId: pledge.onchain_pledge_id,
      });
    } else if (deadline !== BigInt(expectedDeadline)) {
      drifts.push({
        pledgeId: pledge.id,
        issue: "deadline_drift",
        expected: String(expectedDeadline),
        actual: deadline.toString(),
        contractAddress,
        onchainPledgeId: pledge.onchain_pledge_id,
      });
    }

    const expectedMinCheckIns = BigInt(pledge.min_check_ins ?? 0);
    if (minCheckIns !== expectedMinCheckIns) {
      drifts.push({
        pledgeId: pledge.id,
        issue: "min_check_ins_drift",
        expected: expectedMinCheckIns.toString(),
        actual: minCheckIns.toString(),
        contractAddress,
        onchainPledgeId: pledge.onchain_pledge_id,
      });
    }
  }

  const driftedPledgeIds = new Set(drifts.map((drift) => drift.pledgeId));

  return NextResponse.json({
    scanned,
    matched: scanned - driftedPledgeIds.size,
    drifted: driftedPledgeIds.size,
    drift_items: drifts.length,
    generated_at: new Date().toISOString(),
    drifts,
  });
};

export async function POST(request: Request) {
  if (!isAuthorizedPost(request)) {
    return unauthorized();
  }
  return reconcilePledges(request);
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return unauthorized();
  }
  return reconcilePledges(request);
}
