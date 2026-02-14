import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabaseServer";

type LogEventRequest = {
  eventType?: unknown;
  actorId?: unknown;
  recipientId?: unknown;
  goalId?: unknown;
  pledgeId?: unknown;
  data?: unknown;
};

const EMAIL_NOTIFIABLE_EVENT_TYPES = new Set([
  "pledge.offered",
  "pledge.accepted",
  "pledge.approved",
  "pledge.settled_no_response",
]);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizeBaseUrl = (request: Request) => {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null);

  if (configured && configured.trim().length > 0) {
    return configured.replace(/\/+$/, "");
  }

  const requestUrl = new URL(request.url);
  return `${requestUrl.protocol}//${requestUrl.host}`;
};

const formatAmount = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return `$${(value / 100).toFixed(0)}`;
};

const buildEmailMessage = ({
  eventType,
  goalId,
  data,
  baseUrl,
}: {
  eventType: string;
  goalId: string | null;
  data: Record<string, unknown>;
  baseUrl: string;
}) => {
  const amountLabel = formatAmount(data.amountCents);
  const goalLink = goalId ? `${baseUrl}/public/goals/${goalId}` : `${baseUrl}/`;
  const subjectPrefix = "Baseline update";

  switch (eventType) {
    case "pledge.offered":
      return {
        subject: `${subjectPrefix}: New sponsorship offer`,
        text: `You received a new sponsorship offer${amountLabel ? ` (${amountLabel})` : ""}.\n\nView goal: ${goalLink}`,
      };
    case "pledge.accepted":
      return {
        subject: `${subjectPrefix}: Sponsorship accepted`,
        text: `A goal owner accepted your sponsorship${amountLabel ? ` (${amountLabel})` : ""}.\n\nView goal: ${goalLink}`,
      };
    case "pledge.approved":
      return {
        subject: `${subjectPrefix}: Sponsorship approved`,
        text: `A sponsor approved completion${amountLabel ? ` (${amountLabel})` : ""}.\n\nView goal: ${goalLink}`,
      };
    case "pledge.settled_no_response":
      return {
        subject: `${subjectPrefix}: Sponsorship auto-settled`,
        text: `A sponsorship auto-settled after the approval window${amountLabel ? ` (${amountLabel})` : ""}.\n\nView goal: ${goalLink}`,
      };
    default:
      return null;
  }
};

const maybeSendNotificationEmail = async ({
  request,
  eventType,
  recipientId,
  goalId,
  data,
}: {
  request: Request;
  eventType: string;
  recipientId: string;
  goalId: string | null;
  data: Record<string, unknown>;
}) => {
  if (!supabaseAdmin) {
    return { sent: false };
  }

  if (!EMAIL_NOTIFIABLE_EVENT_TYPES.has(eventType)) {
    return { sent: false };
  }

  const resendApiKey = process.env.RESEND_API_KEY ?? "";
  const fromEmail = process.env.NOTIFICATIONS_FROM_EMAIL ?? "";
  if (!resendApiKey || !fromEmail) {
    return { sent: false };
  }

  const { data: userData, error: userError } =
    await supabaseAdmin.auth.admin.getUserById(recipientId);

  if (userError || !userData?.user) {
    return { sent: false };
  }

  const metadata = (userData.user.user_metadata ?? {}) as Record<string, unknown>;
  const attachedEmail = metadata.attached_email;
  if (!isNonEmptyString(attachedEmail)) {
    return { sent: false };
  }

  const message = buildEmailMessage({
    eventType,
    goalId,
    data,
    baseUrl: normalizeBaseUrl(request),
  });

  if (!message) {
    return { sent: false };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [attachedEmail],
      subject: message.subject,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.warn("Failed to send notification email", response.status, errorText);
    return { sent: false };
  }

  return { sent: true };
};

export async function POST(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SERVICE_ROLE_KEY on server." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseServer.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: "Invalid auth token." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as LogEventRequest | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    !isNonEmptyString(body.eventType) ||
    !isNonEmptyString(body.actorId) ||
    !isNonEmptyString(body.recipientId)
  ) {
    return NextResponse.json(
      { error: "eventType, actorId, and recipientId are required." },
      { status: 400 }
    );
  }

  if (body.actorId !== user.id) {
    return NextResponse.json({ error: "Actor mismatch." }, { status: 403 });
  }

  const eventPayload = {
    event_type: body.eventType,
    actor_id: body.actorId,
    recipient_id: body.recipientId,
    goal_id: isNonEmptyString(body.goalId) ? body.goalId : null,
    pledge_id: isNonEmptyString(body.pledgeId) ? body.pledgeId : null,
    data:
      body.data && typeof body.data === "object" && !Array.isArray(body.data)
        ? (body.data as Record<string, unknown>)
        : {},
  };

  const { data: insertedEvent, error: insertError } = await supabaseAdmin
    .from("events")
    .insert(eventPayload)
    .select("id")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const emailResult = await maybeSendNotificationEmail({
    request,
    eventType: eventPayload.event_type,
    recipientId: eventPayload.recipient_id,
    goalId: eventPayload.goal_id,
    data: eventPayload.data,
  });

  return NextResponse.json({
    ok: true,
    eventId: insertedEvent?.id ?? null,
    emailSent: emailResult.sent,
  });
}
