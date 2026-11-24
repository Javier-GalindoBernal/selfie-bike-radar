-- Selfie Bike Radar. Independiente de Strava. Ejecutar una vez en SQL Editor.
-- Conserva intactas las tablas del prototipo anterior.
begin;
create schema if not exists radar_private;
revoke all on schema radar_private from public;
grant usage on schema radar_private to authenticated;

create table public.radar_groups (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 name text not null check(length(trim(name)) between 2 and 80),
 invite_code text not null unique default replace(gen_random_uuid()::text,'-',''),
 created_at timestamptz not null default now()
);
create table public.radar_memberships (
 group_id uuid not null references public.radar_groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 display_name text not null check(length(trim(display_name)) between 2 and 60),
 primary key(group_id,user_id)
);
create index radar_memberships_user on public.radar_memberships(user_id);
create table public.radar_rides (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 group_id uuid not null references public.radar_groups(id),
 name text not null default 'Salida en bici' check(length(name) between 1 and 120),
 status text not null default 'active' check(status in ('active','paused','finished')),
 started_at timestamptz not null default now(),
 ended_at timestamptz,
 distance_m double precision not null default 0 check(distance_m >= 0 and distance_m < 'Infinity'::float8),
 duration_s integer not null default 0 check(duration_s >= 0),
 check ((status = 'finished') = (ended_at is not null)),
 check (ended_at is null or ended_at >= started_at)
);
create unique index radar_one_open_ride on public.radar_rides(user_id) where status <> 'finished';
create index radar_rides_group on public.radar_rides(group_id,started_at desc);
create table public.radar_points (
 id uuid primary key default gen_random_uuid(),
 ride_id uuid not null references public.radar_rides(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 segment integer not null default 0 check(segment>=0),
 accuracy_m double precision not null check(accuracy_m >= 0 and accuracy_m <= 100),
 speed_mps double precision check(speed_mps >= 0 and speed_mps <= 50),
 recorded_at timestamptz not null check(recorded_at <= now() + interval '5 minutes')
);
create index radar_points_latest on public.radar_points(ride_id,recorded_at desc);

create function radar_private.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.radar_memberships where group_id=gid and user_id=(select auth.uid()));
$$;
revoke all on function radar_private.is_member(uuid) from public;
grant execute on function radar_private.is_member(uuid) to authenticated;

alter table public.radar_groups enable row level security;
alter table public.radar_memberships enable row level security;
alter table public.radar_rides enable row level security;
alter table public.radar_points enable row level security;
revoke all on public.radar_groups,public.radar_memberships,public.radar_rides,public.radar_points from anon,authenticated;
grant select on public.radar_groups,public.radar_memberships to authenticated;
grant select,insert on public.radar_rides to authenticated;
grant update(status,ended_at,distance_m,duration_s,name) on public.radar_rides to authenticated;
grant select,insert on public.radar_points to authenticated;
create policy radar_group_read on public.radar_groups for select to authenticated using (radar_private.is_member(id));
create policy radar_members_read on public.radar_memberships for select to authenticated using (radar_private.is_member(group_id));
create policy radar_rides_read on public.radar_rides for select to authenticated using (user_id=(select auth.uid()) or radar_private.is_member(group_id));
create policy radar_rides_insert on public.radar_rides for insert to authenticated with check (user_id=(select auth.uid()) and radar_private.is_member(group_id));
create policy radar_rides_update on public.radar_rides for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
-- El recorrido histórico solo puede leerlo su dueño. El grupo ve únicamente la última posición activa a través del RPC.
create policy radar_points_read on public.radar_points for select to authenticated using (user_id=(select auth.uid()));
create policy radar_points_insert on public.radar_points for insert to authenticated with check (
 user_id=(select auth.uid()) and exists(select 1 from public.radar_rides r where r.id=ride_id and r.user_id=(select auth.uid()) and recorded_at>=r.started_at and (r.ended_at is null or recorded_at<=r.ended_at))
);

create function public.radar_create_group(group_name text,member_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
 if auth.uid() is null then raise exception 'Inicia sesión'; end if;
 if length(trim(group_name)) not between 2 and 80 or length(trim(member_name)) not between 2 and 60 then raise exception 'Revisa el nombre del grupo y tu nombre'; end if;
 insert into public.radar_groups(owner_id,name) values(auth.uid(),trim(group_name)) returning id into gid;
 insert into public.radar_memberships values(gid,auth.uid(),trim(member_name));
 return gid;
end;
$$;
create function public.radar_join_group(code text,member_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
 if auth.uid() is null then raise exception 'Inicia sesión'; end if;
 if length(trim(member_name)) not between 2 and 60 then raise exception 'Escribe tu nombre (2 a 60 caracteres)'; end if;
 select id into gid from public.radar_groups where invite_code=lower(trim(code));
 if gid is null then raise exception 'Código de invitación incorrecto'; end if;
 insert into public.radar_memberships values(gid,auth.uid(),trim(member_name)) on conflict(group_id,user_id) do update set display_name=excluded.display_name;
 return gid;
end;
$$;
create function public.radar_live_locations(gid uuid)
returns table(user_id uuid,display_name text,latitude double precision,longitude double precision,speed_mps double precision,accuracy_m double precision,recorded_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not radar_private.is_member(gid) then raise exception 'No perteneces a este grupo'; end if;
 return query select r.user_id,m.display_name,p.latitude,p.longitude,p.speed_mps,p.accuracy_m,p.recorded_at
 from public.radar_rides r join public.radar_memberships m on m.group_id=r.group_id and m.user_id=r.user_id
 cross join lateral (select pt.* from public.radar_points pt where pt.ride_id=r.id order by pt.recorded_at desc limit 1) p
 where r.group_id=gid and r.status='active' and p.recorded_at>now()-interval '2 minutes';
end;
$$;
revoke all on function public.radar_create_group(text,text),public.radar_join_group(text,text),public.radar_live_locations(uuid) from public;
grant execute on function public.radar_create_group(text,text),public.radar_join_group(text,text),public.radar_live_locations(uuid) to authenticated;
commit;
