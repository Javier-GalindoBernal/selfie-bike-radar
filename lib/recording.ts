import { haversine } from "./geo.ts";

export type RecPoint = {
  id: string;
  lat: number;
  lng: number;
  segment: number;
  accuracy: number;
  speed: number | null;
  altitude: number | null;
  at: string; // ISO
};

export type RecState = {
  rideId: string;
  groupId: string;
  userId: string;
  name: string;
  startedAt: string;
  status: "active" | "paused" | "finished";
  endedAt: string | null;
  segment: number;
  distance: number; // metros
  activeMs: number; // tiempo en movimiento sin pausas
  lastTick: number | null;
  points: RecPoint[];
  syncedCount: number;
  rideCreated: boolean;
};

export type Sample = {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  altitude: number | null;
  at: number; // epoch ms
};

export function newRecState(a: { rideId: string; groupId: string; userId: string; name: string; now: number }): RecState {
  return {
    rideId: a.rideId,
    groupId: a.groupId,
    userId: a.userId,
    name: a.name,
    startedAt: new Date(a.now).toISOString(),
    status: "active",
    endedAt: null,
    segment: 0,
    distance: 0,
    activeMs: 0,
    lastTick: a.now,
    points: [],
    syncedCount: 0,
    rideCreated: false,
  };
}

/** Filtra y acumula una muestra GPS con las mismas reglas que acepta el servidor. */
export function applySample(s: RecState, x: Sample, id: string, now = Date.now()): RecState {
  if (s.status !== "active") return s;
  if (!Number.isFinite(x.lat) || !Number.isFinite(x.lng) || Math.abs(x.lat) > 90 || Math.abs(x.lng) > 180) return s;
  if (!(x.accuracy >= 0 && x.accuracy <= 100)) return s;
  if (x.at < Date.parse(s.startedAt) || x.at > now + 4 * 60_000) return s;
  const prev = s.points[s.points.length - 1];
  let add = 0;
  if (prev) {
    const prevAt = Date.parse(prev.at);
    if (x.at <= prevAt) return s;
    if (prev.segment === s.segment) {
      const d = haversine([prev.lat, prev.lng], [x.lat, x.lng]);
      const dt = (x.at - prevAt) / 1000;
      if (d / dt > 50) return s; // salto imposible de GPS
      if (d < 4 && dt < 15) return s; // quieto: no saturar
      if (d >= 4) add = d;
    }
  }
  const speed = x.speed !== null && Number.isFinite(x.speed) && x.speed >= 0 && x.speed <= 50 ? x.speed : null;
  const altitude = x.altitude !== null && Number.isFinite(x.altitude) && x.altitude >= -500 && x.altitude <= 9000 ? x.altitude : null;
  const point: RecPoint = {
    id,
    lat: x.lat,
    lng: x.lng,
    segment: s.segment,
    accuracy: x.accuracy,
    speed,
    altitude,
    at: new Date(x.at).toISOString(),
  };
  return { ...s, distance: s.distance + add, points: [...s.points, point] };
}

export function tick(s: RecState, now: number): RecState {
  if (s.status !== "active" || s.lastTick === null) return s;
  const delta = Math.min(Math.max(now - s.lastTick, 0), 5000); // el tiempo con la página suspendida no se cuenta
  return { ...s, activeMs: s.activeMs + delta, lastTick: now };
}

export function pause(s: RecState, now: number): RecState {
  if (s.status !== "active") return s;
  const t = tick(s, now);
  return { ...t, status: "paused", lastTick: null };
}

export function resume(s: RecState, now: number): RecState {
  if (s.status !== "paused") return s;
  return { ...s, status: "active", segment: s.segment + 1, lastTick: now };
}

export function finish(s: RecState, now: number): RecState {
  if (s.status === "finished") return s;
  const t = s.status === "active" ? tick(s, now) : s;
  const last = t.points[t.points.length - 1];
  const endMs = Math.max(now, last ? Date.parse(last.at) : 0, Date.parse(t.startedAt));
  return { ...t, status: "finished", lastTick: null, endedAt: new Date(endMs).toISOString() };
}

export function toSegments(points: RecPoint[]): [number, number][][] {
  const out: [number, number][][] = [];
  let seg = -1;
  for (const p of points) {
    if (p.segment !== seg) {
      out.push([]);
      seg = p.segment;
    }
    out[out.length - 1].push([p.lat, p.lng]);
  }
  return out;
}
