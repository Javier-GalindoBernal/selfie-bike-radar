import test from "node:test";
import assert from "node:assert/strict";
import { findStraightRuns, splitAtGaps, connectByRoad, joinLegs, validateBuilt } from "../lib/skills/noStraightLines.ts";
import { fillStraightGaps, nearestOnRoute, rejoinPath } from "../lib/skills/routeCorrector.ts";
import { newRecState, applySample, toSegments } from "../lib/recording.ts";

const pt = (lat, lng) => [lat, lng];
const road = (a, b) => ({ coords: Array.from({ length: 31 }, (_, i) => { const t = i / 30; return pt(a[0] + (b[0] - a[0]) * t + Math.sin(t * Math.PI) * 0.0004, a[1] + (b[1] - a[1]) * t); }), distance_m: Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 110000) * 1.2, duration_s: 100 });
const okRouter = async (a, b) => road(a, b);
const noRouter = async () => null;

test("detecta y corta rectas largas", () => {
  const c = [pt(4, -74), pt(4.001, -74), pt(4.02, -74), pt(4.021, -74)];
  const runs = findStraightRuns(c);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].from, 1);
  const parts = splitAtGaps(c);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[1][0], c[2]);
});

test("construir por calles: nunca inventa rectas cuando no hay camino", async () => {
  const wps = [pt(4, -74), pt(4.003, -74), pt(4.006, -74.001)];
  const good = await connectByRoad(wps, okRouter);
  const v = validateBuilt(good);
  assert.equal(v.ok, true);
  assert.equal(joinLegs(good)[0][0], 4);
  const bad = await connectByRoad(wps, async (a, b) => (b[0] > 4.005 ? null : road(a, b)));
  const vb = validateBuilt(bad);
  assert.equal(vb.ok, false);
  assert.deepEqual(vb.failedLegs, [1]);
  assert.equal(joinLegs(bad).length, joinLegs([bad[0]]).length); // el tramo fallido no aporta línea
});

test("corrector rellena saltos con el camino real o los deja sin inventar", async () => {
  const c = [pt(4, -74), pt(4.001, -74), pt(4.02, -74), pt(4.021, -74)];
  const fixed = await fillStraightGaps(c, okRouter);
  assert.equal(fixed.filled, 1);
  assert.ok(fixed.coords.length > c.length);
  assert.equal(findStraightRuns(fixed.coords, 400).length, 0);
  const failed = await fillStraightGaps(c, noRouter);
  assert.equal(failed.failed, 1);
  assert.deepEqual(failed.coords, c);
});

test("volver a la ruta: punto más cercano y camino por calles", async () => {
  const route = [pt(4, -74), pt(4.01, -74)];
  const n = nearestOnRoute(pt(4.005, -74.001), route);
  assert.ok(Math.abs(n.point[0] - 4.005) < 1e-6 && n.point[1] === -74);
  assert.ok(n.off_m > 100 && n.off_m < 120);
  const r = await rejoinPath(pt(4.005, -74.001), route, okRouter);
  assert.ok(r.path && r.path.coords.length > 2);
  const none = await rejoinPath(pt(4.005, -74.001), route, noRouter);
  assert.equal(none.path, null);
});

test("al grabar, un hueco de señal corta el trazo en vez de unirlo en recta", () => {
  const t0 = Date.parse("2026-11-23T15:00:00Z");
  let st = newRecState({ rideId: "r", groupId: "g", userId: "u", name: "x", now: t0 });
  const s = (lat, sec) => ({ lat, lng: -74.08, accuracy: 5, speed: 5, altitude: 2600, at: t0 + sec * 1000 });
  st = applySample(st, s(4.6, 1), "a", t0 + 600_000);
  st = applySample(st, s(4.6001, 8), "b", t0 + 600_000);
  st = applySample(st, s(4.606, 100), "c", t0 + 600_000); // ~660 m tras 92 s sin señal
  const segs = toSegments(st.points);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].length, 2);
  assert.equal(segs[1].length, 1);
});
