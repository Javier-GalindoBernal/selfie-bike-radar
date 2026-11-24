'use client';
import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { fmtKm } from '@/lib/geo';
import { MAX_FILE_BYTES, buildRoute, parseRoute, routeToGpx, type Parsed, type Route } from '@/lib/routes';
import { addRoute, removeRoute, setActiveRoute, useRoutes } from '@/lib/routeStore';
import { IconRoute } from './Icons';

const MapView = dynamic(() => import('./Map'), { ssr: false, loading: () => <div className="map-loading">Cargando el mapa…</div> });

export default function RoutesPanel() {
  const { routes, activeId } = useRoutes();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ parsed: Parsed; file: string; name: string } | null>(null);
  const [preview, setPreview] = useState<Route | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    setError('');
    setInfo('');
    setPreview(null);
    if (file.size > MAX_FILE_BYTES) return setError('El archivo es demasiado grande (máximo 10 MB).');
    setBusy(true);
    try {
      const parsed = parseRoute(await file.text(), file.name);
      setDraft({ parsed, file: file.name, name: parsed.name });
    } catch (e) {
      setDraft(null);
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    } finally {
      setBusy(false);
    }
  }

  const draftRoute = draft ? buildRoute(draft.parsed, 'draft', new Date(), draft.name) : null;
  const shown = draftRoute ?? preview;

  function save() {
    if (!draft) return;
    try {
      const r = buildRoute(draft.parsed, crypto.randomUUID(), new Date(), draft.name);
      addRoute(r);
      setActiveRoute(r.id);
      setInfo(`Ruta «${r.name}» guardada y lista para seguir.`);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la ruta.');
    }
  }
  function download(r: Route) {
    const href = URL.createObjectURL(new Blob([routeToGpx(r)], { type: 'application/gpx+xml' }));
    const a = document.createElement('a');
    a.href = href;
    a.download = `${r.name.replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'ruta'}.gpx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return (
    <section className="content-panel routes-panel">
      <div className="panel-heading">
        <h2>Mis rutas</h2>
        <button className="primary route-load" disabled={busy} onClick={() => input.current?.click()}>
          <IconRoute size={20} /> {busy ? 'Leyendo…' : 'Cargar ruta'}
        </button>
        <input ref={input} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f); }} />
      </div>
      <p className="map-caption">Carga un archivo <b>GPX</b>, <b>TCX</b>, <b>KML</b> o <b>GeoJSON</b> (de Strava, Komoot, Wikiloc, Garmin, Google Earth…). Las rutas se guardan solo en este teléfono y puedes seguirlas en el mapa mientras grabas.</p>
      {error && <p role="alert" className="alert">{error}</p>}
      {info && <p role="status" className="notice">{info}</p>}

      {draft && draftRoute && (
        <div className="route-draft">
          <label htmlFor="route-name">Nombre de la ruta</label>
          <input id="route-name" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <p className="map-caption">{draft.parsed.format} · {fmtKm(draftRoute.distance_m)} · desnivel +{Math.round(draftRoute.gain_m)} m · {draft.parsed.coords.length.toLocaleString('es-CO')} puntos</p>
          <div className="rec-actions">
            <button className="rec-btn go" onClick={save}>Guardar y seguir esta ruta</button>
            <button className="rec-btn stop" onClick={() => setDraft(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {shown && <div className="radar-map route-preview"><MapView pins={[]} planned={shown.coords} /></div>}
      {preview && !draft && <button className="ghost" onClick={() => setPreview(null)}>Cerrar mapa</button>}

      {routes.length === 0 && !draft ? (
        <div className="empty"><h3>Aún no tienes rutas</h3><p>Pulsa «Cargar ruta» y elige un archivo GPX.</p></div>
      ) : (
        <ul className="route-list">
          {routes.map((r) => (
            <li key={r.id} className={r.id === activeId ? 'active' : ''}>
              <div className="route-info"><strong>{r.name}</strong><span>{fmtKm(r.distance_m)} · +{Math.round(r.gain_m)} m · {r.source}{r.id === activeId ? ' · siguiendo' : ''}</span></div>
              <div className="route-actions">
                <button className="ghost" onClick={() => { setDraft(null); setPreview(r); }}>Ver</button>
                <button className={r.id === activeId ? 'ghost on' : 'ghost'} onClick={() => setActiveRoute(r.id === activeId ? null : r.id)}>{r.id === activeId ? 'Dejar de seguir' : 'Seguir'}</button>
                <button className="ghost" onClick={() => download(r)}>GPX</button>
                <button className="ghost danger" onClick={() => { if (window.confirm(`¿Eliminar «${r.name}» de este teléfono?`)) removeRoute(r.id); }}>Eliminar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
