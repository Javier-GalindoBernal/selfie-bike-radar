-- Selfie Bike Radar: borrar salidas grabadas. Ejecutar una vez en el SQL Editor (idempotente).
-- Puede borrarla su dueño o un administrador del grupo; solo salidas ya finalizadas (los puntos GPS se borran con ella).
begin;
create or replace function public.radar_delete_ride(rid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.radar_rides;
begin
 select * into r from public.radar_rides where id=rid;
 if r.id is null then raise exception 'Salida no disponible'; end if;
 if auth.uid() is null or not (r.user_id=auth.uid() or radar_private.can_manage(r.group_id)) then raise exception 'Solo su dueño o un administrador del grupo'; end if;
 if r.status<>'finished' then raise exception 'Primero finaliza la salida para poder borrarla'; end if;
 delete from public.radar_rides where id=rid;
end;
$$;
revoke all on function public.radar_delete_ride(uuid) from public;
grant execute on function public.radar_delete_ride(uuid) to authenticated;
commit;
