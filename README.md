# Selfie Bike Radar

App propia para grupos de ciclistas, independiente de Strava. Dashboard web (Next.js) y app móvil (Flutter, Android/iOS). No requiere suscripción deportiva.

## Qué funciona en el código

- Acceso con correo/contraseña de Supabase Auth; confirmación por correo si está activada en el proyecto.
- Crear grupos privados y unirse con un código de invitación.
- Dashboard con radar, estadísticas de las últimas 100 salidas del grupo, historial y exportación GPX personal paginada.
- App móvil: iniciar, pausar, reanudar y finalizar salida, cola local persistente, reintentos de sincronización, historial y exportación GPX.
- Ubicaciones solo de salidas activas con puntos recibidos en los últimos dos minutos. El grupo ve resúmenes de salidas; el GPS histórico solo lo ve el dueño.
- Al pausar sin red, el servidor no recibe inmediatamente la pausa. La última posición puede permanecer visible hasta dos minutos; no es un sistema de emergencias.
- La vista de ejemplo contiene exclusivamente datos ficticios. No registra ubicaciones ni las envía.

## Activar tu Supabase existente (una vez)

1. En el SQL Editor, ejecutar TODO `supabase/migrations/20261123_independent_radar.sql`. Crea tablas nuevas sin borrar las anteriores. Es una migración para ejecutar una vez; no repetir si ya terminó correctamente.
2. En Settings → API Keys, copiar la clave **publishable** o **anon**. Agregar a `.env.local`:

```env
SUPABASE_URL=https://iurhahinzyxwmedhcvcw.supabase.co
SUPABASE_PUBLISHABLE_KEY=tu_clave_publica
```

La clave pública se entrega al navegador: RLS restringe los datos por cuenta y grupo. **Nunca** copiar `service_role` ni `sb_secret_` en el navegador o la app. El servidor de esta versión no necesita la clave service role. Las credenciales antiguas de Strava no se usan.

También puedes pegar URL + clave pública en la pantalla de conexión: solo se guardan localmente en ese navegador. No es obligatorio editar archivos para probar el dashboard.

3. Crear tu cuenta desde la pantalla de la app. Si Supabase pide confirmación, abrir el correo y luego iniciar sesión. Para enlaces de correo configura Authentication → URL Configuration → Site URL con la dirección del dashboard. No desactivar la confirmación por conveniencia en un servicio público.
4. Crear grupo y compartir el código únicamente con sus integrantes.

## Ejecutar dashboard

```sh
npm install
npm run dev
```

Abrir http://localhost:3001. Compilación: `npm run build`; servidor de producción: `npm start`.

Sin clave pública configurada sigue disponible «Explorar una vista de ejemplo». El dashboard es para consultar, no para grabar con el navegador bloqueado. `/share` explica el nuevo flujo. Las API abiertas del prototipo y las rutas Strava devuelven HTTP 410; sus fuentes anteriores se conservan como texto en `legacy-strava/`.

## Cuenta, logo y foto de perfil

