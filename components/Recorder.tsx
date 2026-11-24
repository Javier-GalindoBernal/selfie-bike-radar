'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtKm } from '@/lib/geo';
import { IconPause, IconPlay, IconStop } from './Icons';
import { progressOnRoute } from '@/lib/routes';
import { roadRoute } from '@/lib/route';
import { rejoinPath, type Rejoin } from '@/lib/skills/routeCorrector';
import { setActiveRoute, useRoutes } from '@/lib/routeStore';
import { applySample, displaySpeedKmh, finish, newRecState, pause, resume, tick, toSegments, type RecState } from '@/lib/recording';

const MapView = dynamic(() => import('./Map'), { ssr: false, loading: () => <div className="map-loading">Cargando el mapa…</div> });
const storeKey = (userId: string) => `radar-recording-${userId}`;

function load(userId: string): RecState | null {
  try {
    const raw = localStorage.getItem(storeKey(userId));
    if (!raw) return null;
    const s = JSON.parse(raw) as RecState;
    return s && s.rideId && s.userId === userId && Array.isArray(s.points) ? s : null;
  } catch {
    return null;
  }
}
function save(s: RecState | null, userId: string) {
  try {
    if (s) localStorage.setItem(storeKey(userId), JSON.stringify(s));
    else localStorage.removeItem(storeKey(userId));
  } catch {
    /* almacenamiento bloqueado: se sigue sin copia local */
  }
}
const msg = (e: unknown) => (typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e));

