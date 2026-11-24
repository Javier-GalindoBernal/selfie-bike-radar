export const alertKinds = [
 {id:'puncture',label:'Pinchazo',icon:'◉',description:'Se me pinchó una rueda.'},
 {id:'mechanical',label:'Avería mecánica',icon:'⚙',description:'Tengo un desperfecto en la bicicleta.'},
 {id:'health',label:'Problema de salud',icon:'✚',description:'Necesito que el grupo se detenga y me ayude.'},
 {id:'other',label:'Otro aviso',icon:'…',description:'Escribe qué necesitas comunicar.'},
] as const;
export type AlertKind=typeof alertKinds[number]['id'];
export type GroupAlert={id:string;user_id:string;display_name:string;kind:AlertKind;message:string;latitude:number|null;longitude:number|null;created_at:string;ack_count:number;acknowledged:boolean};
export type MemberStats={user_id:string;display_name:string;distance_m:number;duration_s:number;ride_count:number;avg_speed_kmh:number;max_speed_kmh:number;elevation_gain_m:number;last_ride_at:string|null};
export type Period='week'|'month'|'all';
export const periodLabels:Record<Period,string>={week:'Esta semana',month:'Este mes',all:'Acumulado'};
export function sumStats(rows:MemberStats[]){return {distance:rows.reduce((s,r)=>s+r.distance_m,0),duration:rows.reduce((s,r)=>s+r.duration_s,0),count:rows.reduce((s,r)=>s+r.ride_count,0)};}