La primera pantalla pide **entrar o crear cuenta** (nombre, correo y contraseña); la conexión con Supabase viene incluida mediante `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (valores públicos) y solo queda una «Configuración avanzada» si el servidor no responde. La foto de perfil se sube tocando el círculo de la esquina superior; requiere ejecutar una vez `supabase/migrations/20261125_profile_avatars.sql` (bucket público `avatars`, cada persona solo escribe en su carpeta). Cualquiera que conozca el identificador de usuario puede ver su foto por URL.

## Cargar rutas (GPX, TCX, KML, GeoJSON)

La pestaña «Rutas» permite cargar un archivo de ruta (de Strava, Komoot, Wikiloc, Garmin, Google Earth…), ver distancia y desnivel, guardarla y «seguirla»: el trazado se dibuja punteado en el mapa del radar y en el de «Grabar», con aviso si te desvías más de 60 m. Al cargar una ruta se valida (mínimo 200 m, sin coordenadas absurdas) y se avisa de saltos, rutas de ida o falta de altitud. En «Grabar» se elige la ruta a seguir antes de iniciar y durante la salida se muestra el avance y el desvío. Las rutas se guardan solo en el navegador del teléfono (hasta 30, simplificadas a ~2500 puntos) y no se comparten con el grupo. No se admite FIT.

## Dibujar rutas y «skills» internas

«Rutas → Dibujar ruta» funciona como el planificador de Strava: tocas el mapa para marcar puntos y cada tramo se traza por calles y ciclovías (perfil bicicleta de OpenStreetMap vía routing.openstreetmap.de); si un tramo no tiene camino se marca con ✕ y no se guarda en línea recta. Dos módulos internos aplican las reglas (`lib/skills/`):

- **Sin líneas rectas** (`noStraightLines.ts`): detecta saltos de más de 400 m entre puntos, corta el trazo en vez de unirlo en recta (también al grabar con huecos de señal) y valida que una ruta construida no tenga tramos sin camino.
- **Corrector de ruta** (`routeCorrector.ts`): «Corregir por calles» rellena los saltos de un archivo importado con el camino real; y si te desvías más de 60 m de la ruta que sigues, calcula y dibuja (línea azul) el camino por calles para volver a ella.

## Grabar salidas desde la web

La pestaña «● Grabar» registra una salida con el GPS del navegador: tiempo activo, distancia, velocidad, pausa/reanudar, mapa con el trazado y envío a tu cuenta (los compañeros te ven en el radar mientras estés activo). Si se corta la red, los puntos quedan en el teléfono y se envían al volver. **Limitación del navegador:** el GPS web se detiene si bloqueas la pantalla o cambias de app; la página pide mantener la pantalla encendida, pero no sustituye a la app nativa para salidas largas. Aún no se ha probado una salida real en un teléfono.

## App móvil

Ver `MOBILE.md` y `mobile/README.md`. No está publicada en tiendas ni se ha verificado una salida en dispositivos físicos. Compilar código Flutter no equivale a garantizar GPS en segundo plano: hay que probar bloqueo de pantalla, permisos, ahorro de batería, pausa, recuperación de red y exportación en Android y iPhone reales.

No se incluyen sensores de pulso, potencia o cadencia ni mapas sin conexión. La distancia entre miembros se calcula por calles y ciclovías con el servicio público de rutas de OpenStreetMap (routing.openstreetmap.de), que recibe las dos coordenadas de cada cálculo; si no responde, se indica «ruta no disponible» en lugar de inventar una distancia. El mapa dibuja la ruta en azul y el rastro reciente de cada ciclista en naranja, y el historial permite ver tu propio recorrido GPS. El mapa de OpenStreetMap requiere internet y atribución. GPS offline puede registrar, pero compartir requiere datos.

## Verificación

```sh
npm test
npm run lint
npm run build
```

Las pruebas de base de datos usan PostgreSQL local en memoria (PGlite), con tres usuarios y roles separados: verifican aislamiento entre grupos, autoría de puntos, GPS histórico privado, RPC de invitaciones y ocultamiento al pausar. No son una comprobación de la configuración remota hasta que se ejecute allí la migración.

La infraestructura gratuita tiene cuotas. La publicación y distribución móvil, especialmente iOS, puede tener costos; no se promete alojamiento ni distribución ilimitados sin pagos.

## Arranque local y diagnóstico

La dirección local es siempre http://localhost:3001. Desarrollo usa `.next-local/`; las compilaciones usan `.next/`, para que compilar no invalide los archivos que está sirviendo la vista local. No mantener un servidor de producción abierto mientras se recompila su carpeta `.next/`: detenerlo antes de compilar y reiniciarlo después.

`npm run check:running` comprueba la página, todos los JS/CSS de arranque, `/share` y la respuesta pública de configuración. Detecta el caso en que el HTML devuelve 200 pero un archivo JS falla y deja la página sin arrancar. Esta verificación no confirma un inicio de sesión ni el acceso de un usuario real a Supabase.

La app tolera una configuración local dañada o almacenamiento del navegador bloqueado. Las peticiones de configuración tienen un límite de cinco segundos y las de conexión de doce segundos. Guardar conexión ahora comprueba la dirección y la clave pública con Supabase antes de continuar. Si no hay clave pública, se puede explorar el ejemplo sin conectar una cuenta.

## Avisos y desempeño por integrante

Aplicar una vez en una consulta NUEVA de Supabase el archivo `supabase/migrations/20261124_alerts_and_stats.sql`, después de la migración inicial. La ampliación es idempotente: puede repetirse sin borrar tablas ni salidas anteriores. No volver a ejecutar la migración inicial sobre las tablas existentes.

- Cuatro categorías: pinchazo, avería mecánica, salud y otro aviso. La selección abre una confirmación; nunca publica al tocar una categoría.
- Texto de hasta 280 caracteres, obligatorio en «Otro». Ubicación solo si se adjunta explícitamente. Los avisos son privados del grupo, duran 24 horas y su autor puede cerrarlos. Los compañeros pueden responder «Me acerco a ayudar» una sola vez.
- Solo se muestra un envío confirmado por el servidor como publicado. Un timeout deja el resultado sin confirmar: actualizar la lista antes de reintentar. El UUID estable evita duplicar el mismo aviso al reintentar. No se encolan avisos urgentes para enviarlos horas después.
- Sondeo cada 10 segundos con la app abierta y red. NO hay push fuera de la app, SMS ni llamadas a emergencias.
- Vista Desempeño: semana calendario y mes en hora de Colombia, o acumulado. Suma todas las salidas finalizadas del integrante en el grupo, no solo las últimas 100. La media es ponderada por distancia y tiempo activo; incluye máxima y ascenso GPS para salidas nuevas.
- La app móvil registra máxima GPS, altitud de precisión aceptable y ascenso estimado con filtro de ruido. Descarta saltos incompatibles con la duración y separa trazas ante interrupciones de GPS superiores a dos minutos. No garantiza precisión equivalente a dispositivos especializados.
- Ejemplo directo: http://localhost:3001/?demo=1. Estadísticas de ejemplo: http://localhost:3001/?demo=1&vista=performance. Todos los avisos y cifras de este modo son ficticios y no se envían al grupo real.
