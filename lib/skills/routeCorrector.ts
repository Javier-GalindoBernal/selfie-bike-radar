/**
 * SKILL interna · «Corrector de ruta»
 *  - fillStraightGaps: corrige una ruta con saltos (rectas) rellenándolos con el camino real por calles.
 *  - rejoinPath: si el ciclista se desvía de la ruta, calcula el camino por calles de regreso al punto más cercano.
 * Si no hay camino calculable no se inventa una recta: el tramo se deja como está y se informa.
 */
import { haversine } from "../geo.ts";
import type { LatLng, RoadRoute } from "../route.ts";
import { findStraightRuns, type Router } from "./noStraightLines.ts";

export type FillResult = { coords: LatLng[]; filled: number; failed: number };

/** Rellena cada salto largo con la ruta por calles, solo si el camino es razonable respecto a la recta. */
export async function fillStraightGaps(coords: LatLng[], router: Router, signal?: AbortSignal): Promise<FillResult> {
  const runs = findStraightRuns(coords);
  if (!runs.length) return { coords, filled: 0, failed: 0 };
  const out: LatLng[] = [];
  let last = 0;
  let filled = 0;
  let failed = 0;
  for (const r of runs) {
    out.push(...coords.slice(last, r.from + 1));
    const route = await router(coords[r.from], coords[r.to], signal);
    if (route && route.distance_m <= r.length * 3 + 300 && route.coords.length > 2) {
      out.push(...route.coords.slice(1, -1));
      filled++;
    } else failed++;
    last = r.to;
  }
  out.push(...coords.slice(last));
  return { coords: out, filled, failed };
}

/** Punto más cercano de la ruta a una posición (con su distancia). */
export function nearestOnRoute(pos: LatLng, coords: LatLng[]): { point: LatLng; index: number; off_m: number } {
  const kx = Math.cos((pos[0] * Math.PI) / 180) * 111320, ky = 110540;
  const px = pos[1] * kx, py = pos[0] * ky;
  let best = Infinity, point: LatLng = coords[0], index = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][1] * kx, ay = coords[i][0] * ky, bx = coords[i + 1][1] * kx, by = coords[i + 1][0] * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) {
      best = d;
      point = [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t];
      index = i;
    }
  }
  return { point, index, off_m: best === Infinity ? haversine(pos, coords[0]) : best };
}

export type Rejoin = { target: LatLng; off_m: number; path: RoadRoute | null };

/** Camino por calles para volver a la ruta; path=null si no se pudo calcular (no se dibuja recta). */
export async function rejoinPath(pos: LatLng, route: LatLng[], router: Router, signal?: AbortSignal): Promise<Rejoin> {
  const n = nearestOnRoute(pos, route);
  const path = await router(pos, n.point, signal);
  return { target: n.point, off_m: n.off_m, path };
}
