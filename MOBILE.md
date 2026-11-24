# Selfie Bike Radar · Flutter

App independiente en `mobile/`, sin dependencia del dashboard web. Android e iOS generados con Flutter **3.50.1 stable**, Dart **3.14.0**, instalado en `/Users/airm4/tools/flutter` desde el repositorio oficial. Instalación: https://docs.flutter.dev/install/manual. No se instalaron Android SDK, Xcode ni simuladores.

## Ejecutar

```sh
cd /Users/airm4/group-tracker/mobile
/Users/airm4/tools/flutter/bin/flutter pub get
/Users/airm4/tools/flutter/bin/flutter run \
  --dart-define=SUPABASE_URL=https://TU-PROYECTO.supabase.co \
  --dart-define=SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA
```

También acepta `SUPABASE_ANON_KEY` como alternativa. Sin defines, la primera pantalla permite guardar URL HTTPS y clave pública localmente. Rechaza `sb_secret_` y JWT cuyo rol no sea `anon`; **nunca utilizar service_role**, ni siquiera desde un archivo .env. No lee `.env.local` del proyecto web. Los defines tienen prioridad sobre los valores locales. Para cambiar un proyecto configurado, borrar los datos de la app y abrirla de nuevo. El control local del rol no sustituye validación JWT ni RLS del servidor.

Antes de probar conectado:

1. Aplicar una vez `supabase/migrations/20261123_independent_radar.sql`, incluyendo `radar_points.segment integer not null default 0`.
2. Obtener una clave anon/publishable nueva del proyecto Supabase. La clave existente identificada como service_role no sirve para esta app.
3. Habilitar email/password en Supabase Auth. Crear cuenta; si exige confirmación de correo, confirmar y volver a iniciar sesión. No se implementan recuperación de contraseña ni enlaces profundos de confirmación.
4. Crear un grupo o unirse mediante código; seleccionar ese grupo antes de iniciar salida. El esquema exige `group_id` no nulo.

Para Android hace falta un SDK Android/JDK compatible; para iOS, Xcode con plataforma iOS, firma y herramientas que Flutter solicite. Los proyectos generados incluyen envoltorios nativos. El release Android conserva firma debug de la plantilla: configurar firma propia antes de distribuir. iOS target generado: 15.0. No se produjo APK/IPA en este entorno.

## Funciones y contrato

- Acceso email/password, registro y cierre de sesión mediante Supabase Auth.
- Grupos privados exclusivamente por RPC `radar_create_group(group_name, member_name)` y `radar_join_group(code, member_name)`. Ambos devuelven UUID; después se recargan los grupos visibles por RLS.
- Radar mediante **`radar_live_locations(gid)`**, sondeo cada 15 s. Consume `user_id`, `display_name`, `latitude`, `longitude`, `speed_mps`, `accuracy_m`, `recorded_at`. El servidor limita a salidas activas y posiciones de últimos 2 minutos. El cliente retira posiciones antiguas incluso ante fallos de red. No consulta puntos históricos de otros miembros.
- **Ubicarme** pide ubicación solo tras tocar el botón; muestra errores de servicio/permisos y timeout de 20 s. Lista desplazable de hasta 180 px con nombre, km/h y km en línea recta desde la posición obtenida. Sin ubicación propia indica “Activa Ubicarme para calcular”. La ubicación propia es una muestra manual con hora y precisión, no seguimiento continuo ni ETA. El mapa se centra al pasar de vacío al primer resultado; no recentra cada sondeo.
- Salida activa/pausada/finalizada, distancia GPS, duración sin pausas, mapa e historial propio. Se exige comprobar salidas remotas antes de iniciar una nueva por sesión de app; permite continuar/pausar/finalizar localmente una salida ya guardada sin red. La restricción única del servidor resuelve conflictos entre dispositivos; usar un dispositivo por cuenta para registrar. Si existe un conflicto, la cola se conserva y se muestra el error.
- `radar_rides`: UUID estable; inserción con conflicto ignorado y actualización **solo** de `status`, `ended_at`, `distance_m`, `duration_s`, `name`. Finalizado siempre lleva `ended_at`; activo/pausado llevan null. Se sincronizan finalizadas antes de nuevas abiertas.
- `radar_points`: UUID estable antes de persistir; inserción con conflicto ignorado, sin UPDATE. Se filtran coordenadas inválidas, precisión fuera de 0..100 m y timestamps anteriores a la salida o más de cinco minutos futuros. Velocidad fuera de 0..50 m/s se envía null. `_segment` local se transforma en `segment` remoto; al recuperar se restaura para GPX y mapa sin unir pausas.
- GPX mediante hoja de compartir del sistema: XML escapado, UTC, trazas separadas por pausa. Historial remoto y GPX cargan puntos propios en páginas de 1000 y combinan por UUID. Salidas antiguas sin segmentación quedan en segmento 0. No se inventa separación que el servidor no tenga.

