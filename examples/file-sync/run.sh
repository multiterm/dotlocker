#!/usr/bin/env sh
set -eu
: "${PLUTO_TOKEN:?Set PLUTO_TOKEN}"
: "${PLUTO_ORG:?Set PLUTO_ORG}"
: "${PLUTO_REPO:?Set PLUTO_REPO}"
pnpm exec pluto push --org "$PLUTO_ORG" --repo "$PLUTO_REPO"
pnpm exec pluto pull --org "$PLUTO_ORG" --repo "$PLUTO_REPO"
