'use client';
import { useMemo, useSyncExternalStore } from 'react';
import type { Route } from './routes';

const KEY = 'radar-routes-v1';
const ACTIVE = 'radar-active-route';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}
function snapshot() {
  try {
    return (localStorage.getItem(KEY) || '[]') + '|' + (localStorage.getItem(ACTIVE) || '');
  } catch {
    return '[]|';
  }
}
const serverSnapshot = () => '[]|';

function readAll(): Route[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? (v as Route[]).filter((r) => r && typeof r.id === 'string' && Array.isArray(r.coords)) : [];
  } catch {
    return [];
  }
}

export function addRoute(r: Route) {
  const next = [r, ...readAll().filter((x) => x.id !== r.id)].slice(0, 30);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    throw new Error('No hay espacio en este navegador para guardar la ruta. Elimina alguna ruta guardada.');
  }
  emit();
}
export function removeRoute(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(readAll().filter((x) => x.id !== id)));
    if (localStorage.getItem(ACTIVE) === id) localStorage.removeItem(ACTIVE);
  } catch {
    /* sin almacenamiento */
  }
  emit();
}
export function setActiveRoute(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE, id);
    else localStorage.removeItem(ACTIVE);
  } catch {
    /* sin almacenamiento */
  }
  emit();
}

export function useRoutes() {
  const snap = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return useMemo(() => {
    const i = snap.lastIndexOf('|');
    let routes: Route[] = [];
    try {
      const v = JSON.parse(snap.slice(0, i));
      if (Array.isArray(v)) routes = v as Route[];
    } catch {
      /* datos dañados */
    }
    const activeId = snap.slice(i + 1);
    return { routes, activeId, active: routes.find((r) => r.id === activeId) ?? null };
  }, [snap]);
}
