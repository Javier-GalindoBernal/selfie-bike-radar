-- Selfie Bike Radar: quien está apuntado a una salida ve a los demás de ESA salida (aunque salga tarde)
-- y el rastro por donde pasaron, para poder alcanzarlos. Ejecutar una vez en el SQL Editor (idempotente).
begin;

-- Radar en vivo: basta con estar apuntado a la salida y que esté dentro de su ventana de tiempo.
-- Las salidas privadas (sin evento) siguen sin verse nunca.
create or replace function public.radar_live_locations(gid uuid)
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
   and exists(select 1 from public.radar_event_participants vp where vp.event_id=e.id and vp.user_id=auth.uid());
end;
$$;

-- Rastro de quienes están saliendo ahora en la salida (solo salidas activas, solo para apuntados, solo dentro de la ventana).
-- Privacidad: se omiten los primeros 250 m desde el punto de inicio de cada persona (su casa) y se aligera a ~400 puntos.
create or replace function public.radar_event_trails(eid uuid)
returns table(user_id uuid,display_name text,latitude double precision,longitude double precision,segment integer,recorded_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare gid uuid; t0 timestamptz;
begin
 select e.group_id,e.starts_at into gid,t0 from public.radar_events e
  where e.id=eid and e.status='scheduled' and now() between e.starts_at - interval '1 hour' and e.ends_at;
 if gid is null or auth.uid() is null or not exists(select 1 from public.radar_event_participants vp where vp.event_id=eid and vp.user_id=auth.uid()) then
  raise exception 'Salida no disponible';
 end if;
 return query
 with pts as (
  select r.id as rid,r.user_id as uid,pt.latitude as lat,pt.longitude as lng,pt.segment as seg,pt.recorded_at as at_,
   first_value(pt.latitude) over w as lat0,first_value(pt.longitude) over w as lng0,
   row_number() over w as rn,count(*) over (partition by r.id) as total
  from public.radar_rides r
  join public.radar_points pt on pt.ride_id=r.id
  join public.radar_event_participants rp on rp.event_id=eid and rp.user_id=r.user_id
  where r.event_id=eid and r.status='active' and r.user_id<>auth.uid() and pt.recorded_at>=t0 - interval '1 hour'
  window w as (partition by r.id order by pt.recorded_at)
 )
 select p.uid,coalesce(m.display_name,'Alguien'),p.lat,p.lng,p.seg,p.at_
 from pts p left join public.radar_memberships m on m.group_id=gid and m.user_id=p.uid
 where sqrt(power((p.lat-p.lat0)*110540,2)+power((p.lng-p.lng0)*111320*cos(radians(p.lat0)),2))>250
  and (p.rn % greatest(1,ceil(p.total/400.0)::int))=0
 order by p.uid,p.at_;
end;
$$;

revoke all on function public.radar_event_trails(uuid) from public;
grant execute on function public.radar_event_trails(uuid) to authenticated;
commit;
