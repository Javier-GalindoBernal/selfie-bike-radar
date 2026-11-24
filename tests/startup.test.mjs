import {test} from 'node:test';
import assert from 'node:assert/strict';
import {savedConfig,fetchWithTimeout} from '../lib/client-config.ts';
const defaults={url:'https://example.supabase.co',key:''};
test('Arranque tolera configuración dañada, incompleta o almacenamiento bloqueado',()=>{
 for(const value of ['{bad','null','[]','{"url":5,"key":true}']){
  const result=savedConfig({getItem:()=>value},defaults);
  assert.deepEqual(result.config,defaults);assert.ok(result.warning);
 }
 const denied=savedConfig({getItem:()=>{throw new Error('SecurityError');}},defaults);
 assert.deepEqual(denied.config,defaults);assert.ok(denied.warning);
 assert.deepEqual(savedConfig({getItem:()=>null},defaults),{config:defaults,warning:''});
 const saved=savedConfig({getItem:()=>JSON.stringify({url:' https://saved.supabase.co ',key:' public '})},defaults);
 assert.deepEqual(saved.config,{url:'https://saved.supabase.co',key:'public'});
});
test('Una conexión que no responde termina con timeout y permite recuperar la pantalla',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=(_input,init)=>new Promise((_resolve,reject)=>{
  if(init.signal.aborted)reject(new DOMException('Cancelada','AbortError'));
  init.signal.addEventListener('abort',()=>reject(new DOMException('Cancelada','AbortError')),{once:true});
 });
 try {await assert.rejects(fetchWithTimeout('https://example.supabase.co',{},25),{name:'AbortError'});}
 finally {globalThis.fetch=original;}
});
