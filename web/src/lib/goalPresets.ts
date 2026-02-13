export type GoalPreset = {
  key: string;
  label: string;
};

export type GoalPresetCategory = {
  key: string;
  label: string;
  presets: GoalPreset[];
};

export const GOAL_PRESET_CATEGORIES: GoalPresetCategory[] = [
  {
    key: "body",
    label: "🏋️ Body",
    presets: [
      { key: "activity_sessions", label: "Workouts / activity" },
      { key: "activity_minutes", label: "Active time" },
      { key: "distance", label: "Distance (mi/km)" },
      { key: "strength_sessions", label: "Strength workouts" },
      { key: "mobility_sessions", label: "Mobility / stretching" },
      { key: "sleep_hours", label: "Sleep" },
      { key: "rest_days", label: "Rest days" },
      { key: "bodyweight_logged", label: "Body weight" },
    ],
  },
  {
    key: "mind",
    label: "🧠 Mind",
    presets: [
      { key: "focus_sessions", label: "Focus sessions" },
      { key: "learning_sessions", label: "Learning sessions" },
      { key: "pages_read", label: "Pages read" },
      { key: "creative_sessions", label: "Creative sessions" },
      { key: "creative_outputs", label: "Things created" },
      { key: "journal_entries", label: "Journal entries" },
      { key: "meditation_sessions", label: "Meditation sessions" },
      { key: "ideas_captured", label: "Ideas captured" },
    ],
  },
  {
    key: "work",
    label: "💼 Work",
    presets: [
      { key: "deep_work_sessions", label: "Deep-work sessions" },
      { key: "tasks_completed", label: "Tasks completed" },
      { key: "applications_submitted", label: "Applications submitted" },
      { key: "outreach_sent", label: "Outreach messages" },
      { key: "hours_logged", label: "Hours worked" },
      { key: "projects_completed", label: "Projects completed" },
      { key: "certifications_earned", label: "Certifications earned" },
    ],
  },
  {
    key: "money",
    label: "💰 Money",
    presets: [
      { key: "savings_events", label: "Times you saved money" },
      { key: "no_spend_days", label: "No-spend days" },
      { key: "debt_payments", label: "Debt payments" },
      { key: "investment_events", label: "Investment contributions" },
      { key: "budget_reviews", label: "Budget reviews" },
      { key: "net_worth_updates", label: "Net worth check-ins" },
    ],
  },
  {
    key: "relationships",
    label: "❤️ Relationships",
    presets: [
      { key: "connection_sessions", label: "Quality time" },
      { key: "calls_made", label: "Calls made" },
      { key: "events_attended", label: "Events attended" },
      { key: "acts_of_kindness", label: "Acts of kindness" },
      { key: "date_nights", label: "Date nights" },
    ],
  },
  {
    key: "life",
    label: "🏠 Life",
    presets: [
      { key: "chores_completed", label: "Chores completed" },
      { key: "habits_completed", label: "Habits completed" },
      { key: "meal_prep_days", label: "Meal-prep days" },
      { key: "declutter_sessions", label: "Declutter sessions" },
      { key: "reduction_days", label: "Days avoided (custom)" },
      { key: "streak_days", label: "On-track days" },
    ],
  },
];

const LEGACY_PRESET_LABELS: Record<string, string> = {
  workout_sessions: "Workout sessions",
  active_minutes: "Active minutes",
  steps: "Steps",
  cardio_sessions: "Cardio sessions",
  walk_sessions: "Walk sessions",
  run_sessions: "Run sessions",
  miles: "Miles",
  distance_tracked: "Distance tracked",
  sports_sessions: "Sports sessions",
  stretch_sessions: "Stretch sessions",
  pounds_lost: "Pounds lost",
  pounds_gained: "Pounds gained",
  dollars_saved: "Dollars saved",
  expense_logs: "Expense logs",
  investments_made: "Investments made",
  side_income_hours: "Side-income hours",
  networking_calls: "Networking calls",
  outreach_messages_sent: "Outreach messages sent",
  hours_billed: "Hours billed",
  client_projects_completed: "Client projects completed",
  portfolio_updates: "Portfolio updates",
  interviews_completed: "Interviews completed",
  on_schedule_days: "On-schedule days",
  cleaning_sessions: "Cleaning sessions",
  errands_completed: "Errands completed",
  home_maintenance_tasks: "Home-maintenance tasks",
  breathwork_sessions: "Breathwork sessions",
  mood_logs: "Mood logs",
  gratitude_entries: "Gratitude entries",
  digital_detox_days: "Digital-detox days",
  therapy_sessions: "Therapy sessions",
  affirmations_completed: "Affirmations completed",
  study_sessions: "Study sessions",
  chapters_read: "Chapters read",
  lessons_completed: "Lessons completed",
  problems_solved: "Problems solved",
  flashcards_reviewed: "Flashcards reviewed",
  courses_completed: "Courses completed",
  research_hours: "Research hours",
  quality_time_sessions: "Quality-time sessions",
  family_visits: "Family visits",
  social_events_attended: "Social events attended",
  thank_you_messages_sent: "Thank-you messages sent",
  words_written: "Words written",
  drafts_written: "Drafts written",
  practice_sessions: "Practice sessions",
  posts_published: "Posts published",
  sketch_sessions: "Sketch sessions",
  videos_recorded: "Videos recorded",
  no_social_media_days: "No-social-media days",
  screen_time_under_limit_days: "Screen-time-under-limit days",
  no_alcohol_days: "No-alcohol days",
  no_smoking_days: "No-smoking days",
  cravings_resisted: "Cravings resisted",
  relapse_free_days: "Relapse-free days",
};

const PRESET_LABELS = new Map(
  GOAL_PRESET_CATEGORIES.flatMap((category) =>
    category.presets.map((preset) => [preset.key, preset.label] as const)
  )
);

Object.entries(LEGACY_PRESET_LABELS).forEach(([key, label]) => {
  if (!PRESET_LABELS.has(key)) {
    PRESET_LABELS.set(key, label);
  }
});

export function getPresetLabel(presetKey: string | null): string | null {
  if (!presetKey) return null;
  return PRESET_LABELS.get(presetKey) ?? null;
}
