#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
FLUTTER_BIN="${FLUTTER_BIN:-/Users/airm4/tools/flutter/bin/flutter}"
if [[ ! -x "$FLUTTER_BIN" ]]; then FLUTTER_BIN="$(command -v flutter || true)"; fi
if [[ -z "$FLUTTER_BIN" ]]; then echo 'Falta instalar Flutter.' >&2; exit 1; fi
if ! xcodebuild -version >/dev/null 2>&1; then echo 'Falta Xcode completo con la plataforma iOS; las Command Line Tools no bastan.' >&2; exit 1; fi
"$FLUTTER_BIN" pub get
"$FLUTTER_BIN" analyze
"$FLUTTER_BIN" test
"$FLUTTER_BIN" build ios --release --no-codesign
printf '%s\n' 'Compilación iOS sin firma: build/ios/iphoneos/Runner.app' 'Para instalar en iPhone, abre ios/Runner.xcworkspace en Xcode y configura tu equipo y firma.'
