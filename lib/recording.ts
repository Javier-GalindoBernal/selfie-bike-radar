import { haversine } from "./geo.ts";
import { MAX_STEP_M } from "./skills/noStraightLines.ts";

export type RecPoint = {
  id: string;
  lat: number;
  lng: number;
  segment: number;
  accuracy: number;
  speed: number | null;
  altitude: number | null;
  at: string; // ISO
  brk?: boolean; // hueco de señal: no unir con el punto anterior al dibujar
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
  moving?: boolean; // ¿se está desplazando de verdad? (no solo ruido del GPS)
  speedMps?: number; // velocidad real filtrada
  movingMs?: number; // tiempo en movimiento
  lastSampleAt?: number;
  eventId?: string | null; // salida del grupo a la que pertenece (null = salida privada)
  eventTitle?: string | null;
  moveUntil?: number; // el movimiento real se mantiene 6 s tras confirmarse (evita parpadeos de velocidad)
};

/** Un desplazamiento menor que el error del GPS o que esta distancia es ruido, no movimiento. */
export const MIN_MOVE_M = 15;
export const MIN_MOVE_SPEED_MPS = 0.8; // ≈ 2.9 km/h (velocidad media desde el último punto guardado)
export const DEVICE_SPEED_MIN_MPS = 0.7; // si el dispositivo informa velocidad, debe superar ≈ 2.5 km/h
export const MOVE_HOLD_MS = 6000;
export const HEARTBEAT_S = 20; // estando quieto, un punto cada 20 s para que el grupo te siga viendo

export type Sample = {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  altitude: number | null;
  at: number; // epoch ms
};

export function newRecState(a: { rideId: string; groupId: string; userId: string; name: string; now: number; eventId?: string | null; eventTitle?: string | null }): RecState {
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
    eventId: a.eventId ?? null,
    eventTitle: a.eventTitle ?? null,
    moving: false,
    speedMps: 0,
    movingMs: 0,
    lastSampleAt: a.now,
  };
}

/** Filtra y acumula una muestra GPS con las mismas reglas que acepta el servidor. */
export function applySample(s: RecState, x: Sample, id: string, now = Date.now()): RecState {
  if (s.status !== "active") return s;
  if (!Number.isFinite(x.lat) || !Number.isFinite(x.lng) || Math.abs(x.lat) > 90 || Math.abs(x.lng) > 180) return s;
  if (!(x.accuracy >= 0 && x.accuracy <= 100)) return s;
  if (x.at < Date.parse(s.startedAt) || x.at > now + 4 * 60_000) return s;
  const prev = s.points[s.points.length - 1];
  const speedOk = x.speed !== null && Number.isFinite(x.speed) && x.speed >= 0 && x.speed <= 50;
  const altitude = x.altitude !== null && Number.isFinite(x.altitude) && x.altitude >= -500 && x.altitude <= 9000 ? x.altitude : null;
  const mk = (lat: number, lng: number, speed: number | null, brk: boolean): RecPoint => ({
    id, lat, lng, segment: s.segment, accuracy: x.accuracy, speed, altitude, at: new Date(x.at).toISOString(), ...(brk ? { brk: true } : {}),
  });
  if (!prev) {
    return { ...s, points: [mk(x.lat, x.lng, speedOk ? x.speed : null, false)], moving: false, speedMps: 0, lastSampleAt: x.at };
  }
  const prevAt = Date.parse(prev.at);
  if (x.at <= prevAt) return s;
  const dt = (x.at - prevAt) / 1000;
  if (prev.segment !== s.segment) {
    // primera muestra tras reanudar: nuevo trazo, sin sumar distancia
    return { ...s, points: [...s.points, mk(x.lat, x.lng, speedOk ? x.speed : null, false)], moving: false, speedMps: 0, lastSampleAt: x.at };
  }
  const d = haversine([prev.lat, prev.lng], [x.lat, x.lng]);
  if (d / dt > 50) return s; // salto imposible de GPS
  // Movimiento real: supera el error del GPS, la distancia mínima y una velocidad mínima; y el dispositivo no dice que está quieto.
  // El punto de referencia es el último punto guardado: el ruido no lo mueve, y al pedalear el desplazamiento se acumula hasta superar el umbral.
  const threshold = Math.max(MIN_MOVE_M, 2 * x.accuracy);
  const deviceStill = speedOk && (x.speed as number) < DEVICE_SPEED_MIN_MPS && d < 60;
  const confirmed = d >= threshold && d / dt >= MIN_MOVE_SPEED_MPS && !deviceStill;
  if (confirmed) {
    const v = speedOk ? (x.speed as number) : d / dt;
    return {
      ...s,
      distance: s.distance + d,
      points: [...s.points, mk(x.lat, x.lng, v, d > MAX_STEP_M)],
      moving: true,
      speedMps: v,
      moveUntil: x.at + MOVE_HOLD_MS,
      lastSampleAt: x.at,
    };
  }
  // Sin movimiento confirmado. Si el dispositivo informa que vas a más de ~2.5 km/h, se muestra esa velocidad (la distancia se suma al superar el umbral).
  const deviceMoving = speedOk && (x.speed as number) >= DEVICE_SPEED_MIN_MPS && x.accuracy <= 30;
  const moveUntil = deviceMoving ? x.at + MOVE_HOLD_MS : s.moveUntil ?? 0;
  const speedMps = deviceMoving ? (x.speed as number) : s.speedMps ?? 0;
  const base = { ...s, moveUntil, speedMps, moving: x.at < moveUntil, lastSampleAt: x.at };
  // Latido cada 20 s en la misma posición para seguir visible en el radar.
  if (dt >= HEARTBEAT_S) return { ...base, points: [...s.points, mk(prev.lat, prev.lng, base.moving ? speedMps : 0, false)] };
  return base;
}

/** Velocidad a mostrar en km/h: 0 si estás quieto o si hace más de 8 s que no llega una muestra GPS. */
export function displaySpeedKmh(s: RecState, now: number): number {
  if (s.status !== "active" || !s.lastSampleAt || now - s.lastSampleAt > 8000 || !s.moveUntil || s.lastSampleAt >= s.moveUntil) return 0;
  return (s.speedMps ?? 0) * 3.6;
}

export function tick(s: RecState, now: number): RecState {
  if (s.status !== "active" || s.lastTick === null) return s;
  const delta = Math.min(Math.max(now - s.lastTick, 0), 5000); // el tiempo con la página suspendida no se cuenta
  const moving = !!s.moveUntil && !!s.lastSampleAt && s.lastSampleAt < s.moveUntil && now - s.lastSampleAt <= 8000;
  return { ...s, activeMs: s.activeMs + delta, movingMs: (s.movingMs ?? 0) + (moving ? delta : 0), lastTick: now };
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
    if (p.segment !== seg || p.brk) {
      out.push([]);
      seg = p.segment;
    }
    out[out.length - 1].push([p.lat, p.lng]);
  }
  return out;
}
