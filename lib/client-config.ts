export type PublicConfig = { url: string; key: string };

export function savedConfig(
  storage: Pick<Storage, 'getItem'>,
  fallback: PublicConfig,
): { config: PublicConfig; warning: string } {
  try {
    const raw = storage.getItem('radar-public-config');
    if (!raw) return { config: fallback, warning: '' };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' ||
      !('url' in value) || typeof value.url !== 'string' ||
      !('key' in value) || typeof value.key !== 'string') {
      throw new Error('Configuración incompleta');
    }
    return { config: { url: value.url.trim(), key: value.key.trim() }, warning: '' };
  } catch {
    return {
      config: fallback,
      warning: 'No pudimos leer la conexión guardada en este navegador. Puedes volver a configurarla.',
    };
  }
}

// Acota también las llamadas de Auth: un fallo de red no debe dejar botones bloqueados indefinidamente.
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 12000,
): Promise<Response> {
  const controller = new AbortController();
  const original = init?.signal || (input instanceof Request ? input.signal : null);
  const abort = () => controller.abort();
  if (original?.aborted) controller.abort();
  original?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    original?.removeEventListener('abort', abort);
  }
}
