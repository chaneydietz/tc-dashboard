-- Run this in your Supabase SQL Editor to add the listings table

create table listings (
  id uuid default gen_random_uuid() primary key,
  address text,
  list_date date,
  agent_name text,
  price text,
  status text default 'active',
  mls text,
  skyslope text,
  on_rental_program boolean default false,
  checklists jsonb default '{}',
  notes jsonb default '[]',
  contacts jsonb default '{}',
  created_at timestamptz default now()
);

-- Allow public read/write
alter table listings enable row level security;

create policy "Allow all" on listings
  for all using (true) with check (true);
