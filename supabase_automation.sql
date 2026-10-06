-- Run this once in your Supabase SQL Editor to enable daily automation.
-- It stores the in-app notifications and remembers which drafts were already
-- created, so the same draft is never made twice.

create table if not exists notifications (
  id uuid default gen_random_uuid() primary key,
  key text unique not null,            -- de-duplication key, e.g. draft:<escrow id>:<template>
  kind text not null,                  -- 'draft' | 'digest' | 'closed'
  title text not null,
  body text,
  transaction_id uuid references transactions(id) on delete cascade,
  meta jsonb default '{}',
  read boolean default false,
  created_at timestamptz default now()
);

create index if not exists notifications_created_at_idx on notifications (created_at desc);

-- Only the server (service role key) can read or write notifications.
alter table notifications enable row level security;
