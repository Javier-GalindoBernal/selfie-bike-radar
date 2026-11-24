import { createClient } from '@supabase/supabase-js';
import { fetchWithTimeout } from './client-config.ts';
export type Group = {id:string; name:string; invite_code:string};
export type Rider = {user_id:string;display_name:string;latitude:number;longitude:number;speed_mps:number|null;accuracy_m:number;recorded_at:string;event_id?:string|null;event_title?:string|null};
export type Ride = {id:string;user_id:string;group_id:string;name:string;status:'active'|'paused'|'finished';started_at:string;ended_at:string|null;distance_m:number;duration_s:number};
export function publicKeyValid(key:string) {
 if(key.startsWith('sb_publishable_')) return true;
 try {return JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';} catch {return false;}
}
export function radarClient(url:string,key:string) {
 if(!publicKeyValid(key)) throw new Error('Usa la clave pública publishable o anon. Nunca la clave service_role.');
 const parsed=new URL(url);
 if(parsed.protocol!=='https:' && parsed.hostname!=='localhost' && parsed.hostname!=='127.0.0.1') throw new Error('La conexión necesita HTTPS.');
 return createClient(url,key, { global: { fetch: fetchWithTimeout } });
}
