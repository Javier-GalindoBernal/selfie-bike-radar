import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeStats, buildRoute, simplify, distanceToRoute, routeToGpx } from "../lib/routes.ts";

const gpx = `<?xml version="1.0"?><gpx version="1.1"><metadata><name>Meta</name></metadata><wpt lat="4.7" lon="-74.0"><name>Café</name></wpt><trk><name>Subida a Zipaquirá</name><trkseg>
<trkpt lat="4.9000" lon="-74.0300"><ele>2600</ele></trkpt><trkpt lon="-74.0290" lat="4.9010"><ele>2610</ele></trkpt><trkpt lat="4.9020" lon="-74.0280"><ele>2625</ele></trkpt></trkseg></trk></gpx>`;

test("GPX: nombre, orden de atributos, waypoints ignorados y desnivel", () => {
  const p = parseRoute(gpx, "x.gpx");
  assert.equal(p.format, "GPX");
  assert.equal(p.name, "Subida a Zipaquirá");
  assert.equal(p.coords.length, 3);
  assert.deepEqual(p.coords[1], [4.901, -74.029]);
  const s = routeStats(p.coords, p.ele);
  assert.ok(s.distance_m > 280 && s.distance_m < 330, String(s.distance_m));
  assert.equal(Math.round(s.gain_m), 25);
});

test("GPX con rutas (rtept) y autocierre", () => {
  const p = parseRoute(`<gpx><rte><name>R</name><rtept lat="4.1" lon="-74.1"/><rtept lat="4.2" lon="-74.1"/></rte></gpx>`, "r.gpx");
  assert.equal(p.coords.length, 2);
});

test("TCX, KML y GeoJSON", () => {
  const tcx = `<TrainingCenterDatabase><Courses><Course><Name>Curso</Name><Track><Trackpoint><Position><LatitudeDegrees>4.5</LatitudeDegrees><LongitudeDegrees>-74.5</LongitudeDegrees></Position><AltitudeMeters>100</AltitudeMeters></Trackpoint><Trackpoint><Position><LatitudeDegrees>4.6</LatitudeDegrees><LongitudeDegrees>-74.5</LongitudeDegrees></Position></Trackpoint></Track></Course></Courses></TrainingCenterDatabase>`;
  assert.equal(parseRoute(tcx, "a.tcx").coords.length, 2);
  const kml = `<kml><Document><name>K</name><Placemark><Point><coordinates>-74,4,0</coordinates></Point></Placemark><Placemark><LineString><coordinates>-74.0,4.0,10 -74.0,4.1,20 -74.0,4.2,30</coordinates></LineString></Placemark></Document></kml>`;
  const k = parseRoute(kml, "k.kml");
  assert.equal(k.coords.length, 3);
  assert.deepEqual(k.coords[0], [4, -74]);
  const gj = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "G" }, geometry: { type: "LineString", coordinates: [[-74, 4, 2600], [-74, 4.1]] } }] });
  const g = parseRoute(gj, "g.geojson");
  assert.equal(g.name, "G");
  assert.equal(g.coords.length, 2);
});

test("rechaza archivos sin recorrido y formatos desconocidos", () => {
  assert.throws(() => parseRoute("<gpx><wpt lat='1' lon='1'/></gpx>", "w.gpx"), /No encontré un recorrido/);
  assert.throws(() => parseRoute("hola", "x.txt"), /Formato no reconocido/);
  assert.throws(() => parseRoute("{rota", "x.json"), /dañado/);
  assert.throws(() => parseRoute(`<gpx><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="999" lon="0"/></trkseg></trk></gpx>`, "z.gpx"), /No encontré/);
});

test("simplifica rutas largas conservando extremos y mide desvío", () => {
  const coords = Array.from({ length: 20000 }, (_, i) => [4 + i * 1e-5, -74 + Math.sin(i / 50) * 1e-4]);
  const s = simplify(coords);
  assert.ok(s.length <= 2500 && s.length > 50);
  assert.deepEqual(s[0], coords[0]);
  assert.deepEqual(s[s.length - 1], coords[coords.length - 1]);
  const line = [[4, -74], [4.01, -74]];
  assert.ok(distanceToRoute([4.005, -74.0005], line) > 50 && distanceToRoute([4.005, -74.0005], line) < 60);
  assert.ok(distanceToRoute([4.005, -74], line) < 1);
  const r = buildRoute(parseRoute(gpx, "x.gpx"), "id1", new Date("2026-01-01"));
  assert.match(routeToGpx(r), /<trkpt lat="4.9"/);
});
