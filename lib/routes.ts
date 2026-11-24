import { haversine } from "./geo.ts";

export type LatLng = [number, number];
export type Route = { id: string; name: string; created: string; distance_m: number; gain_m: number; coords: LatLng[]; source: string };
export type Parsed = { name: string; coords: LatLng[]; ele: (number | null)[]; format: string };

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_POINTS = 300_000;
const KEEP_POINTS = 2500;

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
const attr = (attrs: string, n: string) => new RegExp(`\\b${n}\\s*=\\s*["']([^"']+)["']`, "i").exec(attrs)?.[1];
const tag = (xml: string, n: string) => {
  const m = new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, "i").exec(xml);
  return m ? decode(m[1]) : undefined;
};

type Pt = { lat: number; lng: number; ele: number | null };
const valid = (p: Pt) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);
const eleOf = (s?: string) => {
  const n = s === undefined || s === "" ? NaN : Number(s);
  return Number.isFinite(n) && n >= -500 && n <= 9000 ? n : null;
};

function parseGpx(text: string): Pt[] {
  for (const t of ["trkpt", "rtept"]) {
    const re = new RegExp(`<${t}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${t}>)`, "gi");
    const pts: Pt[] = [];
    for (let m = re.exec(text); m; m = re.exec(text)) {
      pts.push({ lat: Number(attr(m[1], "lat")), lng: Number(attr(m[1], "lon")), ele: eleOf(m[2] ? tag(m[2], "ele") : undefined) });
    }
    if (pts.length) return pts;
  }
  return [];
}

function parseTcx(text: string): Pt[] {
  const pts: Pt[] = [];
  const re = /<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    pts.push({ lat: Number(tag(m[1], "LatitudeDegrees")), lng: Number(tag(m[1], "LongitudeDegrees")), ele: eleOf(tag(m[1], "AltitudeMeters")) });
  }
  return pts;
}

function parseKml(text: string): Pt[] {
  const pts: Pt[] = [];
  const re = /<LineString\b[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    for (const tup of m[1].trim().split(/\s+/)) {
      const [lng, lat, ele] = tup.split(",");
      if (lng !== undefined && lat !== undefined) pts.push({ lat: Number(lat), lng: Number(lng), ele: eleOf(ele) });
    }
  }
  if (!pts.length) {
    const g = /<gx:coord>([\s\S]*?)<\/gx:coord>/gi;
    for (let m = g.exec(text); m; m = g.exec(text)) {
      const [lng, lat, ele] = m[1].trim().split(/\s+/);
      pts.push({ lat: Number(lat), lng: Number(lng), ele: eleOf(ele) });
    }
  }
  return pts;
}

function parseGeoJson(text: string): { pts: Pt[]; name?: string } {
  const data = JSON.parse(text) as unknown;
  const pts: Pt[] = [];
  let name: string | undefined;
  const line = (c: unknown) => {
    if (!Array.isArray(c)) return;
    for (const p of c) if (Array.isArray(p)) pts.push({ lng: Number(p[0]), lat: Number(p[1]), ele: eleOf(p[2] === undefined ? undefined : String(p[2])) });
  };
  const geom = (g: unknown) => {
    if (!g || typeof g !== "object") return;
    const o = g as { type?: string; coordinates?: unknown; geometries?: unknown[] };
    if (o.type === "LineString") line(o.coordinates);
    else if (o.type === "MultiLineString" && Array.isArray(o.coordinates)) o.coordinates.forEach(line);
    else if (o.type === "GeometryCollection" && Array.isArray(o.geometries)) o.geometries.forEach(geom);
  };
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const o = n as { type?: string; features?: unknown[]; geometry?: unknown; properties?: { name?: unknown } };
    if (o.type === "FeatureCollection" && Array.isArray(o.features)) o.features.forEach(walk);
    else if (o.type === "Feature") {
      if (!name && typeof o.properties?.name === "string") name = o.properties.name;
      geom(o.geometry);
    } else geom(o);
  };
  walk(data);
  return { pts, name };
}

