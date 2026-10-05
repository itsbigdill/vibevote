-- Anonymous funnel counters: one row per day, event, state and language, holding a count.
-- No IP, session, answer, position or result is ever stored here.
CREATE TABLE IF NOT EXISTS events_daily (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, state, locale)
);
