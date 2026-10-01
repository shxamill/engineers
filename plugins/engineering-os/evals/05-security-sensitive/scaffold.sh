#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../_fixtures/cases.sh"
setup_case "$(basename "$HERE")" "${1:-$PWD}"
