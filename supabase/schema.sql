-- Ejecutar en Supabase > SQL Editor
create table members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  strava_athlete_id bigint,
  access_token text,
  refresh_token text,
  expires_at bigint,
  created_at timestamptz not null default now()
);

create table locations (
  member_id uuid primary key references members(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  speed double precision,
  updated_at timestamptz not null default now()
);

create table activities (
  id bigint primary key,
  member_id uuid not null references members(id) on delete cascade,
  name text,
  type text,
  distance double precision,
  moving_time integer,
  total_elevation_gain double precision,
  start_date timestamptz not null
);
create index on activities (member_id, start_date desc);

-- Las tablas solo se acceden desde el servidor con la service role key.
alter table members enable row level security;
alter table locations enable row level security;
alter table activities enable row level security;
