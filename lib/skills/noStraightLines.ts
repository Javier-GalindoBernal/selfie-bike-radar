/**
 * SKILL interna · «Sin líneas rectas»
 * Regla: un trazado nunca se dibuja ni se guarda uniendo dos puntos lejanos con una línea recta.
 *  - Al dibujar una ruta, cada tramo se calcula por calles/ciclovías; si no hay camino, el tramo se marca como fallido (no se inventa una recta).
 *  - Al grabar o importar, los saltos largos se detectan y se cortan (o se corrigen por calles) en vez de unirse en recta.
 */
import { haversine } from "../geo.ts";
import type { LatLng, RoadRoute } from "../route.ts";

/** Distancia máxima entre dos puntos consecutivos para considerarlos un mismo trazo continuo. */
export const MAX_STEP_M = 400;

export type Run = { from: number; to: number; length: number };
export type Router = (a: LatLng, b: LatLng, signal?: AbortSignal) => Promise<RoadRoute | null>;

/** Tramos donde dos puntos consecutivos están más lejos de lo razonable: serían una línea recta. */
export function findStraightRuns(coords: LatLng[], maxStep = MAX_STEP_M): Run[] {
  const runs: Run[] = [];
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]);
    if (d > maxStep) runs.push({ from: i - 1, to: i, length: d });
  }
  return runs;
}

/** Parte la polilínea en trazos continuos para no dibujar rectas sobre los huecos. */
export function splitAtGaps(coords: LatLng[], maxStep = MAX_STEP_M): LatLng[][] {
  const out: LatLng[][] = [];
  let cur: LatLng[] = [];
  coords.forEach((c, i) => {
    if (i > 0 && haversine(coords[i - 1], c) > maxStep) {
      if (cur.length) out.push(cur);
      cur = [];
    }
    cur.push(c);
  });
  if (cur.length) out.push(cur);
  return out;
}

export type Leg = { from: LatLng; to: LatLng; route: RoadRoute | null };

/** Une waypoints tramo a tramo por calles. Un tramo sin camino queda con route=null (nunca una recta). */
export async function connectByRoad(waypoints: LatLng[], router: Router, signal?: AbortSignal): Promise<Leg[]> {
  const legs: Leg[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    legs.push({ from: waypoints[i - 1], to: waypoints[i], route: await router(waypoints[i - 1], waypoints[i], signal) });
  }
  return legs;
}

/** Une los tramos en una sola lista de coordenadas sin repetir los puntos de empalme. */
export function joinLegs(legs: Leg[]): LatLng[] {
  const out: LatLng[] = [];
  for (const l of legs) {
    if (!l.route) continue;
    const pts = l.route.coords;
    out.push(...(out.length ? pts.slice(1) : pts));
  }
  return out;
}

/** Comprueba que una ruta construida no contenga rectas ni tramos sin camino. */
export function validateBuilt(legs: Leg[]): { ok: boolean; failedLegs: number[]; straight: number } {
  const failedLegs = legs.flatMap((l, i) => (l.route ? [] : [i]));
  const straight = findStraightRuns(joinLegs(legs)).length;
  return { ok: failedLegs.length === 0 && straight === 0 && legs.length > 0, failedLegs, straight };
}
