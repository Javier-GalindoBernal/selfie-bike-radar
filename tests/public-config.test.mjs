import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicKeyValid,radarClient} from '../lib/radar.ts';
const jwt=role=>`header.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`;
test('Solo se admiten claves públicas en el cliente',()=>{
 assert.equal(publicKeyValid(jwt('anon')),true);
 assert.equal(publicKeyValid('sb_publishable_example'),true);
 assert.equal(publicKeyValid(jwt('service_role')),false);
 assert.equal(publicKeyValid('sb_secret_example'),false);
 assert.equal(publicKeyValid(''),false);
 assert.throws(()=>radarClient('https://example.supabase.co',jwt('service_role')),/Nunca/);
 assert.throws(()=>radarClient('http://example.supabase.co',jwt('anon')),/HTTPS/);
});
