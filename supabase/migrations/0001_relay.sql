-- PROPOSED, NOT APPLIED. See docs/PHASE2_PROPOSAL.md. This has not been run against a database yet.
--
-- Tables for the handoff system. Clients never touch these tables directly: row level security
-- is on with no policies, and all access goes through edge functions that wrap RelayService.

create table players (
  id uuid primary key references auth.users (id) on delete cascade,
  reputation integer not null default 0,
  created_at timestamptz not null default now()
);

create table runs (
  id text primary key,
  seed bigint not null,
  sim_version integer not null,
  status text not null check (status in ('alive', 'dead')),
  -- Stored as text, not jsonb: jsonb reorders keys, and the state hash depends on key order.
  state text not null,
  state_hash text not null,
  segments integer not null default 0,
  floor integer not null default 1,
  claim_player text,
  claim_token text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  last_player text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Optimistic concurrency: every write checks and bumps this.
  rev integer not null default 0
);

-- The queue: alive runs, longest-waiting first.
create index runs_queue on runs (updated_at) where status = 'alive';

create table segments (
  run_id text not null references runs (id) on delete cascade,
  index integer not null,
  player_id text not null,
  is_bot boolean not null default false,
  claim_token text not null unique,
  log jsonb not null,
  start_hash text not null,
  end_hash text not null,
  floor_start integer not null,
  floor_end integer not null,
  kills integer not null,
  upgrade text,
  died boolean not null,
  created_at timestamptz not null default now(),
  -- A segment index can exist once per run, so a run can never fork or record a leg twice.
  primary key (run_id, index)
);

create index segments_by_player on segments (player_id, created_at desc);

create table emotes (
  run_id text not null references runs (id) on delete cascade,
  segment_index integer not null,
  player_id text not null,
  emote text not null,
  created_at timestamptz not null default now(),
  primary key (run_id, segment_index, player_id)
);

alter table players enable row level security;
alter table runs enable row level security;
alter table segments enable row level security;
alter table emotes enable row level security;

-- RelayStore.updateRun: replace the run only if nobody else wrote first.
create function relay_update_run(p_run jsonb, p_expected_rev integer) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update runs set
    status = p_run ->> 'status',
    state = p_run ->> 'state',
    state_hash = p_run ->> 'stateHash',
    segments = (p_run ->> 'segments')::integer,
    floor = (p_run ->> 'floor')::integer,
    claim_player = p_run -> 'claim' ->> 'playerId',
    claim_token = p_run -> 'claim' ->> 'token',
    claimed_at = to_timestamp((p_run -> 'claim' ->> 'claimedAt')::double precision / 1000),
    claim_expires_at = to_timestamp((p_run -> 'claim' ->> 'expiresAt')::double precision / 1000),
    last_player = p_run ->> 'lastPlayerId',
    updated_at = to_timestamp((p_run ->> 'updatedAt')::double precision / 1000),
    rev = p_expected_rev + 1
  where id = p_run ->> 'id' and rev = p_expected_rev;
  return found;
end $$;

-- RelayStore.commitSegment: the run update and the new segment succeed or fail together.
create function relay_commit_segment(p_run jsonb, p_expected_rev integer, p_segment jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not relay_update_run(p_run, p_expected_rev) then
    return false;
  end if;
  insert into segments (
    run_id, index, player_id, is_bot, claim_token, log, start_hash, end_hash,
    floor_start, floor_end, kills, upgrade, died, created_at
  ) values (
    p_segment ->> 'runId',
    (p_segment ->> 'index')::integer,
    p_segment ->> 'playerId',
    (p_segment ->> 'isBot')::boolean,
    p_segment ->> 'claimToken',
    p_segment -> 'log',
    p_segment ->> 'startHash',
    p_segment ->> 'endHash',
    (p_segment ->> 'floorStart')::integer,
    (p_segment ->> 'floorEnd')::integer,
    (p_segment ->> 'kills')::integer,
    p_segment ->> 'upgrade',
    (p_segment ->> 'died')::boolean,
    to_timestamp((p_segment ->> 'createdAt')::double precision / 1000)
  );
  return true;
exception when unique_violation then
  -- Raising inside the block rolls back the run update too.
  return false;
end $$;

revoke all on function relay_update_run(jsonb, integer) from public, anon, authenticated;
revoke all on function relay_commit_segment(jsonb, integer, jsonb) from public, anon, authenticated;
