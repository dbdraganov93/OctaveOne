#!/usr/bin/env bash
set -euo pipefail

usage() {
    echo "Usage: $0 [apk]"
    echo "  Without args: start Metro and launch the Android emulator"
    echo "  apk         : build release APK"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

if [[ "${1:-}" == "apk" ]]; then
    echo "Building release APK..."
    (cd android && ./gradlew assembleRelease)
    echo "APK generated at android/app/build/outputs/apk/release/app-release.apk"
    exit 0
fi

if ! command -v adb >/dev/null; then
    echo "Error: adb not found. Please install Android platform tools." >&2
    exit 1
fi

METRO_PID=""
if ! lsof -i:8081 >/dev/null 2>&1; then
    echo "Starting Metro bundler..."
    npx react-native start --reset-cache &
    METRO_PID=$!
    # give Metro some time to start
    sleep 3
fi

cleanup() {
    if [[ -n "$METRO_PID" ]]; then
        kill "$METRO_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

npx react-native run-android
