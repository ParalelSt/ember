-- Run this in the Supabase SQL editor.

create table if not exists tracks (
  id text primary key,
  source text not null,
  source_id text not null,
  title text not null,
  artist text,
  album text,
  duration_sec integer,
  artwork_url text,
  stream_url text,
  created_at timestamptz not null default now()
);

create table if not exists playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists playlists_user_idx on playlists(user_id);

create table if not exists playlist_tracks (
  playlist_id uuid not null references playlists(id) on delete cascade,
  track_id text not null references tracks(id) on delete cascade,
  position integer not null,
  added_at timestamptz not null default now(),
  primary key (playlist_id, track_id)
);
create index if not exists playlist_tracks_playlist_idx on playlist_tracks(playlist_id, position);

create table if not exists likes (
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null references tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

create table if not exists plays (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id text not null references tracks(id) on delete cascade,
  played_at timestamptz not null default now()
);
create index if not exists plays_user_played_idx on plays(user_id, played_at desc);

alter table tracks enable row level security;
alter table playlists enable row level security;
alter table playlist_tracks enable row level security;
alter table likes enable row level security;
alter table plays enable row level security;

create policy "tracks readable by authenticated"
  on tracks for select to authenticated using (true);
create policy "tracks insertable by authenticated"
  on tracks for insert to authenticated with check (true);
create policy "tracks updatable by authenticated"
  on tracks for update to authenticated using (true) with check (true);

create policy "own playlists readable" on playlists
  for select to authenticated using (user_id = auth.uid());
create policy "own playlists writable" on playlists
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own playlist tracks readable" on playlist_tracks
  for select to authenticated
  using (exists (select 1 from playlists p where p.id = playlist_id and p.user_id = auth.uid()));
create policy "own playlist tracks writable" on playlist_tracks
  for all to authenticated
  using (exists (select 1 from playlists p where p.id = playlist_id and p.user_id = auth.uid()))
  with check (exists (select 1 from playlists p where p.id = playlist_id and p.user_id = auth.uid()));

create policy "own likes" on likes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own plays" on plays
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
