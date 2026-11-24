import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Avisos privados, confirmación idempotente y estadísticas sin límite de 100 salidas',async()=>{
 const db=new PGlite();
 const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 async function as(n){await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${uid(n)}'`);}
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;insert into auth.users values('${uid(1)}'),('${uid(2)}'),('${uid(3)}');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261123_independent_radar.sql',import.meta.url),'utf8'));
  const extension=await readFile(new URL('../supabase/migrations/20261124_alerts_and_stats.sql',import.meta.url),'utf8');
  await db.exec(extension);await db.exec(extension);
  await as(1);
  const gid=(await db.query("select radar_create_group('Bici amigos','Ana') id")).rows[0].id;
  const invite=(await db.query('select invite_code from radar_groups')).rows[0].invite_code;
  const aid=crypto.randomUUID();
  const send=()=>db.query("select radar_send_alert($1,'health','Necesito parar',null,null,$2) id",[gid,aid]);
  assert.equal((await send()).rows[0].id,aid);assert.equal((await send()).rows[0].id,aid);
  let alerts=(await db.query('select * from radar_group_alerts($1)',[gid])).rows;
  assert.equal(alerts.length,1);assert.equal(alerts[0].latitude,null);assert.equal(alerts[0].ack_count,0);
  await assert.rejects(db.query("select radar_send_alert($1,'other','')",[gid]),/Revisa/);
  await assert.rejects(db.query("select radar_send_alert($1,'puncture','',4,null)",[gid]),/check constraint/);
  await assert.rejects(db.query("select radar_send_alert($1,'other','Mensaje diferente',null,null,$2)",[gid,aid]),/otro aviso/);
  await as(3);
  await assert.rejects(db.query('select * from radar_group_alerts($1)',[gid]),/No perteneces/);
  await assert.rejects(db.query("select radar_send_alert($1,'puncture','')",[gid]),/No perteneces/);
  await assert.rejects(db.query('select radar_ack_alert($1)',[aid]),/no disponible/);
  await assert.rejects(db.query("select * from radar_group_stats($1,'all')",[gid]),/No perteneces/);
  await as(2);await db.query("select radar_join_group($1,'Carlos')",[invite]);
  await db.query('select radar_ack_alert($1)',[aid]);await db.query('select radar_ack_alert($1)',[aid]);
  alerts=(await db.query('select * from radar_group_alerts($1)',[gid])).rows;
  assert.equal(alerts[0].ack_count,1);assert.equal(alerts[0].acknowledged,true);
  await assert.rejects(db.query('select radar_resolve_alert($1)',[aid]),/Solo quien/);
  await assert.rejects(db.query('select * from radar_alerts'),/permission denied/);
  await as(1);await db.query('select radar_resolve_alert($1)',[aid]);
  assert.equal((await db.query('select * from radar_group_alerts($1)',[gid])).rows.length,0);
  await as(2);await assert.rejects(db.query('select radar_ack_alert($1)',[aid]),/cerrado/);
  await as(1);
  await db.query("insert into radar_rides(user_id,group_id,status,started_at,ended_at,distance_m,duration_s,max_speed_mps,elevation_gain_m) select $1,$2,'finished',now()-interval '1 minute',now(),1000,360,10,20 from generate_series(1,105)",[uid(1),gid]);
  await db.query("insert into radar_rides(user_id,group_id,status,started_at,ended_at,distance_m,duration_s) values($1,$2,'finished',now()-interval '1 minute',now(),2000,1800),($1,$2,'finished',now()-interval '90 days',now()-interval '89 days',5000,900)",[uid(1),gid]);
  const all=(await db.query("select * from radar_group_stats($1,'all')",[gid])).rows;
  assert.equal(all.length,2);assert.equal(all[0].display_name,'Ana');assert.equal(all[0].distance_m,112000);assert.equal(all[0].ride_count,107);assert.equal(all[0].max_speed_kmh,36);assert.equal(all[0].elevation_gain_m,2100);
  assert.ok(Math.abs(all[0].avg_speed_kmh-112000/40500*3.6)<0.00001);
  assert.equal(all[1].distance_m,0);assert.equal(all[1].avg_speed_kmh,0);
  const month=(await db.query("select * from radar_group_stats($1,'month')",[gid])).rows;
  assert.equal(month[0].distance_m,107000);assert.equal(month[0].ride_count,106);
  await assert.rejects(db.query("select * from radar_group_stats($1,'invalid')",[gid]),/Periodo/);
  await db.exec('reset role;set role anon');
  await assert.rejects(db.query('select * from radar_group_alerts($1)',[gid]),/permission denied/);
 }finally{await db.close();}
});
