'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import GroupSafety from '@/components/GroupSafety';
import MemberPerformance from '@/components/MemberPerformance';
import Recorder from '@/components/Recorder';
import RoutesPanel from '@/components/RoutesPanel';
import GroupAdmin, { MessageBanner } from '@/components/GroupAdmin';
import AppAdmin from '@/components/AppAdmin';
import { useRoutes } from '@/lib/routeStore';
import { IconPlay, tabIcon } from '@/components/Icons';
import Logo from '@/components/Logo';
import Avatar, { resizeSquare } from '@/components/Avatar';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { radarClient, type Group, type Rider, type Ride } from '@/lib/radar';
import { fetchWithTimeout, savedConfig, type PublicConfig } from '@/lib/client-config';
import { fmtAgo, fmtKm, fmtDur } from '@/lib/geo';
import { roadRoute, type RoadRoute } from '@/lib/route';

const MapView=dynamic(()=>import('@/components/Map'),{ssr:false,loading:()=> <div className="map-loading">Cargando el mapa…</div>});
const DEMO_GROUP:Group={id:'demo',name:'Rodada de muestra',invite_code:'DEMO — sin miembros reales'};
const DEMO_RIDERS:Rider[]=[{user_id:'a',display_name:'Ana · ejemplo',latitude:4.863,longitude:-74.052,speed_mps:6.2,accuracy_m:8,recorded_at:'2026-11-23T15:00:00Z'},{user_id:'b',display_name:'Carlos · ejemplo',latitude:4.878,longitude:-74.042,speed_mps:5.8,accuracy_m:11,recorded_at:'2026-11-23T15:00:00Z'},{user_id:'c',display_name:'Luisa · ejemplo',latitude:4.854,longitude:-74.071,speed_mps:0,accuracy_m:6,recorded_at:'2026-11-23T15:00:00Z'}];

