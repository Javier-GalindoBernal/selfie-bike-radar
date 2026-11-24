#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
FLUTTER_BIN="${FLUTTER_BIN:-/Users/airm4/tools/flutter/bin/flutter}"
if [[ ! -x "$FLUTTER_BIN" ]]; then FLUTTER_BIN="$(command -v flutter || true)"; fi
if [[ -z "$FLUTTER_BIN" ]]; then echo 'Falta instalar Flutter.' >&2; exit 1; fi
if [[ -z "${JAVA_HOME:-}" ]] && ! java -version >/dev/null 2>&1; then echo 'Falta instalar un JDK compatible con Android (Java 17 o el que indique Flutter doctor).' >&2; exit 1; fi
RADAR_ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
if [[ ! -d "$RADAR_ANDROID_SDK/platforms" ]]; then echo 'Falta Android SDK. Sigue la guía MOBILE.md antes de compilar.' >&2; exit 1; fi
"$FLUTTER_BIN" pub get
"$FLUTTER_BIN" analyze
"$FLUTTER_BIN" test
"$FLUTTER_BIN" build apk --debug
printf '%s\n' 'APK de pruebas generado: build/app/outputs/flutter-apk/app-debug.apk'
