-- Two Tickets: Supabase room storage
create table if not exists public.rooms (
  code text primary key,
  genres jsonb not null default '[]'::jsonb,
  deck jsonb not null default '[]'::jsonb,
  movies jsonb not null default '[]'::jsonb,
  rev bigint not null default 0,
  created bigint not null default 0
);

create table if not exists public.votes (
  code text not null references public.rooms(code) on delete cascade,
  slot text not null check (slot in ('p1','p2')),
  votes jsonb not null default '{}'::jsonb,
  name text not null default '',
  primary key (code, slot)
);

create table if not exists public.picks (
  code text primary key references public.rooms(code) on delete cascade,
  id integer not null,
  ts bigint not null,
  by text not null check (by in ('p1','p2'))
);

alter table public.rooms enable row level security;
alter table public.votes enable row level security;
alter table public.picks enable row level security;

-- Demo-friendly policies. A 4-character room code acts as the room's shared secret.
-- Tighten these later if you add authenticated accounts.
drop policy if exists "rooms public access" on public.rooms;
create policy "rooms public access" on public.rooms for all to anon, authenticated using (true) with check (true);

drop policy if exists "votes public access" on public.votes;
create policy "votes public access" on public.votes for all to anon, authenticated using (true) with check (true);

drop policy if exists "picks public access" on public.picks;
create policy "picks public access" on public.picks for all to anon, authenticated using (true) with check (true);

-- Enable Realtime for the three tables.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.votes;
alter publication supabase_realtime add table public.picks;