/** Lee GPX, TCX, KML o GeoJSON y devuelve la lista de puntos del trazado. */
export function parseRoute(text: string, fileName = "Ruta"): Parsed {
  if (text.length > MAX_FILE_BYTES * 2) throw new Error("El archivo es demasiado grande (máximo 10 MB).");
  const body = text.replace(/^﻿/, "").trimStart();
  const base = fileName.replace(/\.[^.]+$/, "").trim() || "Ruta";
  let pts: Pt[] = [];
  let name: string | undefined;
  let format = "";
  if (body.startsWith("{")) {
    format = "GeoJSON";
    try {
      const g = parseGeoJson(body);
      pts = g.pts;
      name = g.name;
    } catch {
      throw new Error("El archivo GeoJSON está dañado.");
    }
  } else if (/<gpx\b/i.test(body)) {
    format = "GPX";
    pts = parseGpx(body);
    name = tag(body.replace(/<metadata\b[\s\S]*?<\/metadata>/i, (m) => m), "name");
    const trk = /<trk\b[^>]*>([\s\S]*?)<\/trk>/i.exec(body);
    name = (trk && tag(trk[1].replace(/<trkseg\b[\s\S]*?<\/trkseg>/gi, ""), "name")) || name;
  } else if (/<TrainingCenterDatabase\b/i.test(body)) {
    format = "TCX";
    pts = parseTcx(body);
    name = tag(body, "Name");
  } else if (/<kml\b/i.test(body)) {
    format = "KML";
    pts = parseKml(body);
    name = tag(body, "name");
  } else {
    throw new Error("Formato no reconocido. Usa un archivo GPX, TCX, KML o GeoJSON (los FIT no son compatibles).");
  }
  if (pts.length > MAX_POINTS) throw new Error("La ruta tiene demasiados puntos (máximo 300 000).");
  const good = pts.filter(valid);
  if (good.length < 2) throw new Error(`No encontré un recorrido en el archivo ${format}. Debe contener un trazado (track o ruta) con al menos 2 puntos.`);
  return { name: (name || base).slice(0, 120), coords: good.map((p) => [p.lat, p.lng] as LatLng), ele: good.map((p) => p.ele), format };
}

export function routeStats(coords: LatLng[], ele: (number | null)[]) {
  let distance = 0;
  for (let i = 1; i < coords.length; i++) distance += haversine(coords[i - 1], coords[i]);
  let gain = 0;
  let anchor: number | null = null;
  for (const e of ele) {
    if (e === null) continue;
    if (anchor === null) anchor = e;
    else if (e - anchor >= 3) {
      gain += e - anchor;
      anchor = e;
    } else if (anchor - e >= 3) anchor = e;
  }
  return { distance_m: distance, gain_m: gain };
}

/** Douglas-Peucker iterativo sobre coordenadas métricas locales. */
export function simplify(coords: LatLng[], target = KEEP_POINTS): LatLng[] {
  if (coords.length <= target) return coords;
  const lat0 = (coords[0][0] * Math.PI) / 180;
  const xy = coords.map(([la, lo]) => [lo * Math.cos(lat0) * 111320, la * 110540] as [number, number]);
  let tol = 1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const keep = new Uint8Array(coords.length);
    keep[0] = keep[coords.length - 1] = 1;
    const stack: [number, number][] = [[0, coords.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let max = 0, idx = -1;
      const [ax, ay] = xy[a], [bx, by] = xy[b];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) {
        const t = len2 ? Math.max(0, Math.min(1, ((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / len2)) : 0;
        const d = Math.hypot(xy[i][0] - (ax + t * dx), xy[i][1] - (ay + t * dy));
        if (d > max) { max = d; idx = i; }
      }
      if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    const out = coords.filter((_, i) => keep[i]);
    if (out.length <= target) return out;
    tol *= 2;
  }
  const step = Math.ceil(coords.length / target);
  return coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
}

export function buildRoute(p: Parsed, id: string, now = new Date(), name?: string): Route {
  const stats = routeStats(p.coords, p.ele);
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  return {
    id,
    name: (name ?? p.name).trim().slice(0, 120) || "Ruta",
    created: now.toISOString(),
    distance_m: stats.distance_m,
    gain_m: stats.gain_m,
    coords: simplify(p.coords).map(([a, b]) => [round(a), round(b)] as LatLng),
    source: p.format,
  };
}

export function routeToGpx(r: Route) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pts = r.coords.map(([a, b]) => `<trkpt lat="${a}" lon="${b}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Selfie Bike Radar" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(r.name)}</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

/** Distancia en metros desde una posición hasta el trazado (proyección sobre segmentos). */
export function distanceToRoute(pos: LatLng, coords: LatLng[]): number {
  if (coords.length === 0) return Infinity;
  const kx = Math.cos((pos[0] * Math.PI) / 180) * 111320, ky = 110540;
  const px = pos[1] * kx, py = pos[0] * ky;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][1] * kx, ay = coords[i][0] * ky, bx = coords[i + 1][1] * kx, by = coords[i + 1][0] * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}
