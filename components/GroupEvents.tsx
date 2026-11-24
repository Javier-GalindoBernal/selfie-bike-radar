'use client';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtKm } from '@/lib/geo';
import type { LatLng } from '@/lib/route';
import { adminError } from './GroupAdmin';

const MapView = dynamic(() => import('./Map'), { ssr: false, loading: () => <div className="map-loading">Cargando el mapa…</div> });

export type GroupEvent = { id: string; title: string; notes: string; starts_at: string; ends_at: string; status: 'scheduled' | 'cancelled'; route_id: string | null; route_name: string | null; route_distance_m: number | null; creator: string; participants: number; joined: boolean; open_now: boolean; created_by: string };
type GroupRoute = { id: string; name: string; distance_m: number; gain_m: number; source: string; author: string; mine: boolean };

export const toLatLngs = (raw: unknown): LatLng[] =>
  (Array.isArray(raw) ? raw : []).flatMap((p) => (Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])) && Math.abs(Number(p[0])) <= 90 && Math.abs(Number(p[1])) <= 180 ? [[Number(p[0]), Number(p[1])] as LatLng] : []));

const fmtWhen = (iso: string) => new Date(iso).toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Salidas del grupo: solo quienes se apuntan a la misma salida se ven en el radar mientras salen en ella. */
export default function GroupEvents({ client, groupId, userId, isManager }: { client: SupabaseClient; groupId: string; userId: string; isManager: boolean }) {
  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [routes, setRoutes] = useState<GroupRoute[]>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [hours, setHours] = useState(6);
  const [routeId, setRouteId] = useState('');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<{ id: string; coords: LatLng[] } | null>(null);
  const [roster, setRoster] = useState<{ id: string; names: string[] } | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => { const tick = () => setNow(Date.now()); const t0 = setTimeout(tick, 0); const t = setInterval(tick, 30000); return () => { clearTimeout(t0); clearInterval(t); }; }, []);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([client.rpc('radar_group_events', { gid: groupId }), client.rpc('radar_group_routes', { gid: groupId })]);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    setEvents((a.data || []) as GroupEvent[]);
    setRoutes((b.data || []) as GroupRoute[]);
  }, [client, groupId]);

  useEffect(() => {
    let alive = true;
    const run = () => Promise.resolve().then(load).catch((e) => { if (alive) setError(adminError(e)); });
    void run();
    const t = setInterval(() => void run(), 30000);
    return () => { alive = false; clearInterval(t); };
  }, [load]);

  async function act(fn: () => PromiseLike<unknown>, ok: string) {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const r = (await fn()) as { error?: unknown } | undefined;
      if (r && r.error) throw r.error;
      setInfo(ok);
      await load().catch(() => undefined);
    } catch (e) {
      setError(adminError(e));
    } finally {
      setBusy(false);
    }
  }

  async function showRoute(e: GroupEvent) {
    if (!e.route_id) return;
    if (preview?.id === e.id) return setPreview(null);
    const { data, error: er } = await client.rpc('radar_group_route_coords', { rid: e.route_id });
    if (er) return setError(adminError(er));
    setPreview({ id: e.id, coords: toLatLngs(data) });
  }
  async function showRoster(e: GroupEvent) {
    if (roster?.id === e.id) return setRoster(null);
    const { data, error: er } = await client.rpc('radar_event_roster', { eid: e.id });
    if (er) return setError(adminError(er));
    setRoster({ id: e.id, names: ((data || []) as { display_name: string }[]).map((x) => x.display_name) });
  }

  return (
    <section className="content-panel events-panel">
      <div className="panel-heading">
        <h2>Salidas del grupo</h2>
        <button className="primary route-load" onClick={() => { if (!creating && !when) setWhen(toLocalInput(new Date(Date.now() + 24 * 3600 * 1000))); setCreating((v) => !v); }}>{creating ? 'Cerrar' : '＋ Nueva salida'}</button>
      </div>
      <p className="map-caption">🔒 <b>Privacidad:</b> tu ubicación solo la ven quienes se apuntaron a <b>la misma salida</b> (misma ruta y día) y están saliendo en ella. Si sales por tu cuenta o en otra salida, nadie ve dónde estás.</p>
      {error && <p role="alert" className="alert">{error}</p>}
      {info && <p role="status" className="notice">{info}</p>}

      {creating && (
        <form className="route-draft" onSubmit={(e) => { e.preventDefault(); void act(async () => { const r = await client.rpc('radar_create_event', { gid: groupId, event_title: title, event_start: new Date(when).toISOString(), route: routeId || null, event_notes: notes, hours }); if (!r.error) { setCreating(false); setTitle(''); setNotes(''); setRouteId(''); } return r; }, 'Salida creada. Los demás pueden apuntarse con «Voy».'); }}>
          <label htmlFor="ev-title">Nombre de la salida</label>
          <input id="ev-title" className="route-input" required minLength={2} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Sábado a Zipaquirá" />
          <label htmlFor="ev-when">Día y hora de salida</label>
          <input id="ev-when" className="route-input" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
          <label htmlFor="ev-hours">Duración aproximada</label>
          <select id="ev-hours" className="route-input" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{[2, 3, 4, 6, 8, 10, 12].map((h) => <option key={h} value={h}>{h} horas</option>)}</select>
          <label htmlFor="ev-route">Ruta (compártela primero desde «Mis rutas»)</label>
          <select id="ev-route" className="route-input" value={routeId} onChange={(e) => setRouteId(e.target.value)}>
            <option value="">Sin ruta definida</option>
            {routes.map((r) => <option key={r.id} value={r.id}>{r.name} · {fmtKm(r.distance_m)}</option>)}
          </select>
          <label htmlFor="ev-notes">Notas (opcional)</label>
          <textarea id="ev-notes" className="route-input" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Punto de encuentro, ritmo, qué llevar…" />
          <button className="primary" disabled={busy || !title.trim()}>Crear salida</button>
        </form>
      )}

      {events.length === 0 ? (
        <div className="empty"><h3>No hay salidas programadas</h3><p>Crea una con «Nueva salida» y elige la ruta del día.</p></div>
      ) : (
        <ul className="route-list">
          {events.map((e) => {
            const past = now > 0 && new Date(e.ends_at).getTime() < now;
            return (
              <li key={e.id} className={e.joined && e.status === 'scheduled' ? 'active' : ''}>
                <div className="route-info">
                  <strong>{e.title}{e.status === 'cancelled' ? ' · CANCELADA' : e.open_now ? ' · 🟢 abierta ahora' : past ? ' · terminada' : ''}</strong>
                  <span>{fmtWhen(e.starts_at)} · {e.route_name ? `${e.route_name}${e.route_distance_m ? ` (${fmtKm(e.route_distance_m)})` : ''}` : 'sin ruta definida'} · {e.participants} apuntado{e.participants === 1 ? '' : 's'} · organiza {e.creator}</span>
                  {e.notes && <span>{e.notes}</span>}
                </div>
                <div className="route-actions">
                  {e.status === 'scheduled' && !past && (e.joined
                    ? <button className="ghost on" disabled={busy} onClick={() => void act(() => client.rpc('radar_event_leave', { eid: e.id }), 'Ya no vas a esta salida.')}>✓ Voy · quitarme</button>
                    : <button className="primary" disabled={busy} onClick={() => void act(() => client.rpc('radar_event_join', { eid: e.id }), '¡Listo! Estás apuntado. El día de la salida, inicia la grabación eligiendo esta salida.')}>Voy</button>)}
                  {e.route_id && <button className="ghost" onClick={() => void showRoute(e)}>{preview?.id === e.id ? 'Ocultar ruta' : 'Ver ruta'}</button>}
                  <button className="ghost" onClick={() => void showRoster(e)}>Quiénes van</button>
                  {e.status === 'scheduled' && !past && (e.created_by === userId || isManager) && <button className="ghost danger" disabled={busy} onClick={() => { if (window.confirm('¿Cancelar esta salida para todos?')) void act(() => client.rpc('radar_event_cancel', { eid: e.id }), 'Salida cancelada.'); }}>Cancelar</button>}
                </div>
                {preview?.id === e.id && <div className="radar-map route-preview"><MapView pins={[]} planned={preview.coords} /></div>}
                {roster?.id === e.id && <p className="map-caption">Van: {roster.names.join(', ') || 'nadie todavía'}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
