"use client";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";

export type Pin = { id: string; name: string; pos: [number, number]; me?: boolean };

const icon = (label: string, me?: boolean) =>
  L.divIcon({
    className: "",
    html: `<div style="background:${me ? "#163c36" : "#658641"};color:#fff;border:2px solid #fff;border-radius:999px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font:700 13px system-ui;box-shadow:0 1px 4px #0006">${label}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

function Fit({ pins }: { pins: Pin[] }) {
  const map = useMap();
  const key = pins.map((p) => p.id).join(",");
  useEffect(() => {
    if (pins.length === 0) return;
    if (pins.length === 1) map.setView(pins[0].pos, 14);
    else map.fitBounds(L.latLngBounds(pins.map((p) => p.pos)), { padding: [40, 40] });
    // solo reajusta cuando cambia el conjunto de pins
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export default function Map({ pins }: { pins: Pin[] }) {
  const me = pins.find((p) => p.me);
  return (
    <MapContainer center={[4.65, -74.08]} zoom={11} className="h-full w-full rounded-xl">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Fit pins={pins} />
      {me &&
        pins
          .filter((p) => !p.me)
          .map((p) => (
            <Polyline key={`l${p.id}`} positions={[me.pos, p.pos]} pathOptions={{ color: "#658641", weight: 2, dashArray: "6 6" }} />
          ))}
      {pins.map((p) => (
        <Marker key={p.id} position={p.pos} icon={icon(p.me ? "Yo" : p.name.slice(0, 1).toUpperCase().replace(/[&<>"']/g, ""), p.me)}>
          <Popup>{p.me ? "Tu ubicación" : p.name}</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
