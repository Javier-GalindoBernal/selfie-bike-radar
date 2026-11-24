import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Borrar salidas: dueño o administrador, solo finalizadas',async()=>{
 const db=new PGlite();
 const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 async function as(n){await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${uid(n)}'`);}
 const q=async(sql,p)=>{try{return await db.query(sql,p);}catch(e){e.message+=' @ '+sql;throw e;}};
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),last_sign_in_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;insert into auth.users(id,email) values('${uid(1)}','a@x'),('${uid(2)}','b@x'),('${uid(3)}','c@x');`);
  for(const f of ['20261123_independent_radar','20261124_alerts_and_stats','20261126_admin_groups_messages','20261127_group_events_privacy','20261128_event_trails','20261129_delete_rides'])await db.exec(await readFile(new URL(`../supabase/migrations/${f}.sql`,import.meta.url),'utf8'));
  await as(1);const gid=(await q("select radar_create_group('Selfie Bike','Ana') id")).rows[0].id;
  const code=(await q('select invite_code from radar_groups')).rows[0].invite_code;
  await as(2);await q("select radar_join_group($1,'Beto')",[code]);
  await as(3);await q("select radar_join_group($1,'Cami')",[code]);
  const mk=async(n,status)=>{await as(n);const id=crypto.randomUUID();await q("insert into radar_rides(id,user_id,group_id) values($1,$2,$3)",[id,uid(n),gid]);await q("insert into radar_points(ride_id,user_id,latitude,longitude,accuracy_m,recorded_at) values($1,$2,5,-74,5,now())",[id,uid(n)]);if(status==='finished')await q("update radar_rides set status='finished',ended_at=now()+interval '1 second' where id=$1",[id]);return id;};
  const own=await mk(2,'finished'),active=await mk(3,'active');
  await as(2);await q('select radar_delete_ride($1)',[own]);                                  // su dueño la borra
  await db.exec('reset role');assert.equal((await q('select count(*)::int c from radar_points where ride_id=$1',[own])).rows[0].c,0); // sus puntos también
  await as(2);await assert.rejects(q('select radar_delete_ride($1)',[active]),/Solo su dueño/);   // otro miembro no puede
  await as(3);await assert.rejects(q('select radar_delete_ride($1)',[active]),/finaliza/);        // activa: primero finalizar
  await as(1);await assert.rejects(q('select radar_delete_ride($1)',[active]),/finaliza/);        // ni siquiera el administrador
  await as(3);await q("update radar_rides set status='finished',ended_at=now()+interval '1 second' where id=$1",[active]);
  await as(2);await assert.rejects(q('select radar_delete_ride($1)',[active]),/Solo su dueño/);
  await as(1);await q('select radar_delete_ride($1)',[active]);                                   // el creador del grupo (administrador) sí
  await as(1);await assert.rejects(q('select radar_delete_ride($1)',[active]),/no disponible/);
 }finally{await db.close();}
});
