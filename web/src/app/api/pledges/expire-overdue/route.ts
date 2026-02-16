import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

type ExpiredPledgeRow = {
  id: string;
};

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

const expireOverdueOffers = async () => {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("pledges")
    .update({ status: "expired" })
    .eq("status", "offered")
    .lt("deadline_at", nowIso)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const expiredRows = (data ?? []) as ExpiredPledgeRow[];
  return NextResponse.json({
    expired: expiredRows.length,
    expired_ids: expiredRows.map((row) => row.id),
    scanned_at: nowIso,
  });
};

export async function POST(request: Request) {
  if (!isAuthorizedPost(request)) {
    return unauthorized();
  }
  return expireOverdueOffers();
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return unauthorized();
  }
  return expireOverdueOffers();
}
