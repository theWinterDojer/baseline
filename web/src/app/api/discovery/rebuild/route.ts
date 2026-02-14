import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

type GoalRow = {
  id: string;
};

type PledgeRow = {
  goal_id: string;
  sponsor_id: string;
  amount_cents: number;
  created_at: string;
  status: "offered" | "accepted" | "settled" | "expired" | "cancelled";
  approval_at: string | null;
};

type CommentRow = {
  goal_id: string;
  created_at: string;
};

const RECENT_DAYS = 7;

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const isAuthorizedPost = (request: Request): boolean => {
  const secret = process.env.DISCOVERY_REBUILD_KEY;
  const provided = request.headers.get("x-discovery-key");
  return Boolean(secret && provided && provided === secret);
};

const isAuthorizedCron = (request: Request): boolean => {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (cronSecret && authorization === `Bearer ${cronSecret}`) {
    return true;
  }

  // Optional fallback for environments invoking GET manually with legacy key.
  const rebuildKey = process.env.DISCOVERY_REBUILD_KEY;
  const provided = request.headers.get("x-discovery-key");
  return Boolean(rebuildKey && provided && provided === rebuildKey);
};

const rebuildDiscoveryRankings = async () => {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENT_DAYS);

  const { data: goals, error: goalsError } = await supabaseAdmin
    .from("goals")
    .select("id")
    .eq("privacy", "public")
    .eq("status", "active");

  if (goalsError) {
    return NextResponse.json({ error: goalsError.message }, { status: 500 });
  }

  const goalIds = (goals ?? []).map((goal: GoalRow) => goal.id);

  if (goalIds.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  const { data: pledges, error: pledgesError } = await supabaseAdmin
    .from("pledges")
    .select("goal_id,sponsor_id,amount_cents,created_at,status,approval_at")
    .in("goal_id", goalIds)
    .in("status", ["offered", "accepted", "settled"]);

  if (pledgesError) {
    return NextResponse.json({ error: pledgesError.message }, { status: 500 });
  }

  const { data: comments, error: commentsError } = await supabaseAdmin
    .from("comments")
    .select("goal_id,created_at")
    .in("goal_id", goalIds)
    .gte("created_at", cutoff.toISOString());

  if (commentsError) {
    return NextResponse.json({ error: commentsError.message }, { status: 500 });
  }

  const totalSponsored = new Map<string, number>();
  const recentSponsored = new Map<string, number>();
  const verifiedSponsors = new Map<string, Set<string>>();

  (pledges as PledgeRow[] | null)?.forEach((pledge) => {
    totalSponsored.set(
      pledge.goal_id,
      (totalSponsored.get(pledge.goal_id) ?? 0) + pledge.amount_cents
    );

    if (new Date(pledge.created_at) >= cutoff) {
      recentSponsored.set(
        pledge.goal_id,
        (recentSponsored.get(pledge.goal_id) ?? 0) + pledge.amount_cents
      );
    }

    if (pledge.approval_at) {
      const set = verifiedSponsors.get(pledge.goal_id) ?? new Set<string>();
      set.add(pledge.sponsor_id);
      verifiedSponsors.set(pledge.goal_id, set);
    }
  });

  const commentCounts = new Map<string, number>();
  (comments as CommentRow[] | null)?.forEach((comment) => {
    commentCounts.set(
      comment.goal_id,
      (commentCounts.get(comment.goal_id) ?? 0) + 1
    );
  });

  const rows = goalIds.map((goalId) => {
    const totalCents = totalSponsored.get(goalId) ?? 0;
    const recentCents = recentSponsored.get(goalId) ?? 0;
    const totalDollars = totalCents / 100;
    const recentDollars = recentCents / 100;
    const commentCount = commentCounts.get(goalId) ?? 0;
    const verifiedCount = verifiedSponsors.get(goalId)?.size ?? 0;
    const score =
      totalDollars * 0.5 +
      recentDollars * 0.3 +
      commentCount * 0.15 +
      verifiedCount * 0.05;

    return {
      goal_id: goalId,
      score,
      total_sponsored_cents: totalCents,
      recent_sponsored_cents_7d: recentCents,
      comment_count_7d: commentCount,
      verified_sponsor_count: verifiedCount,
      updated_at: new Date().toISOString(),
    };
  });

  const { error: upsertError } = await supabaseAdmin
    .from("discovery_rankings")
    .upsert(rows, { onConflict: "goal_id" });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ updated: rows.length });
};

export async function POST(request: Request) {
  if (!isAuthorizedPost(request)) {
    return unauthorized();
  }

  return rebuildDiscoveryRankings();
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return unauthorized();
  }

  return rebuildDiscoveryRankings();
}
