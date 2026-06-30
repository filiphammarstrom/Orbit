#!/usr/bin/env bash
set -euo pipefail

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Xcode saknas: xcodebuild finns inte i PATH." >&2
  exit 1
fi

version="$(xcodebuild -version | awk '/^Xcode / { print $2 }')"
major="${version%%.*}"

if [[ -z "${version}" || -z "${major}" ]]; then
  echo "Kunde inte läsa Xcode-version." >&2
  xcodebuild -version >&2
  exit 1
fi

if [[ "${major}" -lt 27 ]]; then
  echo "Xcode 27 krävs för nästa Apple-konverteringssteg. Installerad version: Xcode ${version}." >&2
  exit 2
fi

echo "Xcode ${version} OK."
