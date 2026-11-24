"use client";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";

export type Pin = { id: string; name: string; pos: [number, number]; me?: boolean };
export type Line = { id: string; coords: [number, number][]; color?: string };

const icon = (label: string, me?: boolean, color?: string) =>
  L.divIcon({
    className: "",
    html: `<div style="background:${color ?? (me ? "#2B7A33" : "#FF8A1F")};color:#fff;border:2px solid #fff;border-radius:999px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font:700 13px system-ui;box-shadow:0 1px 4px #0006">${label}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

function Follow({ pos }: { pos?: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (pos && !map.getBounds().pad(-0.2).contains(pos)) map.panTo(pos);
  }, [pos, map]);
  return null;
}

function Fit({ points, fitKey }: { points: [number, number][]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 17 });
    // solo reajusta cuando cambia el conjunto de elementos, no en cada posición
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

export default function Map({
  pins,
  routes = [],
  trails = [],
  track = [],
  follow = false,
  planned = [],
}: {
  pins: Pin[];
  routes?: Line[];
  trails?: Line[];
  track?: [number, number][][];
  follow?: boolean;
  planned?: [number, number][];
}) {
  const fitPoints: [number, number][] = [...pins.map((p) => p.pos), ...planned, ...routes.flatMap((r) => r.coords), ...track.flat()];
  const fitKey = [String(planned.length), pins.map((p) => p.id).join(","), routes.map((r) => r.id).join(","), follow ? String(track.length) : track.map((t) => t.length).join(",")].join("|");
  const first = track[0]?.[0];
  const lastSeg = track[track.length - 1];
  const last = lastSeg?.[lastSeg.length - 1];
  return (
    <MapContainer center={[4.65, -74.08]} zoom={11} className="h-full w-full rounded-xl">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Fit points={fitPoints} fitKey={fitKey} />
      {follow && <Follow pos={pins[0]?.pos} />}
      {planned.length > 1 && (
        <>
          <Polyline positions={planned} pathOptions={{ color: "#ffffff", weight: 9, opacity: 0.9 }} />
          <Polyline positions={planned} pathOptions={{ color: "#2B7A33", weight: 5, opacity: 0.95, dashArray: "2 9", lineCap: "round" }} />
          <Marker position={planned[0]} icon={icon("▶", false, "#2B7A33")}><Popup>Salida de la ruta</Popup></Marker>
          <Marker position={planned[planned.length - 1]} icon={icon("⚑", false, "#b3261e")}><Popup>Meta de la ruta</Popup></Marker>
        </>
      )}
      {track.map((seg, i) => (
        <Polyline key={`t${i}`} positions={seg} pathOptions={{ color: "#FF8A1F", weight: 5, opacity: 0.9 }} />
      ))}
      {first && <Marker position={first} icon={icon("▶", false, "#2e7d32")}><Popup>Inicio</Popup></Marker>}
      {last && track.flat().length > 1 && <Marker position={last} icon={icon("■", false, "#b3261e")}><Popup>Final</Popup></Marker>}
      {trails.map((t) => (
        <Polyline key={`s${t.id}`} positions={t.coords} pathOptions={{ color: "#FF8A1F", weight: 4, opacity: 0.8 }} />
      ))}
      {routes.map((r) => (
        <Polyline key={`r${r.id}`} positions={r.coords} pathOptions={{ color: r.color ?? "#2B7A33", weight: 5, opacity: 0.85 }} />
      ))}
      {pins.map((p) => (
        <Marker key={p.id} position={p.pos} icon={icon(p.me ? "Yo" : p.name.slice(0, 1).toUpperCase().replace(/[&<>"']/g, ""), p.me)}>
          <Popup>{p.me ? "Tu ubicación" : p.name}</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
