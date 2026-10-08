-- Running sums of finished results per state and topic, for the public map. Only a count and a sum per
-- state and topic are kept: no single result can be read back from this table.
CREATE TABLE IF NOT EXISTS state_positions (
  state TEXT NOT NULL,
  domain TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (state, domain)
);
