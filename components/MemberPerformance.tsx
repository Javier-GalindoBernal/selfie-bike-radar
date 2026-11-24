'use client';
import { useEffect, useState } from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {periodLabels,sumStats,type MemberStats,type Period} from '@/lib/group-features';
import {fmtKm,fmtDur} from '@/lib/geo';
import {featureError} from './GroupSafety';
const DEMO_STATS:MemberStats[]=[{user_id:'a',display_name:'Ana · ejemplo',distance_m:142600,duration_s:22020,ride_count:4,avg_speed_kmh:23.3,max_speed_kmh:42.8,elevation_gain_m:1080,last_ride_at:null},{user_id:'b',display_name:'Carlos · ejemplo',distance_m:118300,duration_s:20160,ride_count:3,avg_speed_kmh:21.1,max_speed_kmh:39.5,elevation_gain_m:860,last_ride_at:null},{user_id:'c',display_name:'Luisa · ejemplo',distance_m:84700,duration_s:15120,ride_count:3,avg_speed_kmh:20.2,max_speed_kmh:36.9,elevation_gain_m:620,last_ride_at:null}];
export default function MemberPerformance({client,groupId,demo,userId}:{client:SupabaseClient|null;groupId:string;demo:boolean;userId:string}){
 const [period,setPeriod]=useState<Period>('week'),[rows,setRows]=useState<MemberStats[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{
  let active=true;
  async function refresh(){
   if(demo||!client||!groupId)return;
   setLoading(true);
   const {data,error}=await client.rpc('radar_group_stats',{gid:groupId,period});
   if(!active)return;
   if(error){setError(featureError(error));setRows([]);}else{setRows(data||[]);setError('');}setLoading(false);
  }
  void Promise.resolve().then(refresh);const timer=setInterval(()=>void refresh(),30000);return()=>{active=false;clearInterval(timer);};
 },[client,groupId,demo,period]);
 const factor=period==='month'?3:period==='all'?14:1;
 const shown=demo?DEMO_STATS.map(r=>({...r,distance_m:r.distance_m*factor,duration_s:r.duration_s*factor,ride_count:r.ride_count*factor,elevation_gain_m:r.elevation_gain_m*factor})):rows;
 const totals=sumStats(shown),max=Math.max(1,...shown.map(r=>r.distance_m));
 return <section className="performance-panel"><div className="panel-heading"><div><h2>Kilómetros y desempeño por integrante</h2><span>Salidas finalizadas en este grupo · sin límite de 100 salidas</span></div><div className="period-switch" role="group" aria-label="Periodo de estadísticas">{(Object.keys(periodLabels) as Period[]).map(p=><button key={p} className={period===p?'selected':''} onClick={()=>{setPeriod(p);setRows([]);}}>{periodLabels[p]}</button>)}</div></div>{error&&<p role="alert" className="alert">{error}</p>}{demo&&<p className="subtle">Cifras ficticias para probar la vista de estadísticas.</p>}<div className="stats-grid"><article className="metric"><span>Kilómetros del grupo</span><strong>{(totals.distance/1000).toFixed(1)}</strong><small>{periodLabels[period].toLowerCase()}</small></article><article className="metric"><span>Tiempo activo</span><strong>{fmtDur(totals.duration)}</strong><small>excluye pausas manuales</small></article><article className="metric"><span>Salidas terminadas</span><strong>{totals.count}</strong><small>sumadas por integrante</small></article><article className="metric"><span>Integrantes</span><strong>{shown.length}</strong><small>miembros actuales del grupo</small></article></div>
 {loading&&<p role="status" className="subtle">Actualizando estadísticas…</p>}{!shown.length&&!loading&&!error&&<p className="empty">Crea o selecciona un grupo para ver sus estadísticas.</p>}
 <div className="table-scroll"><table><thead><tr><th>Integrante</th><th>Kilómetros</th><th>Salidas</th><th>Tiempo activo</th><th>Media</th><th>Máxima</th><th>Ascenso GPS</th></tr></thead><tbody>{shown.map((r,i)=><tr key={r.user_id} className={r.user_id===userId?'own-stat':''}><td><b>{i+1}. {r.display_name}{r.user_id===userId?' · tú':''}</b><div className="distance-bar"><span style={{width:`${r.distance_m/max*100}%`}}/></div></td><td><b>{fmtKm(r.distance_m)}</b></td><td>{r.ride_count}</td><td>{fmtDur(r.duration_s)}</td><td>{r.avg_speed_kmh.toFixed(1)} km/h</td><td>{r.max_speed_kmh.toFixed(1)} km/h</td><td>{Math.round(r.elevation_gain_m)} m</td></tr>)}</tbody></table></div><p className="safety-hint">La velocidad media usa distancia y tiempo activo. El ascenso depende de la calidad del GPS; las salidas anteriores no tienen esta medición. Pulso, potencia y cadencia requieren sensores compatibles.</p></section>;
}
