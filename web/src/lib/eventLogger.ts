import { supabase } from "@/lib/supabaseClient";

type LogEventInput = {
  eventType: string;
  actorId: string;
  recipientId: string;
  goalId?: string | null;
  pledgeId?: string | null;
  data?: Record<string, unknown>;
};

type LogEventResult = {
  error: { message: string } | null;
};

const directInsert = async ({
  eventType,
  actorId,
  recipientId,
  goalId,
  pledgeId,
  data,
}: LogEventInput): Promise<LogEventResult> => {
  const { error } = await supabase.from("events").insert({
    event_type: eventType,
    actor_id: actorId,
    recipient_id: recipientId,
    goal_id: goalId ?? null,
    pledge_id: pledgeId ?? null,
    data: data ?? {},
  });

  if (error) {
    return { error: { message: error.message } };
  }

  return { error: null };
};

export const logEvent = async ({
  eventType,
  actorId,
  recipientId,
  goalId,
  pledgeId,
  data,
}: LogEventInput): Promise<LogEventResult> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    return directInsert({
      eventType,
      actorId,
      recipientId,
      goalId,
      pledgeId,
      data,
    });
  }

  try {
    const response = await fetch("/api/events/log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        eventType,
        actorId,
        recipientId,
        goalId: goalId ?? null,
        pledgeId: pledgeId ?? null,
        data: data ?? {},
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const fallbackResult = await directInsert({
        eventType,
        actorId,
        recipientId,
        goalId,
        pledgeId,
        data,
      });
      if (!fallbackResult.error) {
        return { error: null };
      }
      if (payload?.error && typeof payload.error === "string") {
        return { error: { message: payload.error } };
      }
      return fallbackResult;
    }

    return { error: null };
  } catch {
    return directInsert({
      eventType,
      actorId,
      recipientId,
      goalId,
      pledgeId,
      data,
    });
  }
};