## Cola y recuperación

SharedPreferences guarda un snapshot por UID con salidas, puntos, grupos, salidas pendientes y IDs de puntos confirmados. Escrituras locales serializadas; se guarda cada punto y cambio de estado antes de sincronizar. Reintento cada 15 segundos, al reanudar app y mediante botón de sincronización. Primero salida, después puntos en lotes de 200. Se evita reenviar puntos ya confirmados; si la respuesta se pierde, UUID + conflicto ignorado permite reintentar. La cola solo se limpia tras éxito; cerrar sesión la conserva separada de otras cuentas.

Tras terminar el proceso, una salida local que estaba activa se recupera **pausada**, con duración del último checkpoint guardado, sin contar tiempo desconocido con la app cerrada. Reanudar exige acción explícita y permisos. La distancia no une muestras separadas por pausa. Un cierre abrupto puede perder muestras aún no persistidas y tiempo desde el último checkpoint.

SharedPreferences **no es una base transaccional ni almacenamiento cifrado**: desinstalar/borrar datos elimina la cola, los recorridos grandes consumen memoria y la reescritura completa por punto no está optimizada para jornadas muy largas. No existe política automática de purga ni garantía de durabilidad frente a fallo del dispositivo. Auth usa la persistencia estándar de supabase_flutter. No se implementa servicio independiente para revivir la app tras force-stop/reinicio.

## GPS nativo: configurado, no probado en hardware

Android utiliza `AndroidSettings`, precisión best, filtro 5 m, intervalo solicitado 5 s, `ForegroundNotificationConfig` y `enableWakeLock`. Manifest incluye ubicación fina/aproximada, Internet, foreground service/location, wake lock y notificaciones. La salida se inicia con la app visible; no solicita ACCESS_BACKGROUND_LOCATION ni inicia una salida desde background. El sistema administra la notificación del servicio; no se añadió flujo propio de permiso POST_NOTIFICATIONS. Comprobar comportamiento real en Android 13/14+ y políticas de batería del fabricante.

iOS utiliza `AppleSettings`, `ActivityType.fitness`, `pauseLocationUpdatesAutomatically: false`, `showBackgroundLocationIndicator: true`, `allowBackgroundLocationUpdates: true`; Info.plist incluye textos when-in-use/always y `UIBackgroundModes: location`. Verificar permisos concedidos, Background Modes/firma del target y comportamiento bloqueado con un dispositivo físico.

El ciclo de vida no pausa automáticamente al ocultar la app: solicita continuidad nativa mientras la salida siga activa. **No se ha demostrado seguimiento ni sincronización continua en segundo plano**, con pantalla bloqueada, ahorro de batería, interrupciones, proceso terminado o app forzada a cerrar. Timers Dart pueden suspenderse; la cola reintenta cuando vuelve a ejecutarse. No se declara soporte background validado. Pausar/finalizar cancela el stream; ante error de GPS se intenta pausar y conservar la cola. Posiciones filtradas y saltos GPS pueden afectar la distancia. El mapa OSM necesita red; no hay descarga de mapas offline.

## Verificación

```sh
cd /Users/airm4/group-tracker/mobile
/Users/airm4/tools/flutter/bin/flutter analyze --no-pub
/Users/airm4/tools/flutter/bin/flutter test --no-pub
```

