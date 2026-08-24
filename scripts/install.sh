#!/bin/sh
# One-line installer for @huiliyi37/oh-my-tianshu.
#
# Auto-repairs the npm-mirror sync window: right after a release, mirrors such
# as npmmirror have the entry package but not every dependency yet, and a plain
# `npm i -g` then dies with ETARGET before any of our code exists on the
# machine. Resolution-time failures cannot be intercepted from inside a
# package, so the retry lives here. Three tiers, first success wins:
#   1. the user's configured registry (unchanged when it works);
#   2. the official registry (always complete; may be flaky from some networks);
#   3. the Tencent mirror (complete for this release and CN-network friendly).
# Retries also remove a partial install of our scope first — a leftover from a
# killed attempt otherwise fails cleanup on Windows with EPERM.
#
# Usage: curl -fsSL <repo>/scripts/install.sh | sh
set -u

PACKAGE='@huiliyi37/oh-my-tianshu'
OFFICIAL_REGISTRY='https://registry.npmjs.org'
TENCENT_REGISTRY='https://mirrors.cloud.tencent.com/npm'
ALLOW_SCRIPTS='koffi,node-pty,@huiliyi37/dsh-subprocess-local,@google/genai,protobufjs'
RETRY_FLAGS='--fetch-retries=5 --fetch-retry-mintimeout=10000'

log() { printf '[oh-my-tianshu] %s\n' "$*"; }

if ! command -v npm >/dev/null 2>&1; then
  log 'npm not found. Install Node.js (^22.19 || >=24) first: https://nodejs.org/'
  exit 1
fi

# npm >= 11 blocks not-allowlisted lifecycle scripts; older npm runs them by
# default and rejects the unknown flag, so pass it only when supported.
NPM_MAJOR=$(npm -v 2>/dev/null | head -1 | cut -d. -f1)
FLAGS=''
if [ "${NPM_MAJOR:-0}" -ge 11 ] 2>/dev/null; then
  FLAGS="--allow-scripts=$ALLOW_SCRIPTS"
fi

# Best-effort removal of a partial install of our scope; a locked directory
# (Windows handles, antivirus) is reported but does not abort the install.
clean_partial() {
  ROOT=$(npm root -g 2>/dev/null) || return 0
  [ -n "$ROOT" ] && rm -rf "$ROOT/@huiliyi37" 2>/dev/null || true
}

REGISTRY=$(npm config get registry 2>/dev/null || true)
log "registry: ${REGISTRY:-"(npm default)"}"

if npm install -g $FLAGS "$PACKAGE"; then
  log 'installed. Start with: oh-my-tianshu tui   (quit: Ctrl+Q or /exit)'
  exit 0
fi

log 'install failed on the configured registry.'
log 'most likely a mirror sync window (entry package present, dependencies not yet).'
clean_partial
log "retrying against the official registry ($OFFICIAL_REGISTRY)…"
if npm install -g --registry="$OFFICIAL_REGISTRY" $RETRY_FLAGS $FLAGS "$PACKAGE"; then
  log 'installed from the official registry. Start with: oh-my-tianshu tui'
  exit 0
fi

log 'official registry attempt failed (often a network reset).'
clean_partial
log "last retry against the Tencent mirror ($TENCENT_REGISTRY)…"
if npm install -g --registry="$TENCENT_REGISTRY" $RETRY_FLAGS $FLAGS "$PACKAGE"; then
  log 'installed from the Tencent mirror. Start with: oh-my-tianshu tui'
  exit 0
fi

log 'all three attempts failed. Check Node version (^22.19 || >=24), network/proxy,'
log 'and any locked files under: npm root -g'
exit 1
