import test from "node:test";
import assert from "node:assert/strict";
import { newRecState, applySample, pause, resume, finish, tick, displaySpeedKmh } from "../lib/recording.ts";

const t0 = Date.parse("2026-11-23T15:00:00Z");
const mk = () => newRecState({ rideId: "r", groupId: "g", userId: "u", name: "x", now: t0 });
const s = (lat, lng, sec, acc = 5) => ({ lat, lng, accuracy: acc, speed: 5, altitude: 2600, at: t0 + sec * 1000 });

test("acumula distancia al moverse y descarta saltos y precisión mala", () => {
  let st = mk();
  st = applySample(st, s(4.6, -74.08, 1), "a", t0 + 600_000);
  st = applySample(st, s(4.6003, -74.08, 6), "b", t0 + 600_000); // ~33 m en 5 s
  assert.equal(st.points.length, 2);
  assert.ok(st.distance > 30 && st.distance < 36, String(st.distance));
  const n = st.points.length;
  const d0 = st.distance;
  const same = (x) => assert.deepEqual([x.points.length, x.distance], [n, d0]);
  same(applySample(st, s(4.5, -74.08, 7), "d", t0 + 600_000)); // salto imposible
  same(applySample(st, s(4.6006, -74.08, 9, 150), "e", t0 + 600_000)); // precisión >100 m
  same(applySample(st, s(4.6006, -74.08, -5), "f", t0 + 600_000)); // antes del inicio
});

test("quieto con ruido de GPS no suma distancia ni velocidad", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  for (const [speed, acc, amp] of [[null, 12, 0.00014], [0, 8, 0.0001], [0.6, 12, 0.00014], [null, 20, 0.00022]]) {
    let st = mk();
    for (let i = 1; i <= 300; i++) st = applySample(st, { lat: 4.6 + rnd() * amp, lng: -74.08 + rnd() * amp, accuracy: acc, speed, altitude: 2600, at: t0 + i * 1000 }, "p" + i, t0 + 900_000);
    assert.equal(Math.round(st.distance), 0, `distancia con ruido ${amp}`);
    assert.equal(displaySpeedKmh(st, t0 + 300_000), 0);
    assert.ok(st.points.length <= 20, "solo latidos para seguir visible en el radar");
  }
});

test("pedaleando suma la distancia real y muestra la velocidad", () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  for (const speed of [5, null]) {
    let st = mk();
    for (let i = 1; i <= 120; i++) st = applySample(st, { lat: 4.6 + (i * 5) / 110540 + rnd() * 0.00005, lng: -74.08 + rnd() * 0.00005, accuracy: 6, speed, altitude: 2600, at: t0 + i * 1000 }, "q" + i, t0 + 900_000);
    assert.ok(st.distance > 540 && st.distance < 640, String(st.distance));
    const v = displaySpeedKmh(st, t0 + 120_000);
    assert.ok(v > 12 && v < 24, String(v));
    assert.equal(displaySpeedKmh(st, t0 + 140_000), 0); // sin muestras recientes
  }
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
