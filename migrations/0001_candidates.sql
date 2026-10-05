-- Races on the November 3, 2026 ballot and the candidates in them.
CREATE TABLE races (
  id TEXT PRIMARY KEY,                -- CA-12, AK-AL, DC-DEL, FL-SEN-S, OH-GOV
  state TEXT NOT NULL,                -- postal code
  kind TEXT NOT NULL CHECK (kind IN ('senate', 'senate_special', 'governor', 'house', 'delegate')),
  title TEXT NOT NULL,                -- "US Senate", "US House · District 12"
  status TEXT NOT NULL,               -- "Nominees set" or a short note
  photos_complete INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX races_state ON races (state, sort);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,                -- race id / name slug
  race_id TEXT NOT NULL REFERENCES races (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  party TEXT NOT NULL,
  incumbent INTEGER NOT NULL DEFAULT 0,
  bioguide TEXT,
  current_role TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  social TEXT NOT NULL DEFAULT '{}',  -- JSON object of profile URLs
  photo TEXT,                         -- site path of a licensed portrait
  photo_credit TEXT,
  campaign_photo_url TEXT,            -- recorded for reference only, never shown
  notes TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX candidates_race ON candidates (race_id, sort);

CREATE TABLE positions (
  candidate_id TEXT NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  evidence TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (candidate_id, domain)
);

CREATE TABLE platform (
  candidate_id TEXT NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  topic TEXT NOT NULL,
  point TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (candidate_id, ord)
);