export default function Recorder({ client, userId, groupId, groupName, demo }: { client: SupabaseClient | null; userId: string; groupId: string; groupName: string; demo: boolean }) {
  const { active: route, routes } = useRoutes();
  const [s, setS] = useState<RecState | null>(null);
  const ref = useRef<RecState | null>(null);
  const [name, setName] = useState('Salida en bici');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [openRide, setOpenRide] = useState<{ id: string; name: string } | null>(null);
  const [syncError, setSyncError] = useState('');
  const [rejoin, setRejoin] = useState<Rejoin | null>(null);
  const [wake, setWake] = useState(true);
  const [clock, setClock] = useState(0);
  const lastSave = useRef(0);
  const syncing = useRef(false);

  const commit = useCallback((next: RecState | null, force = false) => {
    ref.current = next;
    setS(next);
    const now = Date.now();
    if (force || now - lastSave.current > 3000) {
      lastSave.current = now;
      save(next, userId);
    }
  }, [userId]);

  // Recuperar una salida guardada si se cerró la página: queda pausada y se reanuda a mano.
  useEffect(() => {
    const saved = load(userId);
    if (!saved) return;
    const restored = saved.status === 'active' ? { ...pause(saved, Date.now()) } : saved;
    Promise.resolve().then(() => {
      commit(restored, true);
      if (saved.status === 'active') setInfo('Recuperamos tu salida: quedó en pausa. Reanúdala o finalízala.');
    });
  }, [userId, commit]);

  const sync = useCallback(async () => {
    const snap = ref.current;
    if (!client || !snap || syncing.current) return;
    syncing.current = true;
    try {
      let created = snap.rideCreated;
      if (!created) {
        const { error: e } = await client.from('radar_rides').upsert({ id: snap.rideId, user_id: snap.userId, group_id: snap.groupId, name: snap.name, status: 'active', started_at: snap.startedAt }, { onConflict: 'id', ignoreDuplicates: true });
        if (e) throw e;
        created = true;
      }
      let synced = snap.syncedCount;
      while (synced < snap.points.length) {
        const batch = snap.points.slice(synced, synced + 200);
        const { error: e } = await client.from('radar_points').upsert(batch.map(p => ({ id: p.id, ride_id: snap.rideId, user_id: snap.userId, latitude: p.lat, longitude: p.lng, segment: p.segment, accuracy_m: Math.min(100, p.accuracy), speed_mps: p.speed, altitude_m: p.altitude, recorded_at: p.at })), { onConflict: 'id', ignoreDuplicates: true });
        if (e) throw e;
        synced += batch.length;
      }
      const patch: Record<string, unknown> = { status: snap.status, distance_m: snap.distance, duration_s: Math.round(snap.activeMs / 1000) };
      if (snap.status === 'finished') patch.ended_at = snap.endedAt;
      const { error: e } = await client.from('radar_rides').update(patch).eq('id', snap.rideId);
      if (e) throw e;
      setSyncError('');
      const cur = ref.current;
      if (cur && cur.rideId === snap.rideId) commit({ ...cur, rideCreated: created, syncedCount: Math.max(cur.syncedCount, synced) }, true);
    } catch (e) {
      const m = msg(e);
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
      setSyncError(/radar_one_open_ride|duplicate key/.test(m) ? 'Ya tienes otra salida abierta (¿en otro dispositivo?). Ciérrala para sincronizar esta.' : /schema cache|does not exist/.test(m) ? 'Falta activar las tablas en Supabase.' : /Failed to fetch|NetworkError|Load failed|network/i.test(m) ? 'Sin conexión: tu recorrido se guarda en este teléfono y se enviará al volver la red.' : `No se pudo enviar al servidor${code ? ` (${code})` : ''}: ${m}`);
    } finally {
      syncing.current = false;
    }
  }, [client, commit]);

  // Temporizador, guardado y sincronización periódica.
  useEffect(() => {
    if (!s) return;
    const t = setInterval(() => {
      const cur = ref.current;
      if (cur?.status === 'active') commit(tick(cur, Date.now()));
      setClock(Date.now());
    }, 1000);
    const y = setInterval(() => void sync(), 10000);
    const online = () => void sync();
    const hide = () => save(ref.current, userId);
    window.addEventListener('online', online);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearInterval(t);
      clearInterval(y);
      window.removeEventListener('online', online);
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [!!s, sync, commit, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS mientras la salida está activa.
  const active = s?.status === 'active';
  useEffect(() => {
    if (!active) return;
    if (!navigator.geolocation) {
      Promise.resolve().then(() => setError('Este navegador no permite obtener la ubicación.'));
      return;
    }
    const id = navigator.geolocation.watchPosition(
      p => {
        const cur = ref.current;
        if (!cur) return;
        const c = p.coords;
        const next = applySample(cur, { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, speed: c.speed, altitude: c.altitude, at: p.timestamp }, crypto.randomUUID());
        if (next !== cur) commit(next);
      },
      err => {
        const cur = ref.current;
        if (err.code === 1 && cur) {
          commit(pause(cur, Date.now()), true);
          setError('Permiso de ubicación denegado: la salida quedó en pausa. Actívalo en los ajustes del teléfono y reanuda.');
          void sync();
        } else if (err.code === 2) setInfo('Buscando señal GPS… sal a un lugar abierto.');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active, commit, sync]);

  // Mantener la pantalla encendida (el GPS web se detiene si el teléfono se bloquea).
  useEffect(() => {
    if (!active) return;
    type Lock = { release(): Promise<void> };
    let lock: Lock | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<Lock> } };
    const ask = async () => {
      try {
        if (!nav.wakeLock || document.visibilityState !== 'visible') return;
        const l = await nav.wakeLock.request('screen');
        if (cancelled) void l.release();
        else lock = l;
        setWake(true);
      } catch {
        setWake(false);
      }
    };
    void ask();
    document.addEventListener('visibilitychange', ask);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', ask);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);

  async function start() {
    if (!client || !groupId || busy) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const { data, error: e } = await client.from('radar_rides').select('id,name').eq('user_id', userId).neq('status', 'finished').limit(1);
      if (e) throw e;
      if (data && data.length) {
        setOpenRide(data[0]);
        setError('Ya tienes una salida abierta (quizá en otro dispositivo). Ciérrala para empezar una nueva.');
        return;
      }
      commit(newRecState({ rideId: crypto.randomUUID(), groupId, userId, name: name.trim().slice(0, 120) || 'Salida en bici', now: Date.now() }), true);
      void sync();
    } catch (e) {
      setError(/schema cache|does not exist/.test(msg(e)) ? 'Falta activar las tablas en Supabase.' : msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function closeOpen() {
    if (!client || !openRide) return;
    setBusy(true);
    try {
      const { error: e } = await client.from('radar_rides').update({ status: 'finished', ended_at: new Date().toISOString() }).eq('id', openRide.id);
      if (e) throw e;
      setOpenRide(null);
      setError('');
      setInfo('Salida anterior cerrada. Ya puedes iniciar una nueva.');
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  function doPause() {
    if (!ref.current) return;
    commit(pause(ref.current, Date.now()), true);
    void sync();
  }
  function doResume() {
    if (!ref.current) return;
    setError('');
    commit(resume(ref.current, Date.now()), true);
    void sync();
  }
  function doFinish() {
    if (!ref.current) return;
    setConfirmEnd(false);
    commit(finish(ref.current, Date.now()), true);
    void sync();
  }
  function reset() {
    commit(null, true);
    setInfo('');
    setError('');
  }

  const segments = useMemo(() => (s ? toSegments(s.points) : []), [s]);
  const last = s?.points[s.points.length - 1];
  void clock;
  const pending = s ? s.points.length - s.syncedCount : 0;
  const done = s?.status === 'finished' && s.rideCreated && pending === 0 && !syncError;
  const prog = route && last ? progressOnRoute([last.lat, last.lng], route.coords) : null;
  const offKey = prog && prog.off_m > 60 && last ? `${last.lat.toFixed(3)},${last.lng.toFixed(3)}` : '';
  const lastPos = last ? ([last.lat, last.lng] as [number, number]) : null;
  const cur = s ? displaySpeedKmh(s, clock || Date.now()) : 0;
  const still = !!s && s.status === 'active' && !!last && cur === 0;

  useEffect(() => {
    if (!offKey || !route || !lastPos) {
      Promise.resolve().then(() => setRejoin(null));
      return;
    }
    const ctl = new AbortController();
    void rejoinPath(lastPos, route.coords, roadRoute, ctl.signal).then((r) => { if (!ctl.signal.aborted) setRejoin(r); });
    return () => ctl.abort();
    // se recalcula al moverse ~100 m fuera de la ruta
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offKey, route?.id]);

  if (demo) return <section className="content-panel"><div className="panel-heading"><h2>Grabar salida</h2></div><div className="empty"><h3>Inicia sesión para grabar</h3><p>La vista de ejemplo no registra ubicaciones.</p></div></section>;
  if (!groupId) return <section className="content-panel"><div className="panel-heading"><h2>Grabar salida</h2></div><div className="empty"><h3>Primero crea o únete a un grupo</h3></div></section>;

  return (
    <section className="content-panel recorder">
      <div className="panel-heading"><h2>Grabar salida</h2><span>{groupName}</span></div>
      {error && <p role="alert" className="alert">{error}{openRide && <> <button className="ghost" disabled={busy} onClick={() => void closeOpen()}>Cerrar «{openRide.name}»</button></>}</p>}
      {info && <p role="status" className="notice">{info}</p>}
      {!s && (
        <div className="rec-start">
          <label htmlFor="rec-name">Nombre de la salida</label>
          <input id="rec-name" value={name} maxLength={120} onChange={e => setName(e.target.value)} />
          <button className="rec-go" disabled={busy} onClick={() => void start()} aria-label="Iniciar salida"><IconPlay size={44} /><span>INICIAR</span></button>
          <div className="route-pick"><label htmlFor="rec-route">Ruta a seguir</label><select id="rec-route" value={route?.id ?? ''} onChange={e => setActiveRoute(e.target.value || null)}><option value="">Sin ruta (salida libre)</option>{routes.map(x => <option key={x.id} value={x.id}>{x.name} · {fmtKm(x.distance_m)}</option>)}</select>{route ? <p className="route-chip">⚑ Al iniciar verás <b>{route.name}</b> ({fmtKm(route.distance_m)}, +{Math.round(route.gain_m)} m) punteada en el mapa, con tu avance y aviso si te sales.</p> : <p className="map-caption">{routes.length ? 'Elige una ruta guardada para seguirla.' : 'Carga un GPX en la pestaña «Rutas» para seguirlo aquí.'}</p>}</div>
          <p className="map-caption">Mientras la salida esté activa, tu grupo verá tu posición en el radar. Al pausar o finalizar dejas de compartirla. Mantén esta página abierta y la pantalla encendida: en iPhone y Android el navegador detiene el GPS si bloqueas el teléfono o cambias de app.</p>
        </div>
      )}
      {s && (
        <>
          <div className="rec-stats">
            <div><span>Tiempo activo</span><strong>{fmtDur2(s.activeMs / 1000)}</strong></div>
            <div><span>Distancia</span><strong>{fmtKm(s.distance)}</strong></div>
            <div><span>Velocidad</span><strong>{cur.toFixed(1)} km/h</strong></div>
          </div>
          <p className="map-caption" role="status">
            {s.status === 'active' ? (still ? '● Quieto: no suma distancia ni velocidad · sigues compartiendo con tu grupo' : '● Grabando y compartiendo con tu grupo') : s.status === 'paused' ? '❚❚ En pausa: no se comparte tu posición' : '■ Salida finalizada'}
            {last ? ` · precisión ±${Math.round(last.accuracy)} m` : s.status === 'active' ? ' · esperando la primera señal GPS…' : ''}
            {s.status === 'active' && !wake ? ' · no se pudo mantener la pantalla encendida: no la bloquees' : ''}
          </p>
          {route && s.status !== 'finished' && !prog && <p className="route-chip" role="status">⚑ Siguiendo «{route.name}» · {fmtKm(route.distance_m)}. Ve al inicio (▶ verde en el mapa) cuando tengas señal GPS.</p>}
          {route && s.status !== 'finished' && prog && <p className={prog.off_m > 60 ? 'route-chip off' : 'route-chip'} role="status">{prog.off_m > 60 ? `⚠ Fuera de ruta · a ${fmtKm(prog.off_m)} del trazado. ${rejoin?.path ? `Para volver: ${fmtKm(rejoin.path.distance_m)} por calles (línea azul).` : 'Calculando el camino de regreso…'}` : `✓ En la ruta · avance ${fmtKm(prog.along_m)} de ${fmtKm(prog.total_m)} · faltan ${fmtKm(Math.max(prog.total_m - prog.along_m, 0))}`}</p>}
          <div className="rec-actions">
            {s.status === 'active' && <button className="rec-btn pause" onClick={doPause}><IconPause size={22} /> Pausar</button>}
            {s.status === 'paused' && <button className="rec-btn go" onClick={doResume}><IconPlay size={22} /> Reanudar</button>}
            {s.status !== 'finished' && !confirmEnd && <button className="rec-btn stop" onClick={() => setConfirmEnd(true)}><IconStop size={22} /> Finalizar</button>}
            {s.status !== 'finished' && confirmEnd && <><button className="rec-btn go" onClick={doFinish}>Sí, guardar y finalizar</button><button className="ghost rec-big" onClick={() => setConfirmEnd(false)}>Seguir</button></>}
            {s.status === 'finished' && !done && <button className="ghost rec-big" onClick={() => void sync()}>Reintentar envío</button>}
            {done && <button className="rec-btn go" onClick={reset}><IconPlay size={22} /> Nueva salida</button>}
            {s.status === 'finished' && !done && !discard && <button className="ghost rec-big" onClick={() => setDiscard(true)}>Descartar y nueva salida</button>}
            {s.status === 'finished' && !done && discard && <><button className="primary rec-big" onClick={() => { setDiscard(false); reset(); }}>Sí, descartar lo no enviado</button><button className="ghost rec-big" onClick={() => setDiscard(false)}>Cancelar</button></>}
          </div>
          <div className="radar-map"><MapView pins={last ? [{ id: 'rec-me', name: 'Yo', pos: [last.lat, last.lng], me: true }] : []} track={segments} planned={route?.coords} routes={rejoin?.path && offKey ? [{ id: 'rejoin', coords: rejoin.path.coords, color: '#1a73e8' }] : []} follow /></div>
          <p className="map-caption">{done ? 'Salida guardada en tu cuenta. Puedes verla en la pestaña «Salidas».' : syncError ? syncError : pending > 0 ? `${pending} puntos por enviar` : 'Sincronizado con tu cuenta'}</p>
        </>
      )}
    </section>
  );
}

function fmtDur2(sec: number) {
  const t = Math.floor(sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`;
}
