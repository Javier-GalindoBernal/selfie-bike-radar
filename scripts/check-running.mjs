// Comprueba los archivos reales que entrega el servidor, no solo el HTML inicial.
const base = process.env.RADAR_CHECK_URL || 'http://localhost:3001';
let failures = 0;
async function check(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
  return response;
}
try {
  const html = await (await check('/')).text();
  const files = [...new Set([...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css)(?:\?[^\"]*)?)"/g)]
    .map(match => match[1]).filter(path => path.startsWith('/_next/')))];
  if (!files.length) throw new Error('La página no incluyó sus archivos de arranque.');
  for (const path of files) {
    try { await check(path); }
    catch (error) { failures++; console.error(error.message); }
  }
  await check('/share');
  const config = await (await check('/api/config')).json();
  if (Object.keys(config).some(key => !['url', 'key'].includes(key))) throw new Error('Respuesta de configuración inesperada.');
  console.log(`Página y ${files.length} archivos de arranque: ${failures ? 'CON ERRORES' : 'OK'}`);
  console.log(`Conexión: dirección ${config.url ? 'presente' : 'pendiente'}, clave pública ${config.key ? 'presente' : 'pendiente en el servidor (puede guardarse en el navegador)'}.`);
  if (failures) process.exitCode = 1;
} catch (error) {
  console.error('No se pudo verificar el arranque:', error.message);
  process.exitCode = 1;
}
