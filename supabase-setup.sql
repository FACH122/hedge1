-- ============================================================
-- Security setup for Wonderland
-- Run this once in Supabase Dashboard -> SQL Editor
--
-- ALSO required (SQL cannot do this):
--   Dashboard -> Authentication -> Users -> "Add user"
--   Create the admin account (email + password) that you will
--   use to log into admin.html
-- ============================================================

-- ---------- 1. content table: site texts/puzzles/poem ----------
create table if not exists public.content (
    key   text primary key,
    value jsonb not null default 'null'::jsonb
);

-- seed default rows so admin has something to edit
insert into public.content (key, value) values
    ('puzzles', '[]'::jsonb),
    ('texts', '{}'::jsonb),
    ('poem', '[]'::jsonb)
on conflict (key) do nothing;

alter table public.content enable row level security;

drop policy if exists "public read content" on public.content;
create policy "public read content"
    on public.content for select
    to anon, authenticated
    using (true);

drop policy if exists "admin write content" on public.content;
create policy "admin write content"
    on public.content for insert
    to authenticated
    with check (true);

drop policy if exists "admin update content" on public.content;
create policy "admin update content"
    on public.content for update
    to authenticated
    using (true)
    with check (true);

-- ---------- 2. progress table: cloud backup of solved puzzles ----------
create table if not exists public.progress (
    name       text primary key,
    solved     text[] not null default '{}',
    updated_at timestamptz not null default now()
);
alter table public.progress enable row level security;

drop policy if exists "public read progress" on public.progress;
create policy "public read progress"
    on public.progress for select
    to anon, authenticated
    using (true);

drop policy if exists "anon upsert progress" on public.progress;
create policy "anon upsert progress"
    on public.progress for insert
    to anon, authenticated
    with check (true);

drop policy if exists "anon update progress" on public.progress;
create policy "anon update progress"
    on public.progress for update
    to anon, authenticated
    using (true)
    with check (true);

-- ---------- 3. voices bucket: PRIVATE (her messages) ----------
-- Anyone can upload (she is not logged in), only admin can read/list.
update storage.buckets
   set public = false
 where id = 'voices';

insert into storage.buckets (id, name, public)
values ('voices', 'voices', false)
on conflict (id) do update set public = false;

drop policy if exists "anyone uploads to voices" on storage.objects;
create policy "anyone uploads to voices"
    on storage.objects for insert
    to anon, authenticated
    with check (bucket_id = 'voices');

drop policy if exists "admin reads voices" on storage.objects;
create policy "admin reads voices"
    on storage.objects for select
    to authenticated
    using (bucket_id = 'voices');

drop policy if exists "admin manages voices" on storage.objects;
create policy "admin manages voices"
    on storage.objects for update
    to authenticated
    using (bucket_id = 'voices')
    with check (bucket_id = 'voices');

drop policy if exists "admin deletes voices" on storage.objects;
create policy "admin deletes voices"
    on storage.objects for delete
    to authenticated
    using (bucket_id = 'voices');

-- ---------- 4. rewards bucket: PUBLIC read (reward images shown in app), admin-only write ----------
insert into storage.buckets (id, name, public)
values ('rewards', 'rewards', true)
on conflict (id) do update set public = true;

drop policy if exists "public reads rewards" on storage.objects;
create policy "public reads rewards"
    on storage.objects for select
    to anon, authenticated
    using (bucket_id = 'rewards');

drop policy if exists "admin uploads rewards" on storage.objects;
create policy "admin uploads rewards"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'rewards');
