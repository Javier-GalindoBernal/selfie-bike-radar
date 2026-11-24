-- Selfie Bike Radar: administración de grupos y usuarios, roles y mensajes para todo el grupo.
-- Ejecutar una vez en el SQL Editor (es idempotente). Después, para ser ADMINISTRADOR DE LA APP, ejecuta aparte:
--   insert into public.radar_app_admins(user_id) select id from auth.users where lower(email)=lower('TU_CORREO') on conflict do nothing;
begin;

alter table public.radar_memberships add column if not exists role text not null default 'member';
alter table public.radar_memberships drop constraint if exists radar_memberships_role_check;
alter table public.radar_memberships add constraint radar_memberships_role_check check(role in ('owner','admin','member'));
alter table public.radar_memberships add column if not exists joined_at timestamptz not null default now();
update public.radar_memberships m set role='owner' from public.radar_groups g where g.id=m.group_id and g.owner_id=m.user_id and m.role='member';

create table if not exists public.radar_app_admins(user_id uuid primary key references auth.users(id) on delete cascade,created_at timestamptz not null default now());
alter table public.radar_app_admins enable row level security;
revoke all on public.radar_app_admins from anon,authenticated;

create table if not exists public.radar_messages(
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.radar_groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 body text not null check(length(trim(body)) between 1 and 500),
 pinned boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists radar_messages_group on public.radar_messages(group_id,created_at desc);
alter table public.radar_messages enable row level security;
revoke all on public.radar_messages from anon,authenticated;

create or replace function radar_private.is_app_admin() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.radar_app_admins where user_id=(select auth.uid()));
$$;
create or replace function radar_private.can_manage(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select radar_private.is_app_admin() or exists(select 1 from public.radar_memberships where group_id=gid and user_id=(select auth.uid()) and role in ('owner','admin'));
$$;
create or replace function radar_private.is_owner(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select radar_private.is_app_admin() or exists(select 1 from public.radar_memberships where group_id=gid and user_id=(select auth.uid()) and role='owner');
$$;
revoke all on function radar_private.is_app_admin(),radar_private.can_manage(uuid),radar_private.is_owner(uuid) from public;
grant execute on function radar_private.is_app_admin(),radar_private.can_manage(uuid),radar_private.is_owner(uuid) to authenticated;

-- El creador del grupo queda con rol owner.
create or replace function public.radar_create_group(group_name text,member_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
 if auth.uid() is null then raise exception 'Inicia sesión'; end if;
 if length(trim(group_name)) not between 2 and 80 or length(trim(member_name)) not between 2 and 60 then raise exception 'Revisa el nombre del grupo y tu nombre'; end if;
 insert into public.radar_groups(owner_id,name) values(auth.uid(),trim(group_name)) returning id into gid;
 insert into public.radar_memberships(group_id,user_id,display_name,role) values(gid,auth.uid(),trim(member_name),'owner');
 return gid;
end;
$$;

create or replace function public.radar_whoami() returns boolean
language sql stable security definer set search_path = '' as $$ select radar_private.is_app_admin(); $$;

create or replace function public.radar_group_members(gid uuid)
returns table(user_id uuid,display_name text,role text,joined_at timestamptz,email text)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not (radar_private.is_member(gid) or radar_private.is_app_admin()) then raise exception 'No perteneces a este grupo'; end if;
 return query select m.user_id,m.display_name,m.role,m.joined_at,(case when radar_private.can_manage(gid) then u.email::text else null end)
  from public.radar_memberships m join auth.users u on u.id=m.user_id where m.group_id=gid
  order by (m.role='owner') desc,(m.role='admin') desc,m.display_name;
end;
$$;

create or replace function public.radar_admin_update_member(gid uuid,target uuid,new_name text default null,new_role text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare cur text;
begin
 if auth.uid() is null or not radar_private.can_manage(gid) then raise exception 'Solo administradores del grupo'; end if;
 select role into cur from public.radar_memberships where group_id=gid and user_id=target;
 if cur is null then raise exception 'La persona no está en este grupo'; end if;
 if new_name is not null then
  if length(trim(new_name)) not between 2 and 60 then raise exception 'El nombre debe tener de 2 a 60 caracteres'; end if;
  update public.radar_memberships set display_name=trim(new_name) where group_id=gid and user_id=target;
 end if;
 if new_role is not null then
  if not radar_private.is_owner(gid) then raise exception 'Solo el creador del grupo cambia roles'; end if;
  if new_role not in ('admin','member') then raise exception 'Rol incorrecto'; end if;
  if cur='owner' then raise exception 'No se puede cambiar el rol del creador del grupo'; end if;
  update public.radar_memberships set role=new_role where group_id=gid and user_id=target;
 end if;
end;
$$;

create or replace function public.radar_admin_remove_member(gid uuid,target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cur text;
begin
 if auth.uid() is null or not radar_private.can_manage(gid) then raise exception 'Solo administradores del grupo'; end if;
 select role into cur from public.radar_memberships where group_id=gid and user_id=target;
 if cur is null then raise exception 'La persona no está en este grupo'; end if;
 if cur='owner' then raise exception 'No se puede sacar al creador del grupo'; end if;
 if cur='admin' and not radar_private.is_owner(gid) then raise exception 'Solo el creador saca a otro administrador'; end if;
 update public.radar_rides set status='finished',ended_at=greatest(now(),started_at) where group_id=gid and user_id=target and status<>'finished';
 delete from public.radar_memberships where group_id=gid and user_id=target;
end;
$$;

create or replace function public.radar_leave_group(gid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cur text;
begin
 if auth.uid() is null then raise exception 'Inicia sesión'; end if;
 select role into cur from public.radar_memberships where group_id=gid and user_id=auth.uid();
 if cur is null then raise exception 'No perteneces a este grupo'; end if;
 if cur='owner' then raise exception 'El creador no puede salir: transfiere el grupo o elimínalo'; end if;
 update public.radar_rides set status='finished',ended_at=greatest(now(),started_at) where group_id=gid and user_id=auth.uid() and status<>'finished';
 delete from public.radar_memberships where group_id=gid and user_id=auth.uid();
end;
$$;

create or replace function public.radar_admin_rename_group(gid uuid,new_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not radar_private.can_manage(gid) then raise exception 'Solo administradores del grupo'; end if;
 if length(trim(new_name)) not between 2 and 80 then raise exception 'El nombre del grupo debe tener de 2 a 80 caracteres'; end if;
 update public.radar_groups set name=trim(new_name) where id=gid;
end;
$$;

create or replace function public.radar_admin_regenerate_invite(gid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare code text;
begin
 if auth.uid() is null or not radar_private.can_manage(gid) then raise exception 'Solo administradores del grupo'; end if;
 code:=replace(gen_random_uuid()::text,'-','');
 update public.radar_groups set invite_code=code where id=gid;
 return code;
end;
$$;

create or replace function public.radar_admin_transfer_owner(gid uuid,new_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not radar_private.is_owner(gid) then raise exception 'Solo el creador del grupo'; end if;
 if not exists(select 1 from public.radar_memberships where group_id=gid and user_id=new_owner) then raise exception 'La persona no está en este grupo'; end if;
 update public.radar_memberships set role='admin' where group_id=gid and role='owner';
 update public.radar_memberships set role='owner' where group_id=gid and user_id=new_owner;
 update public.radar_groups set owner_id=new_owner where id=gid;
end;
$$;

create or replace function public.radar_admin_delete_group(gid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not radar_private.is_owner(gid) then raise exception 'Solo el creador del grupo o un administrador de la app'; end if;
 delete from public.radar_rides where group_id=gid;
 delete from public.radar_groups where id=gid;
end;
$$;

create or replace function public.radar_post_message(gid uuid,message text,pin boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare mid uuid;
begin
 if auth.uid() is null or not radar_private.can_manage(gid) then raise exception 'Solo administradores del grupo publican mensajes'; end if;
 if message is null or length(trim(message)) not between 1 and 500 then raise exception 'El mensaje debe tener de 1 a 500 caracteres'; end if;
 insert into public.radar_messages(group_id,user_id,body,pinned) values(gid,auth.uid(),trim(message),coalesce(pin,false)) returning id into mid;
 return mid;
end;
$$;

create or replace function public.radar_group_messages(gid uuid,max_rows integer default 30)
returns table(id uuid,user_id uuid,author text,body text,pinned boolean,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not (radar_private.is_member(gid) or radar_private.is_app_admin()) then raise exception 'No perteneces a este grupo'; end if;
 return query select m.id,m.user_id,coalesce(ms.display_name,'Administrador'),m.body,m.pinned,m.created_at
  from public.radar_messages m left join public.radar_memberships ms on ms.group_id=m.group_id and ms.user_id=m.user_id
  where m.group_id=gid order by m.pinned desc,m.created_at desc limit greatest(1,least(coalesce(max_rows,30),100));
end;
$$;

create or replace function public.radar_message_action(mid uuid,action text) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
 select group_id into gid from public.radar_messages where id=mid;
 if gid is null then raise exception 'Mensaje no disponible'; end if;
 if auth.uid() is null or not radar_private.can_manage(gid) then raise exception 'Solo administradores del grupo'; end if;
 if action='delete' then delete from public.radar_messages where id=mid;
 elsif action='pin' then update public.radar_messages set pinned=true where id=mid;
 elsif action='unpin' then update public.radar_messages set pinned=false where id=mid;
 else raise exception 'Acción incorrecta'; end if;
end;
$$;

-- Administración de la app (solo administradores de la app).
create or replace function public.radar_admin_groups()
returns table(id uuid,name text,invite_code text,owner_email text,members bigint,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not radar_private.is_app_admin() then raise exception 'Solo administradores de la app'; end if;
 return query select g.id,g.name,g.invite_code,u.email::text,(select count(*) from public.radar_memberships m where m.group_id=g.id),g.created_at
  from public.radar_groups g left join auth.users u on u.id=g.owner_id order by g.created_at desc;
end;
$$;

create or replace function public.radar_admin_users()
returns table(user_id uuid,email text,created_at timestamptz,last_sign_in_at timestamptz,groups bigint,is_admin boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not radar_private.is_app_admin() then raise exception 'Solo administradores de la app'; end if;
 return query select u.id,u.email::text,u.created_at,u.last_sign_in_at,(select count(*) from public.radar_memberships m where m.user_id=u.id),exists(select 1 from public.radar_app_admins a where a.user_id=u.id)
  from auth.users u order by u.created_at desc;
end;
$$;

create or replace function public.radar_admin_add_member(gid uuid,member_email text,member_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
 if auth.uid() is null or not radar_private.is_app_admin() then raise exception 'Solo administradores de la app'; end if;
 if length(trim(member_name)) not between 2 and 60 then raise exception 'El nombre debe tener de 2 a 60 caracteres'; end if;
 select id into uid from auth.users where lower(email)=lower(trim(member_email));
 if uid is null then raise exception 'No existe un usuario con ese correo'; end if;
 insert into public.radar_memberships(group_id,user_id,display_name) values(gid,uid,trim(member_name)) on conflict(group_id,user_id) do update set display_name=excluded.display_name;
end;
$$;

create or replace function public.radar_admin_delete_user(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not radar_private.is_app_admin() then raise exception 'Solo administradores de la app'; end if;
 if target=auth.uid() then raise exception 'No puedes eliminar tu propia cuenta desde aquí'; end if;
 if exists(select 1 from public.radar_app_admins where user_id=target) then raise exception 'Primero quita el rol de administrador a esa persona'; end if;
 if exists(select 1 from public.radar_groups where owner_id=target) then raise exception 'Esa persona es creadora de un grupo: transfiere o elimina el grupo primero'; end if;
 delete from auth.users where id=target;
end;
$$;

revoke all on function public.radar_whoami(),public.radar_group_members(uuid),public.radar_admin_update_member(uuid,uuid,text,text),public.radar_admin_remove_member(uuid,uuid),public.radar_leave_group(uuid),public.radar_admin_rename_group(uuid,text),public.radar_admin_regenerate_invite(uuid),public.radar_admin_transfer_owner(uuid,uuid),public.radar_admin_delete_group(uuid),public.radar_post_message(uuid,text,boolean),public.radar_group_messages(uuid,integer),public.radar_message_action(uuid,text),public.radar_admin_groups(),public.radar_admin_users(),public.radar_admin_add_member(uuid,text,text),public.radar_admin_delete_user(uuid),public.radar_create_group(text,text) from public;
grant execute on function public.radar_whoami(),public.radar_group_members(uuid),public.radar_admin_update_member(uuid,uuid,text,text),public.radar_admin_remove_member(uuid,uuid),public.radar_leave_group(uuid),public.radar_admin_rename_group(uuid,text),public.radar_admin_regenerate_invite(uuid),public.radar_admin_transfer_owner(uuid,uuid),public.radar_admin_delete_group(uuid),public.radar_post_message(uuid,text,boolean),public.radar_group_messages(uuid,integer),public.radar_message_action(uuid,text),public.radar_admin_groups(),public.radar_admin_users(),public.radar_admin_add_member(uuid,text,text),public.radar_admin_delete_user(uuid),public.radar_create_group(text,text) to authenticated;
commit;
