-- Selfie Bike Radar: avisos privados y estadísticas completas por integrante.
-- Ejecutar DESPUÉS de 20261123_independent_radar.sql. Puede volver a ejecutarse.
begin;
alter table public.radar_rides add column if not exists max_speed_mps double precision not null default 0 check(max_speed_mps between 0 and 50);
alter table public.radar_rides add column if not exists elevation_gain_m double precision not null default 0 check(elevation_gain_m >= 0 and elevation_gain_m < 'Infinity'::float8);
alter table public.radar_points add column if not exists altitude_m double precision check(altitude_m between -500 and 9000);
grant update(max_speed_mps,elevation_gain_m) on public.radar_rides to authenticated;

create table if not exists public.radar_alerts (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.radar_groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('puncture','mechanical','health','other')),
 message text not null default '' check(length(message)<=280),
 latitude double precision check(latitude between -90 and 90),
 longitude double precision check(longitude between -180 and 180),
 created_at timestamptz not null default now(),
 resolved_at timestamptz,
 check ((latitude is null) = (longitude is null)),
 check (kind<>'other' or length(trim(message))>0)
);
create index if not exists radar_alerts_open on public.radar_alerts(group_id,created_at desc) where resolved_at is null;
create table if not exists public.radar_alert_acknowledgements (
 alert_id uuid not null references public.radar_alerts(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(alert_id,user_id)
);
alter table public.radar_alerts enable row level security;
alter table public.radar_alert_acknowledgements enable row level security;
revoke all on public.radar_alerts,public.radar_alert_acknowledgements from anon,authenticated;
-- Solo los RPC validan autoría, grupo, caducidad y transiciones.

create or replace function public.radar_send_alert(gid uuid,alert_kind text,details text default '',alert_lat double precision default null,alert_lng double precision default null,client_id uuid default gen_random_uuid()) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing public.radar_alerts;
begin
 if auth.uid() is null or not radar_private.is_member(gid) then raise exception 'No perteneces a este grupo'; end if;
 if alert_kind is null or alert_kind not in ('puncture','mechanical','health','other') then raise exception 'Tipo de aviso incorrecto'; end if;
 if details is null or length(trim(details))>280 or (alert_kind='other' and length(trim(details))=0) then raise exception 'Revisa el detalle del aviso (máximo 280 caracteres)'; end if;
 if client_id is null then raise exception 'Identificador de aviso requerido'; end if;
 select * into existing from public.radar_alerts where id=client_id;
 if found then
  if existing.user_id<>auth.uid() or existing.group_id<>gid or existing.kind<>alert_kind or existing.message<>trim(details) or existing.latitude is distinct from alert_lat or existing.longitude is distinct from alert_lng then raise exception 'Este identificador ya corresponde a otro aviso'; end if;
  return client_id;
 end if;
 insert into public.radar_alerts(id,group_id,user_id,kind,message,latitude,longitude)
 values(client_id,gid,auth.uid(),alert_kind,trim(details),alert_lat,alert_lng);
 return client_id;
end;$$;

create or replace function public.radar_group_alerts(gid uuid)
returns table(id uuid,user_id uuid,display_name text,kind text,message text,latitude double precision,longitude double precision,created_at timestamptz,ack_count bigint,acknowledged boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not radar_private.is_member(gid) then raise exception 'No perteneces a este grupo'; end if;
 return query select a.id,a.user_id,m.display_name,a.kind,a.message,a.latitude,a.longitude,a.created_at,
 (select count(*) from public.radar_alert_acknowledgements ack where ack.alert_id=a.id),
 exists(select 1 from public.radar_alert_acknowledgements ack where ack.alert_id=a.id and ack.user_id=auth.uid())
 from public.radar_alerts a join public.radar_memberships m on m.group_id=a.group_id and m.user_id=a.user_id
 where a.group_id=gid and a.resolved_at is null and a.created_at>now()-interval '24 hours'
 order by a.created_at desc;
end;$$;

create or replace function public.radar_ack_alert(aid uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.radar_alerts;
begin
 select * into a from public.radar_alerts where id=aid;
 if auth.uid() is null or a.id is null or not radar_private.is_member(a.group_id) then raise exception 'Aviso no disponible'; end if;
 if a.resolved_at is not null or a.created_at<=now()-interval '24 hours' then raise exception 'El aviso ya está cerrado o venció'; end if;
 if a.user_id=auth.uid() then raise exception 'Este es tu propio aviso'; end if;
 insert into public.radar_alert_acknowledgements(alert_id,user_id) values(aid,auth.uid()) on conflict do nothing;
end;$$;

create or replace function public.radar_resolve_alert(aid uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Inicia sesión'; end if;
 update public.radar_alerts set resolved_at=coalesce(resolved_at,now()) where id=aid and user_id=auth.uid();
 if not found then raise exception 'Solo quien creó el aviso puede cerrarlo'; end if;
end;$$;

create or replace function public.radar_group_stats(gid uuid,period text default 'week')
returns table(user_id uuid,display_name text,distance_m double precision,duration_s bigint,ride_count bigint,avg_speed_kmh double precision,max_speed_kmh double precision,elevation_gain_m double precision,last_ride_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare cutoff timestamptz;
begin
 if auth.uid() is null or not radar_private.is_member(gid) then raise exception 'No perteneces a este grupo'; end if;
 case period
 when 'week' then cutoff:=date_trunc('week',now() at time zone 'America/Bogota') at time zone 'America/Bogota';
 when 'month' then cutoff:=date_trunc('month',now() at time zone 'America/Bogota') at time zone 'America/Bogota';
 when 'all' then cutoff:='-infinity'::timestamptz;
 else raise exception 'Periodo incorrecto'; end case;
 return query select m.user_id,m.display_name,
 coalesce(sum(r.distance_m),0)::double precision,coalesce(sum(r.duration_s),0)::bigint,count(r.id),
 case when sum(r.duration_s)>0 then (sum(r.distance_m)/sum(r.duration_s)*3.6)::double precision else 0::double precision end,
 coalesce(max(r.max_speed_mps)*3.6,0)::double precision,coalesce(sum(r.elevation_gain_m),0)::double precision,max(r.started_at)
 from public.radar_memberships m left join public.radar_rides r on r.user_id=m.user_id and r.group_id=m.group_id and r.status='finished' and r.started_at>=cutoff
 where m.group_id=gid group by m.user_id,m.display_name order by coalesce(sum(r.distance_m),0) desc,m.display_name;
end;$$;

revoke all on function public.radar_send_alert(uuid,text,text,double precision,double precision,uuid),public.radar_group_alerts(uuid),public.radar_ack_alert(uuid),public.radar_resolve_alert(uuid),public.radar_group_stats(uuid,text) from public;
grant execute on function public.radar_send_alert(uuid,text,text,double precision,double precision,uuid),public.radar_group_alerts(uuid),public.radar_ack_alert(uuid),public.radar_resolve_alert(uuid),public.radar_group_stats(uuid,text) to authenticated;
commit;
