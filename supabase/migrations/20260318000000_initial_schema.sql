-- Enable pgcrypto for gen_random_uuid()
create extension if not exists pgcrypto;

-- ============================================================
-- Enums
-- ============================================================

create type room_status as enum (
  'lobby',
  'prompts',
  'active',
  'reveal',
  'scoring',
  'finished'
);

create type scoring_mode as enum ('friendly', 'competitive');

create type entry_type as enum ('drawing', 'guess');

create type score_reason as enum (
  'correct_guess',
  'aided_correct',
  'favorite_sketch',
  'favorite_guess',
  'chain_survived'
);

create type vote_type as enum ('favorite_sketch', 'favorite_guess');

-- ============================================================
-- rooms
-- ============================================================

create table rooms (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique not null,
  status             room_status not null default 'lobby',
  host_player_id     uuid,                         -- FK added after players table
  num_rounds         int not null default 3,
  current_round      int not null default 0,
  scoring_mode       scoring_mode not null default 'friendly',
  reveal_book_index  int not null default 0,
  reveal_entry_index int not null default 0,
  created_at         timestamptz not null default now()
);

-- ============================================================
-- players
-- ============================================================

create table players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms (id) on delete cascade,
  nickname     text not null,
  seat_order   int not null,
  is_connected bool not null default true,
  created_at   timestamptz not null default now(),
  unique (room_id, seat_order),
  unique (room_id, nickname)
);

-- Now that players exists, add the FK from rooms.host_player_id
alter table rooms
  add constraint rooms_host_player_id_fkey
  foreign key (host_player_id) references players (id) on delete set null;

-- ============================================================
-- rounds
-- ============================================================

create table rounds (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms (id) on delete cascade,
  round_number     int not null,
  current_pass     int not null default 1,
  timer_started_at timestamptz,
  unique (room_id, round_number)
);

-- ============================================================
-- books
-- ============================================================

create table books (
  id               uuid primary key default gen_random_uuid(),
  round_id         uuid not null references rounds (id) on delete cascade,
  owner_player_id  uuid not null references players (id) on delete cascade,
  original_prompt  text not null
);

-- ============================================================
-- entries
-- ============================================================

create table entries (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid not null references books (id) on delete cascade,
  pass_number      int not null,
  author_player_id uuid not null references players (id) on delete cascade,
  type             entry_type not null,
  content          text not null default '',
  submitted_at     timestamptz,
  is_blank         bool not null default false,
  fuzzy_correct    bool,
  owner_override   bool,
  unique (book_id, pass_number)
);

-- ============================================================
-- prompts
-- ============================================================

create table prompts (
  id       uuid primary key default gen_random_uuid(),
  text     text not null unique,
  category text
);

-- ============================================================
-- scores
-- ============================================================

create table scores (
  id        uuid primary key default gen_random_uuid(),
  room_id   uuid not null references rooms (id) on delete cascade,
  round_id  uuid not null references rounds (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  points    int not null default 0,
  reason    score_reason not null
);

-- ============================================================
-- votes  (friendly mode only)
-- ============================================================

create table votes (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid not null references books (id) on delete cascade,
  voter_player_id  uuid not null references players (id) on delete cascade,
  entry_id         uuid not null references entries (id) on delete cascade,
  vote_type        vote_type not null,
  unique (book_id, voter_player_id, vote_type)
);

-- ============================================================
-- Indexes for common query patterns
-- ============================================================

create index on rooms (code);
create index on players (room_id);
create index on rounds (room_id);
create index on books (round_id);
create index on books (owner_player_id);
create index on entries (book_id);
create index on entries (author_player_id);
create index on scores (room_id);
create index on scores (player_id);
create index on votes (book_id);
