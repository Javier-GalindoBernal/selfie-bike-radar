-- Selfie Bike Radar: salidas del grupo (eventos) y privacidad por salida.
-- A partir de esta migración la ubicación en vivo SOLO la ven las personas que se apuntaron a la MISMA salida
-- (misma ruta y mismo día) y que además están saliendo en ella. Las salidas privadas no se ven en el radar.
-- Ejecutar una vez en el SQL Editor (idempotente).
begin;

create table if not exists public.radar_shared_routes(
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.radar_groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 120),
 distance_m double precision not null check(distance_m>=0 and distance_m<'Infinity'::float8),
 gain_m double precision not null default 0 check(gain_m>=0 and gain_m<'Infinity'::float8),
 source text not null default 'Compartida' check(length(source)<=30),
 coords jsonb not null check(jsonb_typeof(coords)='array' and jsonb_array_length(coords) between 2 and 3000),
 created_at timestamptz not null default now()
);
create index if not exists radar_shared_routes_group on public.radar_shared_routes(group_id,created_at desc);

create table if not exists public.radar_events(
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.radar_groups(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(trim(title)) between 2 and 120),
 notes text not null default '' check(length(notes)<=500),
 route_id uuid references public.radar_shared_routes(id) on delete set null,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'scheduled' check(status in ('scheduled','cancelled')),
 created_at timestamptz not null default now(),
 check(ends_at>starts_at and ends_at<=starts_at+interval '24 hours')
);
create index if not exists radar_events_group on public.radar_events(group_id,starts_at desc);