Suite: tiempo sin pausas; serialización con UUID; GPX XML y segmentos; pantalla de configuración que rechaza secretos; cola offline/reintento, columnas permitidas, segmentos remotos e IDs confirmados; recuperación pausada del checkpoint. Las pruebas de sincronización usan HTTP simulado, no prueban RLS real. Pendientes de integración: migración remota y clave pública. Pendientes manuales: dos usuarios/grupo, distancias Ubicarme, movimiento real, modo avión/reconexión, bloqueo y recuperación, permisos denegados, exportación GPX en dispositivo, compilación Android/iOS y firma.

### Resultado final en este entorno

- `flutter analyze --no-pub`: **No issues found**, salida 0.
- `flutter test --no-pub`: **7 tests passed**, salida 0 (4 modelo/GPX, 1 configuración, 2 sincronización/recuperación).
- `plutil -lint mobile/ios/Runner/Info.plist`: OK.
- Sin build APK/IPA ni pruebas de GPS/background en hardware; sin integración remota por migración y clave pública pendientes. No se instalaron SDK adicionales de Android/iOS.

Resultado verificado el 23 de noviembre de 2026: `flutter analyze --no-pub` sin incidencias y `flutter test --no-pub` con **7 pruebas aprobadas**. La ejecución de pruebas necesitó permitir el socket local del runner. Esto no valida compilación APK/IPA ni GPS físico.

## Ampliación: avisos y desempeño

Antes de usar esta versión con datos reales, ejecutar `supabase/migrations/20261124_alerts_and_stats.sql` en una consulta nueva. No borrar consultas ni tablas existentes. Añade RPC de avisos, respuestas y estadísticas, así como máxima, ascenso y altitud.

La pantalla de inicio muestra los cuatro avisos durante una salida o al seleccionar un grupo. Desde cada grupo se abre la pantalla Avisos/Desempeño; su icono Radar abre el mapa existente. Salud tiene confirmación y ninguna ubicación se adjunta por defecto. Los avisos requieren red, no se encolan offline y se actualizan cada diez segundos en pantalla. No se implementan notificaciones push con la app cerrada/bloqueada ni servicios de emergencia. El UUID del borrador se conserva para reintentar sin duplicación. No cambiar el texto/ubicación de un envío de resultado incierto sin revisar antes la lista.

Desempeño usa el RPC `radar_group_stats(gid,period)` con `week`, `month` o `all`, para todos los miembros actuales del grupo. El tiempo activo excluye pausas manuales. La máxima y el ascenso GPS se sincronizan con la salida; los registros anteriores carecen de esas mediciones. El filtro de ascenso exige precisión vertical entre 0 y 15 metros y cambios de al menos 5 metros; no sustituye altímetro barométrico. GPX incluye altitud cuando está disponible.

### Generar archivos de instalación

- Android: `bash mobile/scripts/build-android.sh` desde la raíz. Exige JDK y Android SDK. Genera un **APK debug de pruebas**, no un release listo para tiendas.
- iOS: `bash mobile/scripts/build-ios.sh`. Exige Xcode completo y plataforma iOS. Genera una `.app` **sin firma**; para instalar en iPhone hay que configurar firma/equipo en Xcode. No se genera ni se presenta un IPA instalable sin esos requisitos.
- Se preparó `.github/workflows/mobile-builds.yml` para compilar Android e iOS en GitHub Actions si el proyecto se publica allí. **El workflow no se ha ejecutado**, no hay repositorio remoto configurado y su configuración no equivale a artefactos disponibles. Los runners y cuotas dependen de la cuenta de GitHub. El artefacto iOS continúa necesitando firma.

En este Mac se confirmaron ausencias de Java, Android SDK y Xcode completo, con aproximadamente 7 GB libres. No se instalaron esos paquetes ni se eliminaron archivos del usuario. No hay APK/IPA producido ni GPS/background comprobado en teléfonos físicos. Se conservan ambos proyectos nativos completos en `mobile/android` y `mobile/ios`.

Verificación de esta ampliación: 11 pruebas Flutter aprobadas, análisis sin incidencias; cinco pruebas Node/PostgreSQL aprobadas, incluyendo aislamiento de avisos, idempotencia, cierre por autor y acumulados de más de cien salidas. Esto no sustituye una prueba de dos cuentas reales sobre el Supabase remoto.