export default function Radar(){
 const [client,setClient]=useState<SupabaseClient|null>(null),[session,setSession]=useState<Session|null>(null);
 const [url,setUrl]=useState(''),[key,setKey]=useState(''),[ready,setReady]=useState(false),[demo,setDemo]=useState(false);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[signUp,setSignUp]=useState(false);
 const [groups,setGroups]=useState<Group[]>([]),[gid,setGid]=useState(''),[riders,setRiders]=useState<Rider[]>([]),[rides,setRides]=useState<Ride[]>([]);
 const [tab,setTab]=useState('radar'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [name,setName]=useState(''),[groupName,setGroupName]=useState(''),[code,setCode]=useState(''),[me,setMe]=useState<[number,number]|null>(null);
 const [lastSync,setLastSync]=useState<Date|null>(null),[connected,setConnected]=useState(true);
 const watch=useRef<number|null>(null);const [locMsg,setLocMsg]=useState('');const [fullName,setFullName]=useState('');const [forgot,setForgot]=useState(false),[recovering,setRecovering]=useState(false),[newPass,setNewPass]=useState(''),[isAppAdmin,setIsAppAdmin]=useState(false);const [routes,setRoutes]=useState<Record<string,RoadRoute|null>>({}),[trails,setTrails]=useState<Record<string,[number,number][]>>({}),[viewRide,setViewRide]=useState<{id:string;name:string;track:[number,number][][];km:number}|null>(null);const [locBusy,setLocBusy]=useState(false);
 const [now,setNow]=useState(0);
 useEffect(()=>{const first=setTimeout(()=>setNow(Date.now()),0);const timer=setInterval(()=>setNow(Date.now()),10000);return()=>{clearTimeout(first);clearInterval(timer);};},[]);
 useEffect(()=>{
  let alive=true;
  async function boot(){
   let fallback:PublicConfig={url:process.env.NEXT_PUBLIC_SUPABASE_URL||'',key:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||''};
   let warning='';
   if(!(fallback.url&&fallback.key))try {
    const response=await fetchWithTimeout('/api/config',{cache:'no-store'},5000);
    if(!response.ok)throw new Error('Configuración no disponible');
    const data=await response.json();
    fallback={url:typeof data.url==='string'?data.url:'',key:typeof data.key==='string'?data.key:''};
   }catch{warning='No pudimos cargar la conexión del servidor. Revisa tu internet e inténtalo de nuevo.';}
   if(!alive)return;
   let config=fallback;
   try{const saved=savedConfig(window.localStorage,fallback);config=saved.config;warning=saved.warning||warning;}catch{warning='Tu navegador no permite guardar la conexión. Podrás usarla durante esta sesión.';}
   setUrl(config.url);setKey(config.key);
   if(config.url&&config.key)try{setClient(radarClient(config.url,config.key));}catch(e){warning=friendly(e);}
   const preview=new URLSearchParams(window.location.search);
   if(preview.get('demo')==='1'){setDemo(true);setGid('demo');const view=preview.get('vista');if(view&&['radar','record','history','performance','group'].includes(view))setTab(view);}
   setError(warning);setReady(true);
  }
  void boot();
  const online=()=>setConnected(navigator.onLine);online();window.addEventListener('online',online);window.addEventListener('offline',online);
  return()=>{alive=false;window.removeEventListener('online',online);window.removeEventListener('offline',online);if(watch.current!==null)navigator.geolocation.clearWatch(watch.current);};
 },[]);
 useEffect(()=>{
  if(!client)return;
  client.auth.getSession().then(({data,error})=>{if(error)throw error;setSession(data.session);}).catch(e=>setError(friendly(e)));
  const {data}=client.auth.onAuthStateChange((event,s)=>{if(event==='PASSWORD_RECOVERY')setRecovering(true);setSession(s);if(event==='SIGNED_IN'||event==='SIGNED_OUT'){setGroups([]);setGid('');setRiders([]);setRides([]);}});
  return()=>data.subscription.unsubscribe();
 },[client]);
 const loadGroups=useCallback(async()=>{
  if(!client||!session||demo)return;
  const {data,error}=await client.from('radar_groups').select('id,name,invite_code').order('created_at');
  if(error)throw error;
  setGroups(data||[]);setGid(old=>old||(data?.[0]?.id??''));
 },[client,session,demo]);
 useEffect(()=>{Promise.resolve().then(loadGroups).catch(e=>setError(friendly(e)));},[loadGroups]);
 useEffect(()=>{
  let alive=true;
  if(!client||!session){Promise.resolve().then(()=>setIsAppAdmin(false));return;}
  client.rpc('radar_whoami').then(({data,error})=>{if(alive)setIsAppAdmin(!error&&data===true);});
  return()=>{alive=false;};
 },[client,session]);
 const load=useCallback(async(isCurrent:()=>boolean)=>{
  if(!client||!session||!gid||demo)return;
  const [live,history]=await Promise.all([client.rpc('radar_live_locations',{gid}),client.from('radar_rides').select('*').eq('group_id',gid).order('started_at',{ascending:false}).limit(100)]);
  if(!isCurrent())return;
  if(live.error||history.error)throw live.error||history.error;
  setRiders(live.data||[]);setRides(history.data||[]);setLastSync(new Date());
  setTrails(prev=>{const next:Record<string,[number,number][]>={};for(const r of (live.data||[]) as Rider[]){const old=prev[r.user_id]||[];const last=old[old.length-1];next[r.user_id]=!last||last[0]!==r.latitude||last[1]!==r.longitude?[...old,[r.latitude,r.longitude] as [number,number]].slice(-300):old;}return next;});
 },[client,session,gid,demo]);
 useEffect(()=>{
  let active=true;
  const refresh=()=>load(()=>active).catch(e=>{if(active){setError(friendly(e));setRiders([]);}});
  refresh();const id=setInterval(refresh,10000);return()=>{active=false;clearInterval(id);};
 },[load]);
 async function action(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(friendly(e));}finally{setBusy(false);}}
 async function configure(){await action(async()=>{
  const endpoint=url.trim().replace(/\/$/,'');const publicKey=key.trim();
  const c=radarClient(endpoint,publicKey);
  const response=await fetchWithTimeout(`${endpoint}/auth/v1/settings`,{headers:{apikey:publicKey}});
  if(!response.ok)throw new Error('Supabase no aceptó la conexión. Revisa que la dirección y la clave pública sean del mismo proyecto.');
  try{localStorage.setItem('radar-public-config',JSON.stringify({url:endpoint,key:publicKey}));}catch{setNotice('Conexión activa para esta sesión. El navegador no permitió guardarla.');}
  setClient(c);
 });}
 async function auth(){if(!client)return;await action(async()=>{
  const {error}=signUp?await client.auth.signUp({email,password,options:{data:{full_name:fullName.trim()}}}):await client.auth.signInWithPassword({email,password});if(error)throw error;
  if(signUp)setNotice('¡Cuenta creada! Si te llega un correo de confirmación, ábrelo y luego inicia sesión.');
 });}
 async function uploadAvatar(file:File){if(!client||!session)return;await action(async()=>{
  const blob=await resizeSquare(file,256);
  const {error}=await client.storage.from('avatars').upload(`${session.user.id}/avatar.jpg`,blob,{upsert:true,contentType:'image/jpeg',cacheControl:'300'});
  if(error){if(/bucket not found|not found/i.test(error.message))throw new Error('Falta activar las fotos de perfil: ejecuta supabase/migrations/20261125_profile_avatars.sql en el SQL Editor de Supabase.');throw error;}
  const {error:e2}=await client.auth.updateUser({data:{avatar_v:Date.now()}});if(e2)throw e2;
  setNotice('Foto de perfil actualizada.');
 });}
 async function sendReset(){if(!client)return;await action(async()=>{
  const {error}=await client.auth.resetPasswordForEmail(email.trim(),{redirectTo:window.location.origin});if(error)throw error;
  setNotice('Si ese correo tiene cuenta, te enviamos un enlace para crear una contraseña nueva. Revisa también el correo no deseado.');
 });}
 async function saveNewPassword(){if(!client)return;await action(async()=>{
  const {error}=await client.auth.updateUser({password:newPass});if(error)throw error;
  setNewPass('');setRecovering(false);setNotice('Contraseña actualizada. Ya puedes usar la app.');
 });}
 async function groupAction(join:boolean){if(!client)return;await action(async()=>{
  const {data,error}=await client.rpc(join?'radar_join_group':'radar_create_group',join?{code:code.trim(),member_name:name.trim()}:{group_name:groupName.trim(),member_name:name.trim()});if(error)throw error;
  await loadGroups();setGid(data);setCode('');setGroupName('');setNotice(join?'Ya eres parte del grupo.':'Grupo creado. Comparte el código solo con tus compañeros.');
 });}
 function locate(){
  if(!navigator.geolocation){setLocMsg('Este navegador no permite obtener tu ubicación.');return;}
  if(watch.current!==null){navigator.geolocation.clearWatch(watch.current);watch.current=null;}
  setLocBusy(true);setLocMsg('Buscando tu ubicación… acepta el permiso si el teléfono lo pide.');
  const fail=(err:GeolocationPositionError)=>{setLocBusy(false);if(watch.current!==null){navigator.geolocation.clearWatch(watch.current);watch.current=null;}setLocMsg(err.code===1?'Permiso de ubicación denegado. iPhone: Ajustes → Privacidad y seguridad → Localización → Safari (o Bike Radar) → «Al usar la app», y activa «Ubicación precisa». Android: toca el candado de la barra de direcciones → Permisos → Ubicación → Permitir. Si abriste el enlace desde WhatsApp, Instagram u otra app, ábrelo en Safari o Chrome.':err.code===2?'No se pudo determinar tu posición. Activa el GPS y sal a un lugar abierto.':'La ubicación tardó demasiado. Inténtalo de nuevo.');};
  const ok=(p:GeolocationPosition)=>{setMe([p.coords.latitude,p.coords.longitude]);setLocBusy(false);setLocMsg(`Ubicación obtenida (±${Math.round(p.coords.accuracy)} m).`);};
  navigator.geolocation.getCurrentPosition(ok,fail,{enableHighAccuracy:false,maximumAge:60000,timeout:15000});
  watch.current=navigator.geolocation.watchPosition(ok,()=>{},{enableHighAccuracy:true,maximumAge:10000,timeout:30000});
 }
 type RidePoint={latitude:number;longitude:number;recorded_at:string;segment:number;altitude_m:number|null};
 async function ridePoints(ride:Ride):Promise<RidePoint[]>{
  const points:RidePoint[]=[];if(!client)return points;
  for(let offset=0;;offset+=1000){
   const {data,error}=await client.from('radar_points').select('latitude,longitude,recorded_at,segment,altitude_m').eq('ride_id',ride.id).order('recorded_at').order('id').range(offset,offset+999);
   if(error)throw error;points.push(...(data||[]));if(!data||data.length<1000)break;
  }
  return points;
 }
 async function showRide(ride:Ride){await action(async()=>{
  const points=await ridePoints(ride);if(!points.length)throw new Error('Esta salida todavía no tiene puntos sincronizados.');
  const track:[number,number][][]=[];let seg=-1;for(const p of points){if(p.segment!==seg){track.push([]);seg=p.segment;}track[track.length-1].push([Number(p.latitude),Number(p.longitude)]);}
  setViewRide({id:ride.id,name:ride.name,track,km:ride.distance_m});
 });}
 async function exportRide(ride:Ride){if(!client)return;await action(async()=>{
  const points=await ridePoints(ride);
  if(!points.length)throw new Error('Esta salida todavía no tiene puntos sincronizados.');
  let lastSegment=-1;
  const track=points.map(p=>{const boundary=p.segment!==lastSegment?(lastSegment===-1?'<trkseg>':'</trkseg><trkseg>'):'';lastSegment=p.segment;return `${boundary}<trkpt lat="${Number(p.latitude)}" lon="${Number(p.longitude)}">${p.altitude_m===null?'':`<ele>${Number(p.altitude_m)}</ele>`}<time>${new Date(p.recorded_at).toISOString()}</time></trkpt>`;}).join('')+'</trkseg>';
  const xml=`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Selfie Bike Radar" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Salida en bici</name>${track}</trk></gpx>`;
  const href=URL.createObjectURL(new Blob([xml],{type:'application/gpx+xml'}));const a=document.createElement('a');a.href=href;a.download=`salida-${ride.id}.gpx`;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
 });}
 const activeGroups=demo?[DEMO_GROUP]:groups,activeRiders=demo?DEMO_RIDERS:riders.filter(r=>now-Date.parse(r.recorded_at)<120000),group=activeGroups.find(g=>g.id===gid)||activeGroups[0];
 const myRider=activeRiders.find(r=>r.user_id===session?.user.id);
 const origin:[number,number]|null=me??(myRider?[myRider.latitude,myRider.longitude]:null);
 const others=activeRiders.filter(r=>r.user_id!==session?.user.id);
 const routeKey=origin?`${origin[0].toFixed(3)},${origin[1].toFixed(3)}|${others.map(r=>`${r.user_id}:${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}`).join('|')}`:'';
 useEffect(()=>{
  if(!routeKey||!origin){Promise.resolve().then(()=>setRoutes({}));return;}
  const ctl=new AbortController();
  for(const r of others)roadRoute(origin,[r.latitude,r.longitude],ctl.signal).then(route=>{if(!ctl.signal.aborted)setRoutes(prev=>({...prev,[r.user_id]:route}));});
  return()=>ctl.abort();
  // se recalcula solo cuando cambian posiciones redondeadas (~100 m)
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[routeKey]);
 const finished=rides.filter(r=>r.status==='finished'),week=finished;
 const pins=activeRiders.map(r=>({id:r.user_id,name:r.display_name,pos:[r.latitude,r.longitude] as [number,number],me:r.user_id===session?.user.id}));
 if(me)pins.push({id:'observer',name:'Mi posición',pos:me,me:true});
 const {active:activeRoute}=useRoutes();
 const myV=session?.user.user_metadata?.avatar_v as number|undefined;const myName=String(session?.user.user_metadata?.full_name||session?.user.email||'Yo');
 const header=<header className="topbar"><Link className="brand" href="/"><Logo className="brand-logo" size={58}/><span>SELFIE <b>BIKE RADAR</b><small>Tu grupo. Tu ruta.</small></span></Link><div className="account">{demo?<span className="badge">Vista de ejemplo</span>:session?<><label className="avatar-edit" title="Cambiar foto de perfil"><Avatar key={String(myV)} base={url} userId={session.user.id} name={myName} size={44} v={myV}/><span className="avatar-cam" aria-hidden="true">+</span><input type="file" accept="image/*" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void uploadAvatar(f);}}/></label><span className="account-email">{session.user.email}</span></>:<span className="privacy-label">Grupos privados · sin Strava</span>}{(demo||session)&&<button className="ghost" onClick={()=>{if(demo){setDemo(false);setGid('');}else void client?.auth.signOut();}}>Salir</button>}</div></header>;
 if(!ready)return <main className="app-shell">{header}<p className="loading">Preparando tu radar…</p></main>;
 if(recovering&&session)return <main className="app-shell">{header}<section className="auth-card recovery"><Logo size={90} className="auth-logo"/><h2>Crea tu nueva contraseña</h2><p className="subtle">Escribe una contraseña nueva para tu cuenta ({session.user.email}).</p>{error&&<p role="alert" className="alert">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}<form onSubmit={e=>{e.preventDefault();void saveNewPassword();}}><label>Contraseña nueva<input type="password" required minLength={8} autoComplete="new-password" value={newPass} onChange={e=>setNewPass(e.target.value)} placeholder="Mínimo 8 caracteres"/></label><button className="primary" disabled={busy}>{busy?'Guardando…':'Guardar contraseña'}</button></form></section></main>;
 if(!session&&!demo)return <main className="app-shell">{header}<div className="welcome"><section className="welcome-copy"><Logo size={170} className="welcome-logo"/><span className="eyebrow">HECHO PARA RODAR JUNTOS</span><h1>El grupo siempre<br/><em>a la vista.</em></h1><p>Un lugar para encontrar a tus compañeros, guardar tus salidas y seguir tu progreso. Con tus datos y a tu ritmo.</p><div className="feature-pills"><span>◎ Radar del grupo</span><span>⌁ GPS propio</span><span>↗ Historial de salidas</span></div><button className="text-button" onClick={()=>{setDemo(true);setGid('demo');setError('');}}>Explorar una vista de ejemplo</button><p className="subtle">La app móvil registrará las salidas en Android y iPhone. Desde aquí puedes consultar el radar y tus estadísticas.</p></section><section className="auth-card"><Logo size={110} className="auth-logo"/>{client&&<div className="seg" role="tablist" aria-label="Acceso"><button type="button" role="tab" aria-selected={!signUp} className={!signUp?'on':''} onClick={()=>{setSignUp(false);setForgot(false);setError('');setNotice('');}}>Entrar</button><button type="button" role="tab" aria-selected={signUp} className={signUp?'on':''} onClick={()=>{setSignUp(true);setForgot(false);setError('');setNotice('');}}>Crear cuenta</button></div>}<h2>{!client?'No pudimos conectar':forgot?'Recupera tu contraseña':signUp?'Crea tu cuenta':'Bienvenido de vuelta'}</h2><p className="subtle">{!client?'La conexión con el servidor no cargó.':signUp?'Solo necesitas tu nombre, un correo y una contraseña.':'Inicia sesión para ver a tu grupo y grabar tus salidas.'}</p>{error&&<p role="alert" className="alert">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}{!client?<div className="auth-offline"><button className="primary" onClick={()=>window.location.reload()}>Reintentar</button><details className="advanced"><summary>Configuración avanzada</summary><form onSubmit={e=>{e.preventDefault();configure();}}><label>Dirección de tu proyecto<input type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://tu-proyecto.supabase.co"/></label><label>Clave pública de Supabase<input required value={key} onChange={e=>setKey(e.target.value)} placeholder="sb_publishable_… o anon" autoComplete="off"/></label><button className="ghost" type="submit" disabled={busy}>{busy?'Comprobando…':'Guardar conexión'}</button></form></details></div>:forgot?<form onSubmit={e=>{e.preventDefault();void sendReset();}}><p className="subtle">Escribe tu correo y te enviamos un enlace para crear una contraseña nueva.</p><label>Correo electrónico<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@correo.com"/></label><button className="primary" disabled={busy}>{busy?'Enviando…':'Enviar enlace'}</button><button className="text-button" type="button" onClick={()=>{setForgot(false);setNotice('');setError('');}}>Volver a entrar</button></form>:<form onSubmit={e=>{e.preventDefault();void auth();}}>{signUp&&<label>Tu nombre<input required minLength={2} maxLength={60} autoComplete="name" value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Como te conocen en el grupo"/></label>}<label>Correo electrónico<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@correo.com"/></label><label>Contraseña<input type="password" required minLength={8} autoComplete={signUp?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo 8 caracteres"/></label><button className="primary" disabled={busy}>{busy?'Un momento…':signUp?'Crear mi cuenta':'Entrar'}</button>{!signUp&&<button className="text-button" type="button" onClick={()=>{setForgot(true);setNotice('');setError('');}}>¿Olvidaste tu contraseña?</button>}</form>}</section></div><footer>SELFIE BIKE RADAR <span>Hecha para compartir el camino.</span></footer></main>;
 return <main className="app-shell">{header}<div className="dashboard-heading"><div><span className="eyebrow">TU CENTRO DE RODADAS</span><h1>Vamos juntos.</h1><p>Todo tu grupo, en un solo lugar.</p></div><div className="group-picker"><label htmlFor="group">Tu grupo</label><select id="group" value={gid} onChange={e=>{setGid(e.target.value);setRiders([]);setRides([]);}}>{!activeGroups.length&&<option value="">Crea o únete a un grupo</option>}{activeGroups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></div></div>{demo&&<p className="demo-notice">Datos ficticios para explorar el diseño. No hay personas reales compartiendo ubicación.</p>}{!connected&&<p className="alert">Sin conexión. Las posiciones mostradas pueden estar desactualizadas.</p>}{error&&<p role="alert" className="alert">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}<div className="stats-grid"><Metric title="En el radar" value={String(activeRiders.length)} suffix="compañeros"/><Metric title="Kilómetros recientes · grupo" value={demo?'345.6':(week.reduce((s,r)=>s+r.distance_m,0)/1000).toFixed(1)} suffix="historial reciente, hasta 100 salidas"/><Metric title="Tiempo activo reciente" value={demo?fmtDur(57300):fmtDur(week.reduce((s,r)=>s+r.duration_s,0))} suffix="historial reciente del grupo"/><Metric title="Salidas terminadas" value={demo?'10':String(finished.length)} suffix="últimas 100 del grupo"/></div><nav className="tabs" aria-label="Vistas del radar">{[['radar','Radar'],['history','Rutas'],['record','Grabar'],['performance','Desempeño'],['group','Mi grupo']].map(([id,label])=>{const Ic=tabIcon[id];return <button key={id} className={`${tab===id?'selected':''}${id==='record'?' rec-tab':''}`} aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);window.scrollTo({top:0,behavior:'smooth'});}}><Ic size={id==='record'?30:22}/><span>{label}</span></button>;})}</nav>
 {group&&tab==='radar'&&<GroupSafety key={`safety-${group.id}-${demo}`} client={client} groupId={group.id} groupName={group.name} userId={session?.user.id||'demo-observer'} demo={demo} position={me}/>}
 {tab==='record'&&<Recorder key={`rec-${session?.user.id||'demo'}-${gid}-${demo}`} client={client} userId={session?.user.id||'demo-observer'} groupId={gid} groupName={group?.name||''} demo={demo}/>}
 {tab==='performance'&&<MemberPerformance key={`stats-${gid}-${demo}`} client={client} groupId={gid} userId={session?.user.id||'demo-observer'} demo={demo}/>}
 {tab==='radar'&&!demo&&client&&gid&&<MessageBanner client={client} groupId={gid}/>}
 {tab==='radar'&&<button className="start-cta" onClick={()=>{setTab('record');window.scrollTo({top:0,behavior:'smooth'});}}><span className="start-cta-icon"><IconPlay size={26}/></span><span><strong>Iniciar una salida</strong><small>Graba tu ruta y compártela con tu grupo</small></span></button>}
 {tab==='radar'&&<div className="radar-grid"><section className="map-panel"><div className="panel-heading"><div><h2>{group?.name||'El camino empieza aquí'}</h2><span>{demo?'Mapa de ejemplo':lastSync?`Actualizado ${lastSync.toLocaleTimeString('es-CO')}`:'Esperando una salida'}</span></div><button className="ghost" onClick={locate} disabled={locBusy}>{locBusy?'Buscando…':'Ubicarme'}</button></div>{locMsg&&<p className="map-caption" role="status">{locMsg}</p>}<div className="radar-map"><MapView planned={activeRoute?.coords} pins={pins} routes={others.flatMap(r=>routes[r.user_id]?[{id:r.user_id,coords:routes[r.user_id]!.coords}]:[])} trails={activeRiders.filter(r=>(trails[r.user_id]?.length||0)>1).map(r=>({id:r.user_id,coords:trails[r.user_id]}))}/></div><div className="map-caption">Solo posiciones de salidas activas, recibidas en los últimos 2 minutos. Línea azul: ruta por calles hasta cada compañero. Línea naranja: su recorrido reciente. · v13</div></section><aside className="rider-panel"><div className="panel-heading"><h2>En el camino</h2><span>{activeRiders.length} visibles</span></div>{activeRiders.length===0?<div className="empty"><span>◎</span><h3>El radar está tranquilo</h3><p>Cuando un compañero inicie una salida desde la app móvil, aparecerá aquí.</p>{!group&&<button className="primary" onClick={()=>setTab('group')}>Crear mi grupo</button>}</div>:activeRiders.map((r,i)=><article className="rider" key={r.user_id}><Avatar base={demo?'':url} userId={r.user_id} name={r.display_name} size={44} className={`avatar-${i%3}`}/><div className="rider-info"><h3>{r.display_name}</h3><span>{demo?'Posición de ejemplo':fmtAgo(r.recorded_at)} · ±{Math.round(r.accuracy_m)} m</span><p>{r.speed_mps===null?'Velocidad no disponible':`${(r.speed_mps*3.6).toFixed(1)} km/h`}{r.user_id!==session?.user.id&&origin&&(routes[r.user_id]?` · ${fmtKm(routes[r.user_id]!.distance_m)} por ruta · ~${fmtDur(routes[r.user_id]!.duration_s)} en bici`:r.user_id in routes?' · ruta no disponible':' · calculando ruta…')}</p></div></article>)}<div className="rider-note"><b>Comparte solo al rodar.</b><p>Al pausar o terminar tu salida, tu posición deja de aparecer en el radar.</p></div></aside></div>}
 {tab==='history'&&<RoutesPanel/>}
 {tab==='history'&&<section className="content-panel"><div className="panel-heading"><h2>Salidas del grupo</h2><span>El recorrido GPS es privado</span></div>{viewRide&&<div className="route-viewer"><div className="panel-heading"><h3>{viewRide.name}</h3><button className="ghost" onClick={()=>setViewRide(null)}>Cerrar mapa</button></div><div className="radar-map"><MapView pins={[]} track={viewRide.track}/></div><div className="map-caption">Tu recorrido GPS · {fmtKm(viewRide.km)} · verde = inicio, rojo = final. Solo tú lo ves.</div></div>}{rides.length===0?<div className="empty"><h3>Aún no hay salidas registradas</h3><p>Las salidas de la app aparecerán aquí cuando se sincronicen.</p></div>:<div className="table-scroll"><table><thead><tr><th>Salida</th><th>Fecha</th><th>Distancia</th><th>Tiempo activo</th><th>Estado</th><th>Mi recorrido</th></tr></thead><tbody>{rides.map(r=><tr key={r.id}><td>{r.name}</td><td>{new Date(r.started_at).toLocaleDateString('es-CO')}</td><td>{fmtKm(r.distance_m)}</td><td>{fmtDur(r.duration_s)}</td><td>{r.status==='finished'?'Terminada':r.status==='paused'?'Pausada':'En curso'}</td><td>{r.user_id===session?.user.id&&<><button className="ghost" disabled={busy} onClick={()=>void showRide(r)}>Ver recorrido</button> <button className="ghost" disabled={busy} onClick={()=>void exportRide(r)}>Descargar GPX</button></>}</td></tr>)}</tbody></table></div>}</section>}
 {tab==='group'&&<section className="group-grid">{group&&<article className="content-panel"><span className="eyebrow">TU COMUNIDAD</span><h2>{group.name}</h2><p>Invita a tus compañeros con este código. Al unirse podrán ver las estadísticas del grupo y las posiciones durante las salidas activas.</p><code className="invite-code">{group.invite_code}</code><button className="ghost" disabled={demo} onClick={()=>void action(async()=>{await navigator.clipboard.writeText(group.invite_code);setNotice('Código copiado.');})}>Copiar código</button></article>}{!demo&&client&&group&&session&&<GroupAdmin key={`ga-${group.id}`} client={client} groupId={group.id} groupName={group.name} userId={session.user.id} isAppAdmin={isAppAdmin} base={url} onChanged={async(removed)=>{if(removed)setGid('');await loadGroups();}}/>}{!demo&&<article className="content-panel"><h2>Encuentra a tu grupo</h2><label>Tu nombre en el grupo<input required minLength={2} maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder="Como te conocen tus compañeros"/></label><form onSubmit={e=>{e.preventDefault();void groupAction(false);}}><label>Crear un grupo<input required minLength={2} maxLength={80} value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Nombre del grupo"/></label><button className="primary" disabled={busy||name.trim().length<2}>Crear grupo</button></form><div className="divider">o únete a uno existente</div><form onSubmit={e=>{e.preventDefault();void groupAction(true);}}><label>Código de invitación<input required value={code} onChange={e=>setCode(e.target.value)} placeholder="Pega el código del grupo"/></label><button className="ghost full" disabled={busy||name.trim().length<2}>Unirme al grupo</button></form></article>}{!demo&&isAppAdmin&&client&&session&&<AppAdmin client={client} config={{url,key}} userId={session.user.id} groupId={gid} onChanged={loadGroups}/>}</section>}
 <footer>SELFIE BIKE RADAR <span>Tu ubicación, solo cuando tú decides.</span></footer></main>;
}
function Metric({title,value,suffix}:{title:string;value:string;suffix:string}){return <article className="metric"><span>{title}</span><strong>{value}</strong><small>{suffix}</small></article>;}
function friendly(e:unknown):string{const message=typeof e==='object'&&e&&'message'in e?String(e.message):String(e);if(/schema cache|does not exist|Could not find/.test(message))return 'Falta activar las tablas de la app independiente. Ejecuta la nueva migración en el SQL Editor de Supabase.';if(/AbortError|aborted|Timeout|Failed to fetch|fetch failed|NetworkError/.test(message))return 'La conexión tardó demasiado o no hay internet. Puedes volver a intentarlo.';if(/Invalid login credentials/.test(message))return 'Correo o contraseña incorrectos.';return message;}
