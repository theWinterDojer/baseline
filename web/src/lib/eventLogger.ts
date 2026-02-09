import { supabase } from "@/lib/supabaseClient";

type LogEventInput = {
  eventType: string;
  actorId: string;
  recipientId: string;
  goalId?: string | null;
  pledgeId?: string | null;
  data?: Record<string, unknown>;
};

export const logEvent = async ({
  eventType,
  actorId,
  recipientId,
  goalId,
  pledgeId,
  data,
}: LogEventInput) => {
  return supabase.from("events").insert({
    event_type: eventType,
    actor_id: actorId,
    recipient_id: recipientId,
    goal_id: goalId ?? null,
    pledge_id: pledgeId ?? null,
    data: data ?? {},
  });
};
