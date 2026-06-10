-- Run this in your Supabase SQL Editor to create the transactions table

create table transactions (
  id uuid default gen_random_uuid() primary key,
  address text,
  coe date,
  agent_name text,
  price text,
  side text default 'seller',
  status text default 'active',
  mls text,
  skyslope text,
  checklists jsonb default '{}',
  deadlines jsonb default '[]',
  notes jsonb default '[]',
  contacts jsonb default '{}',
  created_at timestamptz default now()
);

-- Allow public read/write (since we're not using auth)
alter table transactions enable row level security;

create policy "Allow all" on transactions
  for all using (true) with check (true);
