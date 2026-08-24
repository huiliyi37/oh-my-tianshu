#!/bin/sh
# One-line installer for @huiliyi37/oh-my-tianshu.
#
# Auto-repairs the npm-mirror sync window: right after a release, mirrors such
# as npmmirror have the entry package but not every dependency yet, and a plain
# `npm i -g` then dies with ETARGET before any of our code exists on the
# machine. Resolution-time failures cannot be intercepted from inside a
# package, so the retry lives here: install with the user's configured
# registry first, and on failure retry once against the official registry —
# which always has the complete release.
#
# Usage: curl -fsSL <repo>/scripts/install.sh | sh
set -u

PACKAGE='@huiliyi37/oh-my-tianshu'
OFFICIAL_REGISTRY='https://registry.npmjs.org'
ALLOW_SCRIPTS='koffi,node-pty,@huiliyi37/dsh-subprocess-local,@google/genai,protobufjs'

log() { printf '[oh-my-tianshu] %s\n' "$*"; }

if ! command -v npm >/dev/null 2>&1; then
  log 'npm not found. Install Node.js (^22.19 || >=24) first: https://nodejs.org/'
  exit 1
fi

# npm >= 11 blocks not-allowlisted lifecycle scripts; older npm runs them by
# default and rejects the unknown flag, so pass it only when supported.
NPM_MAJOR=$(npm -v | cut -d. -f1)
FLAGS=''
if [ "${NPM_MAJOR:-0}" -ge 11 ]; then
  FLAGS="--allow-scripts=$ALLOW_SCRIPTS"
fi

REGISTRY=$(npm config get registry 2>/dev/null || true)
log "registry: ${REGISTRY:-"(npm default)"}"

if npm install -g $FLAGS "$PACKAGE"; then
  log 'installed. Start with: oh-my-tianshu tui   (quit: Ctrl+Q or /exit)'
  exit 0
fi

log 'install failed on the configured registry.'
log 'most likely a mirror sync window (entry package present, dependencies not yet).'
log "retrying once against the official registry ($OFFICIAL_REGISTRY)…"
if npm install -g --registry="$OFFICIAL_REGISTRY" $FLAGS "$PACKAGE"; then
  log 'installed from the official registry. Start with: oh-my-tianshu tui'
  exit 0
fi

log 'both attempts failed. If the error is not ETARGET, check Node version (^22.19 || >=24) and network.'
exit 1