create table if not exists public.radar_event_participants(
 event_id uuid not null references public.radar_events(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(event_id,user_id)
);

alter table public.radar_rides add column if not exists event_id uuid references public.radar_events(id) on delete set null;
create index if not exists radar_rides_event on public.radar_rides(event_id) where event_id is not null;

alter table public.radar_shared_routes enable row level security;
alter table public.radar_events enable row level security;
alter table public.radar_event_participants enable row level security;
revoke all on public.radar_shared_routes,public.radar_events,public.radar_event_participants from anon,authenticated;

-- Solo se puede asociar una salida a un evento al que te apuntaste y que está en su ventana de tiempo (1 h antes hasta el final).
create or replace function radar_private.can_ride_event(eid uuid,gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.radar_events e join public.radar_event_participants p on p.event_id=e.id
  where e.id=eid and e.group_id=gid and e.status='scheduled' and p.user_id=(select auth.uid())
  and now() between e.starts_at - interval '1 hour' and e.ends_at);
$$;
revoke all on function radar_private.can_ride_event(uuid,uuid) from public;
grant execute on function radar_private.can_ride_event(uuid,uuid) to authenticated;

drop policy if exists radar_rides_insert on public.radar_rides;
create policy radar_rides_insert on public.radar_rides for insert to authenticated
 with check (user_id=(select auth.uid()) and radar_private.is_member(group_id) and (event_id is null or radar_private.can_ride_event(event_id,group_id)));

-- Radar en vivo: solo salidas del grupo. Para ver a alguien debes estar apuntado a su misma salida y salir en ella
-- (o ser administrador del grupo apuntado a esa salida). Las salidas sin evento (privadas) nunca se muestran.
drop function if exists public.radar_live_locations(uuid);
create function public.radar_live_locations(gid uuid)
returns table(user_id uuid,display_name text,latitude double precision,longitude double precision,speed_mps double precision,accuracy_m double precision,recorded_at timestamptz,event_id uuid,event_title text)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not radar_private.is_member(gid) then raise exception 'No perteneces a este grupo'; end if;
 return query select r.user_id,m.display_name,p.latitude,p.longitude,p.speed_mps,p.accuracy_m,p.recorded_at,e.id,e.title
  from public.radar_rides r
  join public.radar_events e on e.id=r.event_id and e.group_id=gid and e.status='scheduled' and now() between e.starts_at - interval '1 hour' and e.ends_at
  join public.radar_event_participants rp on rp.event_id=e.id and rp.user_id=r.user_id
  join public.radar_memberships m on m.group_id=r.group_id and m.user_id=r.user_id
  cross join lateral (select pt.* from public.radar_points pt where pt.ride_id=r.id order by pt.recorded_at desc limit 1) p
  where r.group_id=gid and r.status='active' and p.recorded_at>now()-interval '2 minutes'
   and exists(select 1 from public.radar_event_participants vp where vp.event_id=e.id and vp.user_id=auth.uid())
   and (r.user_id=auth.uid()
    or exists(select 1 from public.radar_rides mine where mine.user_id=auth.uid() and mine.event_id=e.id and mine.status='active')
    or radar_private.can_manage(gid));
end;
$$;

create or replace function public.radar_share_route(gid uuid,route_name text,dist double precision,gain double precision,src text,route_coords jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
 if auth.uid() is null or not radar_private.is_member(gid) then raise exception 'No perteneces a este grupo'; end if;
 if jsonb_typeof(route_coords)<>'array' or jsonb_array_length(route_coords) not between 2 and 3000 then raise exception 'La ruta debe tener entre 2 y 3000 puntos'; end if;
 if exists(select 1 from jsonb_array_elements(route_coords) c where jsonb_typeof(c)<>'array' or jsonb_array_length(c)<>2 or jsonb_typeof(c->0)<>'number' or jsonb_typeof(c->1)<>'number' or (c->>0)::float8 not between -90 and 90 or (c->>1)::float8 not between -180 and 180) then raise exception 'La ruta tiene coordenadas inválidas'; end if;
 insert into public.radar_shared_routes(group_id,user_id,name,distance_m,gain_m,source,coords) values(gid,auth.uid(),trim(route_name),greatest(coalesce(dist,0),0),greatest(coalesce(gain,0),0),left(coalesce(nullif(trim(src),''),'Compartida'),30),route_coords) returning id into rid;
 return rid;
end;
$$;

create or replace function public.radar_group_routes(gid uuid)
returns table(id uuid,name text,distance_m double precision,gain_m double precision,source text,author text,created_at timestamptz,mine boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not radar_private.is_member(gid) then raise exception 'No perteneces a este grupo'; end if;
 return query select r.id,r.name,r.distance_m,r.gain_m,r.source,coalesce(m.display_name,'Alguien'),r.created_at,r.user_id=auth.uid()
  from public.radar_shared_routes r left join public.radar_memberships m on m.group_id=r.group_id and m.user_id=r.user_id
  where r.group_id=gid order by r.created_at desc;
end;
$$;

create or replace function public.radar_group_route_coords(rid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare gid uuid; c jsonb;
begin
 select group_id,coords into gid,c from public.radar_shared_routes where id=rid;
 if gid is null or auth.uid() is null or not radar_private.is_member(gid) then raise exception 'Ruta no disponible'; end if;
 return c;
end;
$$;

create or replace function public.radar_delete_shared_route(rid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid; owner uuid;
begin
 select group_id,user_id into gid,owner from public.radar_shared_routes where id=rid;
 if gid is null then raise exception 'Ruta no disponible'; end if;
 if auth.uid() is null or not (owner=auth.uid() or radar_private.can_manage(gid)) then raise exception 'Solo quien la compartió o un administrador'; end if;
 delete from public.radar_shared_routes where id=rid;
end;
$$;

create or replace function public.radar_create_event(gid uuid,event_title text,event_start timestamptz,route uuid default null,event_notes text default '',hours integer default 8) returns uuid
language plpgsql security definer set search_path = '' as $$
declare eid uuid;
begin
 if auth.uid() is null or not radar_private.is_member(gid) then raise exception 'No perteneces a este grupo'; end if;
 if length(trim(event_title)) not between 2 and 120 then raise exception 'El título debe tener de 2 a 120 caracteres'; end if;
 if event_start is null or event_start < now() - interval '2 hours' then raise exception 'La fecha de la salida ya pasó'; end if;
 if event_start > now() + interval '180 days' then raise exception 'La salida es demasiado lejana (máximo 180 días)'; end if;
 if route is not null and not exists(select 1 from public.radar_shared_routes where id=route and group_id=gid) then raise exception 'La ruta no pertenece a este grupo'; end if;
 insert into public.radar_events(group_id,created_by,title,notes,route_id,starts_at,ends_at)
  values(gid,auth.uid(),trim(event_title),coalesce(event_notes,''),route,event_start,event_start+make_interval(hours=>greatest(1,least(coalesce(hours,8),24)))) returning id into eid;
 insert into public.radar_event_participants(event_id,user_id) values(eid,auth.uid());
 return eid;
end;
$$;

create or replace function public.radar_group_events(gid uuid)
returns table(id uuid,title text,notes text,starts_at timestamptz,ends_at timestamptz,status text,route_id uuid,route_name text,route_distance_m double precision,creator text,participants bigint,joined boolean,open_now boolean,created_by uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not radar_private.is_member(gid) then raise exception 'No perteneces a este grupo'; end if;
 return query select e.id,e.title,e.notes,e.starts_at,e.ends_at,e.status,e.route_id,sr.name,sr.distance_m,coalesce(m.display_name,'Alguien'),
   (select count(*) from public.radar_event_participants p where p.event_id=e.id),
   exists(select 1 from public.radar_event_participants p where p.event_id=e.id and p.user_id=auth.uid()),
   (e.status='scheduled' and now() between e.starts_at - interval '1 hour' and e.ends_at),
   e.created_by
  from public.radar_events e
  left join public.radar_shared_routes sr on sr.id=e.route_id
  left join public.radar_memberships m on m.group_id=e.group_id and m.user_id=e.created_by
  where e.group_id=gid and e.ends_at>now()-interval '2 days'
  order by (e.ends_at<now()),e.starts_at;
end;
$$;

create or replace function public.radar_event_join(eid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid; st text;
begin
 select group_id,status into gid,st from public.radar_events where id=eid;
 if gid is null or auth.uid() is null or not radar_private.is_member(gid) then raise exception 'Salida no disponible'; end if;
 if st<>'scheduled' then raise exception 'La salida fue cancelada'; end if;
 insert into public.radar_event_participants(event_id,user_id) values(eid,auth.uid()) on conflict do nothing;
end;
$$;

create or replace function public.radar_event_leave(eid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Inicia sesión'; end if;
 delete from public.radar_event_participants where event_id=eid and user_id=auth.uid();
end;
$$;

create or replace function public.radar_event_cancel(eid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid; owner uuid;
begin
 select group_id,created_by into gid,owner from public.radar_events where id=eid;
 if gid is null then raise exception 'Salida no disponible'; end if;
 if auth.uid() is null or not (owner=auth.uid() or radar_private.can_manage(gid)) then raise exception 'Solo quien la creó o un administrador'; end if;
 update public.radar_events set status='cancelled' where id=eid;
end;
$$;

create or replace function public.radar_event_roster(eid uuid) returns table(user_id uuid,display_name text)
language plpgsql stable security definer set search_path = '' as $$
declare gid uuid;
begin
 select group_id into gid from public.radar_events where id=eid;
 if gid is null or auth.uid() is null or not radar_private.is_member(gid) then raise exception 'Salida no disponible'; end if;
 return query select p.user_id,coalesce(m.display_name,'Alguien') from public.radar_event_participants p
  left join public.radar_memberships m on m.group_id=gid and m.user_id=p.user_id where p.event_id=eid order by 2;
end;
$$;

revoke all on function public.radar_live_locations(uuid),public.radar_share_route(uuid,text,double precision,double precision,text,jsonb),public.radar_group_routes(uuid),public.radar_group_route_coords(uuid),public.radar_delete_shared_route(uuid),public.radar_create_event(uuid,text,timestamptz,uuid,text,integer),public.radar_group_events(uuid),public.radar_event_join(uuid),public.radar_event_leave(uuid),public.radar_event_cancel(uuid),public.radar_event_roster(uuid) from public;
grant execute on function public.radar_live_locations(uuid),public.radar_share_route(uuid,text,double precision,double precision,text,jsonb),public.radar_group_routes(uuid),public.radar_group_route_coords(uuid),public.radar_delete_shared_route(uuid),public.radar_create_event(uuid,text,timestamptz,uuid,text,integer),public.radar_group_events(uuid),public.radar_event_join(uuid),public.radar_event_leave(uuid),public.radar_event_cancel(uuid),public.radar_event_roster(uuid) to authenticated;
commit;
