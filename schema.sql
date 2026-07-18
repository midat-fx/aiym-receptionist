-- aiym-receptionist — D1 schema (PLAN.md §4)
-- Moments are stored as INTEGER unix seconds (UTC); conversion to/from local
-- time happens only at the edges via Intl with the business tz.

CREATE TABLE businesses (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  assistant_name TEXT NOT NULL DEFAULT 'Айым',
  address TEXT NOT NULL DEFAULT '',
  tz TEXT NOT NULL DEFAULT 'Asia/Almaty',
  working_hours TEXT NOT NULL,                -- JSON {"mon":[["10:00","20:00"]],...,"sun":[]}
  slot_step_min INTEGER NOT NULL DEFAULT 30,
  buffer_min INTEGER NOT NULL DEFAULT 0,
  booking_horizon_days INTEGER NOT NULL DEFAULT 14,  -- window = [today, today+13]
  tg_bot_id INTEGER UNIQUE,
  tg_bot_token TEXT,
  owner_tg_chat_id INTEGER,
  admin_token_hash TEXT NOT NULL,             -- SHA-256 hex
  crm_config TEXT NOT NULL DEFAULT '{}',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE resources (                       -- masters/boxes/doctors
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                          -- «Айгерим»
  role TEXT NOT NULL DEFAULT '',               -- «парикмахер-колорист»
  UNIQUE (business_id, name)
);

CREATE TABLE services (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  name TEXT NOT NULL,
  duration_min INTEGER NOT NULL,               -- multiple of slot_step_min (validated in config.ts)
  price_kzt INTEGER,                           -- NULL = «цену уточнит мастер»; price_from=1 → «от X ₸»
  price_from INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (business_id, name)
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,                         -- crypto.randomUUID()
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled')),
  client_name TEXT,
  client_phone TEXT,
  channel TEXT NOT NULL DEFAULT 'tg' CHECK (channel IN ('tg','web','admin')),
  tg_chat_id INTEGER,
  web_session_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at TEXT
);
CREATE INDEX idx_bookings_biz_time ON bookings(business_id, start_ts);
CREATE INDEX idx_bookings_client ON bookings(business_id, tg_chat_id, status);

-- HEART OF THE SACRED PRINCIPLE: one grid cell of one master holds at most one booking.
-- A booking of N cells = N rows in ONE db.batch (transaction); any overlap →
-- PK violation → the whole batch (including the bookings row) is rolled back.
CREATE TABLE booking_cells (
  business_id INTEGER NOT NULL,
  resource_id INTEGER NOT NULL,
  cell_ts INTEGER NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  PRIMARY KEY (business_id, resource_id, cell_ts)
) WITHOUT ROWID;

CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT, phone TEXT, service TEXT, budget TEXT,
  urgency TEXT,                                -- 'today'|'tomorrow'|'this_week'|'flexible'
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','converted','rejected')),
  channel TEXT NOT NULL DEFAULT 'tg', tg_chat_id INTEGER,
  booking_id TEXT REFERENCES bookings(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_leads_biz ON leads(business_id, created_at DESC);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('tg','web')),
  external_id TEXT NOT NULL,                   -- tg chat_id or web session uuid
  history TEXT NOT NULL DEFAULT '[]',          -- [{role:'user'|'model', text}] last 16, no tool-turns
  last_offered TEXT NOT NULL DEFAULT '[]',     -- slots from the last checkFreeSlots
  client_name TEXT, client_phone TEXT,
  muted_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (business_id, channel, external_id)
);

CREATE TABLE rate_limits (                     -- ALL counters live here (KV forbidden, §2)
  scope TEXT NOT NULL,                         -- 'chat'|'voice'|'global_msg'|'tts_uncached'|'whisper'|'tts_credits'
  key TEXT NOT NULL,
  day TEXT NOT NULL,                           -- 'YYYY-MM-DD' (business tz for chat scopes, UTC for global);
                                               -- for MONTHLY scopes (tts_credits) this holds 'YYYY-MM'
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key, day)
);
