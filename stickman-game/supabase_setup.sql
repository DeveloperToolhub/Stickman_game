-- Run this once in Supabase: SQL Editor -> New query -> Run
create table if not exists saves (
  sub text primary key,            -- the player's Google user id
  data jsonb not null,             -- the whole game save
  updated_at timestamptz default now()
);

-- Lock the table down. Only the server (service role key) can read or write it.
alter table saves enable row level security;
