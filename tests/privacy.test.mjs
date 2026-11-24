import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('Grupos privados, autoría del GPS y pausa que oculta posiciones',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261123_independent_radar.sql',import.meta.url),'utf8'));
 const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 async function as(n){await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${uid(n)}'`);}
 await as(1);
 const gid=(await db.query("select public.radar_create_group('Bici amigos','Ana') id")).rows[0].id;
 const invite=(await db.query('select invite_code from public.radar_groups')).rows[0].invite_code;
 const ride=(await db.query("insert into public.radar_rides(user_id,group_id) values($1,$2) returning id",[uid(1),gid])).rows[0].id;
 await db.query('insert into public.radar_points(ride_id,user_id,latitude,longitude,accuracy_m,recorded_at) values($1,$2,4.7,-74.1,8,now())',[ride,uid(1)]);
 assert.equal((await db.query('select * from public.radar_live_locations($1)',[gid])).rows.length,1);
 await as(2);
 assert.equal((await db.query('select * from public.radar_groups')).rows.length,0);
 assert.equal((await db.query('select * from public.radar_rides')).rows.length,0);
 await assert.rejects(db.query('select * from public.radar_live_locations($1)',[gid]),/No perteneces/);
 await assert.rejects(db.query("select public.radar_join_group('incorrecto','Carlos')"),/incorrecto/);
 await db.query("select public.radar_join_group($1,'Carlos')",[invite]);
 assert.equal((await db.query('select * from public.radar_live_locations($1)',[gid])).rows.length,1);
 assert.equal((await db.query('select * from public.radar_points')).rows.length,0,'El grupo no ve el historial GPS de Ana');
 await assert.rejects(db.query('insert into public.radar_points(ride_id,user_id,latitude,longitude,accuracy_m,recorded_at) values($1,$2,4,-74,8,now())',[ride,uid(1)]),/row-level security/);
 await assert.rejects(db.query('insert into public.radar_points(ride_id,user_id,latitude,longitude,accuracy_m,recorded_at) values($1,$2,4,-74,8,now())',[ride,uid(2)]),/row-level security/);
 assert.equal((await db.query("update public.radar_rides set status='paused' where id=$1 returning id",[ride])).rows.length,0,'No puede pausar la salida de otra persona');
 await assert.rejects(db.query('update public.radar_groups set invite_code=\'inventado\' where id=$1',[gid]),/permission denied/);
 await as(1);
 await db.query("update public.radar_rides set status='paused' where id=$1",[ride]);
 await as(2);assert.equal((await db.query('select * from public.radar_live_locations($1)',[gid])).rows.length,0,'Pausa retira la ubicación del radar');
 await as(1);
 await db.query("update public.radar_rides set status='finished',ended_at=now() where id=$1",[ride]);
 await as(3);assert.equal((await db.query('select * from public.radar_rides')).rows.length,0);
 await db.exec('reset role;set role anon');
 await assert.rejects(db.query('select * from public.radar_points'),/permission denied/);
 await assert.rejects(db.query("select public.radar_create_group('Grupo','Intruso')"),/permission denied/);
 } finally {await db.close();}
});
