'use client';
import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { fmtDur, fmtKm } from '@/lib/geo';
import { roadRoute, type LatLng, type RoadRoute } from '@/lib/route';
import { buildRoute, type Route } from '@/lib/routes';
import { joinLegs, validateBuilt, type Leg } from '@/lib/skills/noStraightLines';

type LegState = RoadRoute | null | 'loading';
const pinIcon = (label: string, color: string) =>
  L.divIcon({ className: '', html: `<div style="background:${color};color:#fff;border:3px solid #fff;border-radius:999px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font:800 13px system-ui;box-shadow:0 2px 6px #0007">${label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });

function Clicks({ onAdd }: { onAdd: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onAdd([e.latlng.lat, e.latlng.lng]) });
  return null;
}
function Center({ to }: { to: LatLng | null }) {
  const map = useMap();
  useEffect(() => { if (to) map.setView(to, 15); }, [to, map]);
  return null;
}

/** Editor de rutas estilo Strava: toca el mapa para marcar puntos y cada tramo se traza por calles y ciclovías. */
export default function RouteBuilder({ onSave, onCancel, start, canShare = false }: { onSave: (r: Route, share: boolean) => void; onCancel: () => void; start?: LatLng; canShare?: boolean }) {
  const [shareIt, setShareIt] = useState(false);
  const [wps, setWps] = useState<LatLng[]>([]);
  const [legs, setLegs] = useState<LegState[]>([]);
  const [name, setName] = useState('Mi ruta');
  const [center, setCenter] = useState<LatLng | null>(start ?? null);
  const [msg, setMsg] = useState('');
  const wpsRef = useRef<LatLng[]>([]);

  function fetchLeg(i: number, from: LatLng, to: LatLng) {
    setLegs((prev) => prev.map((l, k) => (k === i ? 'loading' : l)));
    void roadRoute(from, to).then((r) => {
      const cur = wpsRef.current;
      if (cur[i] !== from || cur[i + 1] !== to) return; // el punto cambió mientras se calculaba
      setLegs((prev) => prev.map((l, k) => (k === i ? r : l)));
    });
  }
  function add(p: LatLng) {
    setMsg('');
    const prev = wpsRef.current;
    const next = [...prev, p];
    wpsRef.current = next;
    setWps(next);
    if (prev.length) {
      setLegs((l) => [...l, 'loading']);
      fetchLeg(prev.length - 1, prev[prev.length - 1], p);
    }
  }
  function move(k: number, p: LatLng) {
    const next = wpsRef.current.map((w, i) => (i === k ? p : w));
    wpsRef.current = next;
    setWps(next);
    if (k > 0) fetchLeg(k - 1, next[k - 1], next[k]);
    if (k < next.length - 1) fetchLeg(k, next[k], next[k + 1]);
  }
  function undo() {
    setWps((w) => w.slice(0, -1));
    setLegs((l) => l.slice(0, Math.max(wps.length - 2, 0)));
    wpsRef.current = wpsRef.current.slice(0, -1);
  }
  function clear() { setWps([]); setLegs([]); wpsRef.current = []; setMsg(''); }
  function retry() { legs.forEach((l, i) => { if (l === null) fetchLeg(i, wps[i], wps[i + 1]); }); }
  function loop() { if (wps.length >= 2) add(wps[0]); }
  function here() {
    if (!navigator.geolocation) return setMsg('Este navegador no permite obtener tu ubicación.');
    navigator.geolocation.getCurrentPosition((p) => setCenter([p.coords.latitude, p.coords.longitude]), () => setMsg('No pude obtener tu ubicación. Revisa el permiso del navegador.'), { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  }

  const loading = legs.some((l) => l === 'loading');
  const done: Leg[] = legs.map((l, i) => ({ from: wps[i], to: wps[i + 1], route: l && l !== 'loading' ? l : null }));
  const check = validateBuilt(done);
  const failed = legs.flatMap((l, i) => (l === null ? [i] : []));
  const dist = done.reduce((s, l) => s + (l.route?.distance_m ?? 0), 0);
  const secs = done.reduce((s, l) => s + (l.route?.duration_s ?? 0), 0);
  const canSave = wps.length >= 2 && !loading && check.ok && dist >= 200;

  function save() {
    const coords = joinLegs(done);
    const r = buildRoute({ name, coords, ele: coords.map(() => null), format: 'Dibujada', warnings: [] }, crypto.randomUUID(), new Date(), name);
    onSave({ ...r, distance_m: dist }, shareIt);
  }

  return (
    <div className="route-builder">
      <p className="map-caption"><b>Toca el mapa</b> para marcar los puntos de tu ruta. Cada tramo se traza por calles y ciclovías (nunca en línea recta). Arrastra un punto para moverlo.</p>
      <div className="radar-map builder-map">
        <MapContainer center={start ?? [4.65, -74.08]} zoom={start ? 15 : 12} className="h-full w-full rounded-xl">
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Clicks onAdd={add} />
          <Center to={center} />
          {done.map((l, i) => l.route && <Polyline key={`h${i}`} positions={l.route.coords} pathOptions={{ color: '#fff', weight: 9, opacity: 0.9 }} />)}
          {done.map((l, i) => l.route && <Polyline key={`l${i}`} positions={l.route.coords} pathOptions={{ color: '#FF8A1F', weight: 5, opacity: 0.95 }} />)}
          {legs.map((l, i) => l === 'loading' && wps[i] && wps[i + 1] && <Polyline key={`p${i}`} positions={[wps[i], wps[i + 1]]} pathOptions={{ color: '#9aa39b', weight: 2, dashArray: '3 8' }} />)}
          {wps.map((w, i) => (
            <Marker key={i} position={w} draggable icon={pinIcon(i === 0 ? 'A' : failed.includes(i - 1) ? '✕' : String(i + 1), i === 0 ? '#2B7A33' : failed.includes(i - 1) ? '#b3261e' : '#FF8A1F')} eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); move(i, [ll.lat, ll.lng]); } }} />
          ))}
        </MapContainer>
      </div>
      <p className="map-caption" role="status">
        {wps.length < 2 ? 'Marca al menos 2 puntos.' : loading ? 'Trazando por calles…' : check.ok ? `✓ Ruta válida · ${fmtKm(dist)} · ≈ ${fmtDur(secs)} en bici` : `⚠ ${failed.length} tramo${failed.length > 1 ? 's' : ''} sin camino por calles (marcado${failed.length > 1 ? 's' : ''} con ✕): mueve ese punto o pulsa Reintentar. No se guarda en línea recta.`}
      </p>
      {msg && <p role="alert" className="alert">{msg}</p>}
      <div className="builder-tools">
        <button className="ghost" onClick={here}>Centrar en mi ubicación</button>
        <button className="ghost" disabled={!wps.length} onClick={undo}>Deshacer</button>
        <button className="ghost" disabled={wps.length < 2} onClick={loop}>Volver al inicio</button>
        <button className="ghost" disabled={!failed.length} onClick={retry}>Reintentar</button>
        <button className="ghost danger" disabled={!wps.length} onClick={clear}>Borrar todo</button>
      </div>
      <label htmlFor="built-name" className="route-label">Nombre de la ruta</label>
      <input id="built-name" className="route-input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      {canShare && <label className="share-check"><input type="checkbox" checked={shareIt} onChange={(e) => setShareIt(e.target.checked)} /> Compartir también con el grupo (todos podrán verla y elegirla en una salida)</label>}
      <div className="rec-actions">
        <button className="rec-btn go" disabled={!canSave} onClick={save}>Guardar ruta</button>
        <button className="rec-btn stop" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
