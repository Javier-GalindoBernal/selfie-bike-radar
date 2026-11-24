import test from "node:test";
import assert from "node:assert/strict";
import { newRecState, applySample, pause, resume, finish, tick } from "../lib/recording.ts";

const t0 = Date.parse("2026-11-23T15:00:00Z");
const mk = () => newRecState({ rideId: "r", groupId: "g", userId: "u", name: "x", now: t0 });
const s = (lat, lng, sec, acc = 5) => ({ lat, lng, accuracy: acc, speed: 5, altitude: 2600, at: t0 + sec * 1000 });

test("acumula distancia y descarta ruido, saltos y precisión mala", () => {
  let st = mk();
  st = applySample(st, s(4.6, -74.08, 1), "a", t0 + 60_000);
  st = applySample(st, s(4.6001, -74.08, 5), "b", t0 + 60_000); // ~11 m
  assert.equal(st.points.length, 2);
  assert.ok(st.distance > 10 && st.distance < 12);
  const before = st;
  assert.equal(applySample(st, s(4.60011, -74.08, 6), "c", t0 + 60_000), before); // <4 m
  assert.equal(applySample(st, s(5.5, -74.08, 7), "d", t0 + 60_000), before); // salto
  assert.equal(applySample(st, s(4.6003, -74.08, 9, 150), "e", t0 + 60_000), before); // precisión >100 m
  assert.equal(applySample(st, s(4.6003, -74.08, -5), "f", t0 + 60_000), before); // antes del inicio
});

test("las pausas abren segmento nuevo y no unen distancia", () => {
  let st = applySample(mk(), s(4.6, -74.08, 1), "a", t0 + 60_000);
  st = pause(st, t0 + 10_000);
  assert.equal(applySample(st, s(4.6001, -74.08, 12), "x", t0 + 60_000), st);
  st = resume(st, t0 + 20_000);
  const d = st.distance;
  st = applySample(st, s(4.7, -74.08, 40), "b", t0 + 60_000);
  assert.equal(st.distance, d);
  assert.equal(st.points[1].segment, 1);
});

test("tiempo activo limita huecos y finalizar fija ended_at válido", () => {
  let st = mk();
  st = tick(st, t0 + 1000);
  st = tick(st, t0 + 3_600_000);
  assert.equal(st.activeMs, 6000);
  st = finish(st, t0 + 3_600_000);
  assert.equal(st.status, "finished");
  assert.ok(Date.parse(st.endedAt) >= Date.parse(st.startedAt));
});
