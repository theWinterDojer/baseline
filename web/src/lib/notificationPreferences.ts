export const SPONSORSHIP_NOTIFICATION_EVENT_TYPES = [
  "pledge.offered",
  "pledge.accepted",
  "pledge.approved",
  "pledge.settled_no_response",
] as const;

export type SponsorshipNotificationEventType =
  (typeof SPONSORSHIP_NOTIFICATION_EVENT_TYPES)[number];

export type SponsorshipEmailPreferences = Record<
  SponsorshipNotificationEventType,
  boolean
>;

export const DEFAULT_SPONSORSHIP_EMAIL_PREFERENCES: SponsorshipEmailPreferences = {
  "pledge.offered": false,
  "pledge.accepted": false,
  "pledge.approved": false,
  "pledge.settled_no_response": false,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isSponsorshipNotificationEventType = (
  value: string
): value is SponsorshipNotificationEventType =>
  (SPONSORSHIP_NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value);

export const readSponsorshipEmailPreferences = (
  metadata: Record<string, unknown> | null | undefined
): SponsorshipEmailPreferences => {
  const parsed: SponsorshipEmailPreferences = { ...DEFAULT_SPONSORSHIP_EMAIL_PREFERENCES };

  if (!metadata) {
    return parsed;
  }

  const notificationPreferences = metadata.notification_preferences;
  if (!isRecord(notificationPreferences)) {
    return parsed;
  }

  const sponsorshipEmailPreferences = notificationPreferences.sponsorship_email;
  if (!isRecord(sponsorshipEmailPreferences)) {
    return parsed;
  }

  for (const eventType of SPONSORSHIP_NOTIFICATION_EVENT_TYPES) {
    const value = sponsorshipEmailPreferences[eventType];
    if (typeof value === "boolean") {
      parsed[eventType] = value;
    }
  }

  return parsed;
};

export const withSponsorshipEmailPreferences = ({
  metadata,
  preferences,
}: {
  metadata: Record<string, unknown>;
  preferences: SponsorshipEmailPreferences;
}) => {
  const notificationPreferences = isRecord(metadata.notification_preferences)
    ? metadata.notification_preferences
    : {};

  return {
    ...metadata,
    notification_preferences: {
      ...notificationPreferences,
      sponsorship_email: {
        ...preferences,
      },
    },
  };
};
