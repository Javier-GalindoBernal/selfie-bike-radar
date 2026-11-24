import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Roles, mensajes del grupo y administración de usuarios',async()=>{
 const db=new PGlite();
 const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 async function as(n){await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${uid(n)}'`);}
 const q=async(sql,p)=>{try{return await db.query(sql,p);}catch(e){e.message+=' @ '+sql;throw e;}};
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),last_sign_in_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;insert into auth.users(id,email) values('${uid(1)}','ana@x.co'),('${uid(2)}','carlos@x.co'),('${uid(3)}','luisa@x.co'),('${uid(4)}','root@x.co');`);
  for(const f of ['20261123_independent_radar','20261124_alerts_and_stats'])await db.exec(await readFile(new URL(`../supabase/migrations/${f}.sql`,import.meta.url),'utf8'));
  const mig=await readFile(new URL('../supabase/migrations/20261126_admin_groups_messages.sql',import.meta.url),'utf8');
  await db.exec(mig);await db.exec(mig); // idempotente
  await as(1);
  const gid=(await q("select radar_create_group('Selfie Bike','Ana') id")).rows[0].id;
  assert.equal((await q('select role from radar_memberships')).rows[0].role,'owner');
  const code=(await q('select invite_code from radar_groups')).rows[0].invite_code;
  await as(2);await q("select radar_join_group($1,'Carlos')",[code]);
  await as(3);await q("select radar_join_group($1,'Luisa')",[code]);
  // mensajes: solo administradores publican, todos leen
  await as(2);
  await assert.rejects(q("select radar_post_message($1,'Hola a todos')",[gid]),/Solo administradores/);
  assert.ok((await q('select * from radar_group_members($1)',[gid])).rows.every(r=>r.email===null));
  await as(1);
  assert.ok((await q('select * from radar_group_members($1)',[gid])).rows.some(r=>r.email==='carlos@x.co'));
  const mid=(await q("select radar_post_message($1,'Salida el domingo 6am',true) id",[gid])).rows[0].id;
  await assert.rejects(q("select radar_post_message($1,'')",[gid]),/1 a 500/);
  await as(2);
  let msgs=(await q('select * from radar_group_messages($1)',[gid])).rows;
  assert.equal(msgs.length,1);assert.equal(msgs[0].author,'Ana');assert.equal(msgs[0].pinned,true);
  await assert.rejects(q("select radar_message_action($1,'delete')",[mid]),/Solo administradores/);
  await assert.rejects(q('select * from radar_messages'),/permission denied/);
  // roles
  await assert.rejects(q("select radar_admin_update_member($1,$2,'X',null)",[gid,uid(3)]),/Solo administradores/);
  await as(1);
  await assert.rejects(q("select radar_admin_update_member($1,$2,null,'owner')",[gid,uid(2)]),/Rol incorrecto/);
  await q("select radar_admin_update_member($1,$2,'Carlos R.','admin')",[gid,uid(2)]);
  await as(2);
  await q("select radar_post_message($1,'Aviso de Carlos')",[gid]);
  await assert.rejects(q("select radar_admin_update_member($1,$2,null,'admin')",[gid,uid(3)]),/creador/);
  await assert.rejects(q('select radar_admin_remove_member($1,$2)',[gid,uid(1)]),/creador/);
  await assert.rejects(q('select radar_admin_delete_group($1)',[gid]),/creador/);
  await q("select radar_admin_update_member($1,$2,'Luisa M.',null)",[gid,uid(3)]);
  await as(3);
  assert.ok((await q('select * from radar_group_members($1)',[gid])).rows.some(r=>r.display_name==='Luisa M.'));
  // código de invitación
  await as(2);const fresh=(await q('select radar_admin_regenerate_invite($1) c',[gid])).rows[0].c;
  assert.notEqual(fresh,code);
  await as(4);await assert.rejects(q("select radar_join_group($1,'Intruso')",[code]),/incorrecto/);
  await q("select radar_join_group($1,'Root')",[fresh]);
  // sacar miembro con salida activa
  await as(3);await q("insert into radar_rides(id,user_id,group_id) values(gen_random_uuid(),$1,$2)",[uid(3),gid]);
  await as(2);await q('select radar_admin_remove_member($1,$2)',[gid,uid(3)]);
  await as(3);await assert.rejects(q('select * from radar_group_members($1)',[gid]),/No perteneces/);
  assert.equal((await q("select count(*)::int c from radar_rides where status<>'finished'")).rows[0].c,0);
  // salir del grupo
  await as(4);await q('select radar_leave_group($1)',[gid]);
  await as(1);await assert.rejects(q('select radar_leave_group($1)',[gid]),/creador no puede salir/);
  // administración de la app
  await as(2);
  await assert.rejects(q('select * from radar_admin_users()'),/administradores de la app/);
  await assert.equal((await q('select radar_whoami() a')).rows[0].a,false);
  await db.exec("reset role");await db.exec(`insert into radar_app_admins(user_id) values('${uid(4)}')`);
  await as(4);
  assert.equal((await q('select radar_whoami() a')).rows[0].a,true);
  assert.equal((await q('select * from radar_admin_users()')).rows.length,4);
  assert.equal((await q('select * from radar_admin_groups()')).rows[0].members>=2,true);
  await assert.rejects(q('select radar_admin_delete_user($1)',[uid(4)]),/propia cuenta/);
  await assert.rejects(q('select radar_admin_delete_user($1)',[uid(1)]),/creadora de un grupo/);
  await q("select radar_admin_add_member($1,'LUISA@x.co','Luisa de nuevo')",[gid]);
  await assert.rejects(q("select radar_admin_add_member($1,'nadie@x.co','Nadie')",[gid]),/No existe/);
  await q('select radar_post_message($1,$2)',[gid,'Mensaje de la administración']);
  await q('select radar_admin_delete_user($1)',[uid(3)]);
  await db.exec('reset role');
  assert.equal((await q("select count(*)::int c from auth.users where id=$1",[uid(3)])).rows[0].c,0);
  await as(4);
  await as(1);await q('select radar_admin_transfer_owner($1,$2)',[gid,uid(2)]);
  await as(4);await q('select radar_admin_delete_user($1)',[uid(1)]);
  await q('select radar_admin_delete_group($1)',[gid]);
  await db.exec('reset role');
  assert.equal((await q('select count(*)::int c from radar_groups')).rows[0].c,0);
  assert.equal((await q('select count(*)::int c from radar_messages')).rows[0].c,0);
 }finally{await db.close();}
});
