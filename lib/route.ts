export type LatLng = [number, number];
export type RoadRoute = { coords: LatLng[]; distance_m: number; duration_s: number };

const cache = new Map<string, RoadRoute | null>();
const BASE = "https://routing.openstreetmap.de/routed-bike/route/v1/driving";

/** Ruta real por calles y ciclovías (perfil bicicleta de OpenStreetMap). Devuelve null si no hay ruta. */
export async function roadRoute(a: LatLng, b: LatLng, signal?: AbortSignal): Promise<RoadRoute | null> {
  const key = `${a[0].toFixed(4)},${a[1].toFixed(4)};${b[0].toFixed(4)},${b[1].toFixed(4)}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const res = await fetch(`${BASE}/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`, { signal });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const r = data?.routes?.[0];
    if (!r?.geometry?.coordinates?.length) {
      cache.set(key, null);
      return null;
    }
    const route: RoadRoute = {
      coords: (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as LatLng),
      distance_m: Number(r.distance),
      duration_s: Number(r.duration),
    };
    if (cache.size > 200) cache.clear();
    cache.set(key, route);
    return route;
  } catch {
    return null; // sin red o servicio ocupado: no se inventa una distancia
  }
}
