'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { alertKinds, type AlertKind, type GroupAlert } from '@/lib/group-features';
import { fmtAgo } from '@/lib/geo';

type Props={client:SupabaseClient|null;groupId:string;groupName:string;userId:string;demo:boolean;position:[number,number]|null};
export default function GroupSafety({client,groupId,groupName,userId,demo,position}:Props){
 const [alerts,setAlerts]=useState<GroupAlert[]>([]),[kind,setKind]=useState<AlertKind|null>(null),[message,setMessage]=useState(''),[attach,setAttach]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),draftId=useRef('');
 const [draftPosition,setDraftPosition]=useState<[number,number]|null>(null);
 const load=useCallback(async()=>{
  if(demo||!client||!groupId)return null;
  const {data,error}=await client.rpc('radar_group_alerts',{gid:groupId});
  if(error)throw error;return data as GroupAlert[];
 },[client,groupId,demo]);
 useEffect(()=>{
  let active=true;
  const refresh=()=>load().then(data=>{if(active&&data){setAlerts(data);setError('');}}).catch(e=>{if(active)setError(featureError(e));});
  void refresh();const timer=setInterval(refresh,10000);return()=>{active=false;clearInterval(timer);};
 },[load]);
 useEffect(()=>{if(kind)dialog.current?.showModal();else dialog.current?.close();},[kind]);
 function choose(value:AlertKind){draftId.current=crypto.randomUUID();setDraftPosition(position);setKind(value);setMessage('');setAttach(false);setError('');setNotice('');}
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(featureError(e));}finally{setBusy(false);}}
 async function send(){if(!kind)return;await run(async()=>{
  const coordinates=attach?draftPosition:null;
  const details=message.trim();if(kind==='other'&&!details)throw new Error('Escribe qué necesitas comunicar.');
  if(demo){setAlerts(old=>[{id:draftId.current,user_id:userId,display_name:'Tú · ejemplo',kind,message:details,latitude:coordinates?.[0]??null,longitude:coordinates?.[1]??null,created_at:new Date().toISOString(),ack_count:0,acknowledged:false},...old]);setNotice('Aviso de ejemplo creado. No se ha enviado a ninguna persona.');}
  else{
   if(!client||!groupId)throw new Error('Selecciona un grupo e inicia sesión.');
   if(!navigator.onLine)throw new Error('Sin internet: el aviso no se ha enviado. Los avisos no se guardan para enviarlos más tarde.');
   const {error}=await client.rpc('radar_send_alert',{gid:groupId,alert_kind:kind,details,alert_lat:coordinates?.[0]??null,alert_lng:coordinates?.[1]??null,client_id:draftId.current});if(error)throw error;
   const rows=await load();if(rows)setAlerts(rows);setNotice('Aviso publicado en el grupo.');
  }
  setKind(null);
 });}
 async function respond(alert:GroupAlert,resolve:boolean){await run(async()=>{
  if(demo){setAlerts(old=>resolve?old.filter(a=>a.id!==alert.id):old.map(a=>a.id===alert.id?{...a,ack_count:a.ack_count+1,acknowledged:true}:a));return;}
  if(!client)return;
  const {error}=await client.rpc(resolve?'radar_resolve_alert':'radar_ack_alert',{aid:alert.id});if(error)throw error;
  const rows=await load();if(rows)setAlerts(rows);setNotice(resolve?'Aviso resuelto.':'El grupo puede ver que te acercas a ayudar.');
 });}
 return <section className="safety-panel" aria-labelledby="safety-title"><div className="panel-heading"><div><h2 id="safety-title">Avisar al grupo</h2><span>Pinchazos, averías y ayuda durante la rodada</span></div><span className="badge">{alerts.length} activos</span></div>
 <div className="alert-buttons">{alertKinds.map(item=><button key={item.id} className={`alert-trigger ${item.id==='health'?'health':''}`} disabled={busy||!groupId} onClick={()=>choose(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}</div>
 <p className="safety-hint">Los avisos se ven con la app abierta y conexión a internet. No llaman a servicios de emergencia. Caducan a las 24 horas.</p>
 {error&&<p role="alert" className="alert">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
 <div className="active-alerts" aria-live="polite">{alerts.length===0?<p className="subtle">No hay avisos activos en el grupo.</p>:alerts.map(alert=>{const item=alertKinds.find(k=>k.id===alert.kind)!;return <article className={`group-alert ${alert.kind==='health'?'health':''}`} key={alert.id}><div><strong>{item.icon} {item.label} · {alert.display_name}</strong><small>{fmtAgo(alert.created_at)}</small><p>{alert.message||item.description}</p>{alert.latitude!==null&&alert.longitude!==null&&<a href={`https://www.openstreetmap.org/?mlat=${alert.latitude}&mlon=${alert.longitude}#map=16/${alert.latitude}/${alert.longitude}`} target="_blank" rel="noreferrer">Ver ubicación adjunta</a>}<span className="subtle">{alert.ack_count} {alert.ack_count===1?'compañero se acerca':'compañeros se acercan'}</span></div><button className="ghost" disabled={busy||alert.acknowledged&&alert.user_id!==userId} onClick={()=>void respond(alert,alert.user_id===userId)}>{alert.user_id===userId?'Marcar resuelto':alert.acknowledged?'Ya avisaste que ayudas':'Me acerco a ayudar'}</button></article>;})}</div>
 <dialog ref={dialog} className="alert-dialog" onCancel={()=>{if(!busy)setKind(null);}} onClose={()=>{if(!busy)setKind(null);}}><form onSubmit={e=>{e.preventDefault();void send();}}><span className="eyebrow">{demo?'PRUEBA SIN ENVÍO REAL':'AVISO A TU GRUPO'}</span><h2>{alertKinds.find(a=>a.id===kind)?.label}</h2><p>Lo verán los integrantes de <b>{groupName}</b>.</p><label htmlFor="alert-details">¿Qué necesitas? {kind!=='other'&&'(opcional)'}</label><textarea id="alert-details" maxLength={280} required={kind==='other'} value={message} onChange={e=>setMessage(e.target.value)} placeholder={alertKinds.find(a=>a.id===kind)?.description}/><p className="subtle">{message.length}/280 caracteres</p><label className="checkbox-row"><input type="checkbox" checked={attach} disabled={!draftPosition} onChange={e=>setAttach(e.target.checked)}/>Adjuntar mi ubicación actual</label>{!draftPosition&&<p className="subtle">Pulsa «Ubicarme» en el radar antes de adjuntar una posición.</p>}{kind==='health'&&<p className="alert">Este botón avisa al grupo. No realiza una llamada ni garantiza atención inmediata.</p>}{error&&<p role="alert" className="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="ghost" disabled={busy} onClick={()=>setKind(null)}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Enviando…':demo?'Crear aviso de ejemplo':'Enviar aviso al grupo'}</button></div></form></dialog>
 </section>;
}
export function featureError(e:unknown){const message=typeof e==='object'&&e&&'message'in e?String(e.message):String(e);if(/schema cache|does not exist|Could not find/.test(message))return 'Falta activar los avisos y estadísticas nuevos en Supabase. El resto del radar sigue disponible.';if(/abort|fetch|network/i.test(message))return 'No se confirmó la operación por un problema de conexión. Actualiza los avisos antes de reintentar.';return message;}
