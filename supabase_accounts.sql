-- Run once in Supabase SQL Editor (for username accounts)
create table if not exists local_users (
  username text primary key,        -- lowercase
  password_hash text not null,      -- scrypt hash, never the password
  words_hash text not null,         -- scrypt hash of the secret words
  failed_attempts int default 0,
  locked_until bigint default 0,    -- ms timestamp; 0 = not locked
  created_at timestamptz default now()
);
alter table local_users enable row level security;
