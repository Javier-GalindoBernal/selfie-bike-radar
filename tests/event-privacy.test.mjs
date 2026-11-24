import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('La ubicación solo la ven quienes salen en la misma salida del grupo',async()=>{
 const db=new PGlite();
 const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 async function as(n){await db.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${uid(n)}'`);}
 const q=async(sql,p)=>{try{return await db.query(sql,p);}catch(e){e.message+=' @ '+sql;throw e;}};
 const live=async n=>{await as(n);return (await q('select display_name,event_title from radar_live_locations($1) order by 1',[gid])).rows.map(r=>r.display_name);};
 let gid;
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),last_sign_in_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;insert into auth.users(id,email) values('${uid(1)}','a@x'),('${uid(2)}','b@x'),('${uid(3)}','c@x'),('${uid(4)}','d@x'),('${uid(9)}','z@x');`);
  for(const f of ['20261123_independent_radar','20261124_alerts_and_stats','20261126_admin_groups_messages'])await db.exec(await readFile(new URL(`../supabase/migrations/${f}.sql`,import.meta.url),'utf8'));
  const mig=await readFile(new URL('../supabase/migrations/20261127_group_events_privacy.sql',import.meta.url),'utf8');
  await db.exec(mig);await db.exec(mig);
  await as(1);gid=(await q("select radar_create_group('Selfie Bike','Ana') id")).rows[0].id;
  const code=(await q('select invite_code from radar_groups')).rows[0].invite_code;
  for(const [n,name] of [[2,'Beto'],[3,'Cami'],[4,'Dani']]){await as(n);await q("select radar_join_group($1,$2)",[code,name]);}
  // ruta compartida con validación
  await as(1);
  await assert.rejects(q("select radar_share_route($1,'Mala',1000,0,'GPX','[[1,2]]'::jsonb)",[gid]),/entre 2 y 3000/);
  await assert.rejects(q("select radar_share_route($1,'Mala',1000,0,'GPX','[[95,2],[1,2]]'::jsonb)",[gid]),/inválidas/);
  const route=(await q("select radar_share_route($1,'Vuelta a Zipaquirá',32000,450,'Dibujada','[[5.0,-74.0],[5.01,-74.0],[5.02,-74.01]]'::jsonb) id",[gid])).rows[0].id;
  await as(9);await assert.rejects(q('select * from radar_group_routes($1)',[gid]),/No perteneces/);
  await assert.rejects(q('select radar_group_route_coords($1)',[route]),/no disponible/);
  await as(2);assert.equal((await q('select jsonb_array_length(radar_group_route_coords($1)) n',[route])).rows[0].n,3);
  // dos salidas: una abierta ahora (sábado) y otra futura (otro día), misma ruta
  await as(1);
  const sat=(await q("select radar_create_event($1,'Sábado Zipaquirá',now()+interval '30 minutes',$2,'Salimos 6am',6) id",[gid,route])).rows[0].id;
  const sun=(await q("select radar_create_event($1,'Otro día',now()+interval '3 days',$2) id",[gid,route])).rows[0].id;
  await assert.rejects(q("select radar_create_event($1,'Pasada',now()-interval '1 day')",[gid]),/ya pasó/);
  await assert.rejects(q("select radar_create_event($1,'Salida X',now()+interval '1 day',gen_random_uuid())",[gid]),/no pertenece/);
  // apuntarse
  await as(2);await q('select radar_event_join($1)',[sat]);
  await as(3);await q('select radar_event_join($1)',[sat]);await q('select radar_event_join($1)',[sat]);
  await as(4);await q('select radar_event_join($1)',[sun]);
  await as(9);await assert.rejects(q('select radar_event_join($1)',[sat]),/no disponible/);
  await as(1);const list=(await q('select * from radar_group_events($1)',[gid])).rows;
  assert.equal(list.length,2);assert.equal(list[0].title,'Sábado Zipaquirá');assert.equal(Number(list[0].participants),3);assert.equal(list[0].open_now,true);assert.equal(list[1].open_now,false);
  // iniciar salidas: no se puede asociar a un evento al que no te apuntaste o que no está abierto
  const ride=async(n,event)=>{await as(n);const id=crypto.randomUUID();await q('insert into radar_rides(id,user_id,group_id,event_id) values($1,$2,$3,$4)',[id,uid(n),gid,event]);await q("insert into radar_points(ride_id,user_id,latitude,longitude,accuracy_m,recorded_at) values($1,$2,5.0,-74.0,5,now())",[id,uid(n)]);return id;};
  await as(4);await assert.rejects(q('insert into radar_rides(user_id,group_id,event_id) values($1,$2,$3)',[uid(4),gid,sat]),/row-level security/); // Dani no está en el sábado
  await assert.rejects(q('insert into radar_rides(user_id,group_id,event_id) values($1,$2,$3)',[uid(4),gid,sun]),/row-level security/); // el evento aún no abre
  // Ana (creadora, apuntada) y Beto salen en el sábado; Cami se apuntó pero no sale; Dani sale en privado
  await ride(1,sat);await ride(2,sat);await ride(4,null);
  assert.deepEqual(await live(1),['Ana','Beto']);
  assert.deepEqual(await live(2),['Ana','Beto']);
  assert.deepEqual(await live(3),[]);            // apuntada pero sin salir: no ve a nadie (no es administradora)
  assert.deepEqual(await live(4),[]);            // salida privada: no ve ni es vista
  assert.equal((await live(1)).includes('Dani'),false);
  // Cami sale en el sábado: ahora ve a Ana y Beto, y ellos la ven
  await ride(3,sat);
  assert.deepEqual(await live(3),['Ana','Beto','Cami']);
  assert.deepEqual(await live(2),['Ana','Beto','Cami']);
  // Beto se baja de la salida: deja de verse y de ver
  await as(2);await q('select radar_event_leave($1)',[sat]);
  assert.deepEqual(await live(1),['Ana','Cami']);
  assert.deepEqual(await live(2),[]);
  // cancelar la salida oculta a todos
  await as(3);await assert.rejects(q('select radar_event_cancel($1)',[sat]),/Solo quien/);
  await as(1);await q('select radar_event_cancel($1)',[sat]);
  assert.deepEqual(await live(1),[]);
  assert.deepEqual(await live(3),[]);
  await as(2);await assert.rejects(q('select radar_event_join($1)',[sat]),/cancelada/);
  // borrar ruta compartida: solo su autora o administradores
  await as(2);await assert.rejects(q('select radar_delete_shared_route($1)',[route]),/Solo quien/);
  await as(1);await q('select radar_delete_shared_route($1)',[route]);
  assert.equal((await q('select * from radar_group_routes($1)',[gid])).rows.length,0);
  await db.exec('reset role');
  assert.equal((await q('select route_id from radar_events where id=$1',[sun])).rows[0].route_id,null); // on delete set null
 }finally{await db.close();}
});
