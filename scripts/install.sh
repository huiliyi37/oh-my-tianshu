#!/bin/sh
# dsh one-line installer.
#
#   curl -fsSL https://raw.githubusercontent.com/deepseek-ai/deepseek-harness-sdk/master/scripts/install.sh | sh
#
# It clones the harness under ~/.dsh/source (the master clone at
# ~/.dsh/source/master), adds a per-install staging worktree at
# ~/.dsh/source/staging-<timestamp> on branch dsh-staging/<timestamp>, checks
# host dependencies (git, Node, pnpm) and offers to install a missing pnpm, runs
# `pnpm install`, points the stable `~/.dsh/source/current` symlink
# at that staging worktree and symlinks `dsh` onto PATH at `current/bin/dsh`,
# records your API credentials in the Harness home (`~/.dsh`) dsh reads at boot,
# builds the repository artifacts, and launches the Web UI. Keeping every
# checkout under ~/.dsh/source keeps successive
# upgrades in one place instead of scattered sibling clones, and lets staging
# worktrees share the master clone's object store. The PATH symlink resolves through
# `current`, so an upgrade repoints one stable symlink instead of relinking PATH:
# the `dsh` on PATH never moves and can never dangle.
#
# When run from inside an existing checkout (e.g. `sh scripts/install.sh` rather
# than `curl ... | sh`) it never clones and never touches that working tree;
# DSH_REF is ignored. Instead it *adopts* the checkout: `git rev-parse
# --git-common-dir` resolves the repository behind it (for a linked worktree that
# is the real clone, not the worktree), and a fresh staging worktree branched
# from the checkout's HEAD lands in the source container beside `current`. The
# container owns staging worktrees and `current`; the clone is discovered, not
# owned, so an arbitrary clone (~/src/dsh) and a managed one converge on one
# layout and stay upgradable. Adoption carries committed work only: the staging
# worktree branches from HEAD, so uncommitted changes stay in the checkout.
# Setting DSH_SOURCE to a different directory opts back into the normal
# clone/worktree path.
#
# Adopting an arbitrary clone leaves the container not self-contained: its
# staging worktrees hold an absolute gitdir pointer into that clone, so deleting
# it breaks them. `git worktree list` in that clone is the record of which
# worktrees depend on it.
#
# When run through `curl | sh` the script text arrives on stdin, so every
# prompt and the final launch read the controlling terminal (/dev/tty) directly;
# with no terminal the script prints the manual next steps instead.
#
# Overridable via environment:
#   DSH_REF          branch or tag to clone/checkout    (default: master)
#   DSH_REPO         clone URL                           (default: the GitHub repo)
#   DSH_SOURCE       source container directory          (default: ~/.dsh/source)
#   DSH_MASTER       master clone directory              (default: $DSH_SOURCE/master)
#   DSH_CURRENT      stable symlink to the active worktree (default: $DSH_SOURCE/current)
#   DSH_BIN_DIR      directory the `dsh` symlink lands in (default: ~/.local/bin)
#   DSH_HOME         Harness home holding profiles and user patches (default: ~/.dsh)
set -eu

DSH_REF=${DSH_REF:-master}
DSH_REPO=${DSH_REPO:-https://github.com/deepseek-ai/deepseek-harness-sdk.git}
# DSH_SOURCE is the staging-worktree container and the default home of `current`.
# DSH_MASTER names the main clone: clone mode defaults it inside DSH_SOURCE,
# while adoption discovers an existing clone anywhere on disk. Remember whether
# DSH_SOURCE was explicit so a different path selects clone mode.
if [ -n "${DSH_SOURCE:-}" ]; then DSH_SOURCE_EXPLICIT=1; else DSH_SOURCE_EXPLICIT=0; fi
DSH_SOURCE=${DSH_SOURCE:-$HOME/.dsh/source}
DSH_MASTER=${DSH_MASTER:-$DSH_SOURCE/master}
# The stable symlink the PATH launcher resolves through: PATH/dsh ->
# current/bin/dsh -> <staging>/bin/dsh. Installs and upgrades repoint `current`;
# the PATH target remains current/bin/dsh.
DSH_CURRENT=${DSH_CURRENT:-$DSH_SOURCE/current}
DSH_BIN_DIR=${DSH_BIN_DIR:-$HOME/.local/bin}
# One UTC basic timestamp names this install's staging branch and worktree.
DSH_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DSH_STAGING_BRANCH=dsh-staging/$DSH_STAMP
DSH_STAGING=$DSH_SOURCE/staging-$DSH_STAMP

# --- path helpers ---------------------------------------------------------------
# Every path comparison below runs on physical paths. Git always reports resolved
# paths, so comparing one against an unresolved path disagrees whenever a symlink
# sits anywhere above the checkout — a symlinked home directory is enough, and
# macOS reaches every mktemp path that way through /var -> private/var. The
# mismatch silently misclassifies an existing managed install as a foreign clone
# and builds a second container beside the real one.
# `git rev-parse --path-format=absolute` would do this, but it needs git 2.31+.
#
# A not-yet-created directory (the container on a fresh install) has no physical
# path. Falling back here rather than at each call site keeps every caller a
# plain assignment, so no site can compare against an empty path by forgetting
# its own fallback.
resolve_dir() { CDPATH= cd -- "$1" 2>/dev/null && pwd -P || printf '%s\n' "$1"; }

# --- in-repo detection ---------------------------------------------------------
# Under `curl ... | sh` the script text arrives on stdin, so $0 is the shell
# name and no file path resolves; running a checked-out copy (`sh
# scripts/install.sh`) makes $0 the script file. When $0 is a readable file whose
# parent is a scripts/ dir inside a real dsh checkout (bin/dsh launcher present),
# this is in-repo mode: never clone, never touch that working tree. An explicit
# DSH_SOURCE pointing elsewhere opts back into the clone/worktree path.
IN_REPO=0
DSH_CHECKOUT=''
if [ -f "$0" ]; then
  _self_dir=$(resolve_dir "$(dirname -- "$0")")
  if [ -n "$_self_dir" ]; then
    # Physical without its own resolve_dir: dirname is textual, so trimming a
    # resolved path leaves one. The comparison below depends on that.
    _repo_root=$(dirname -- "$_self_dir")
    if [ "$(basename -- "$_self_dir")" = scripts ] \
      && [ -x "$_repo_root/bin/dsh" ] && [ -f "$_repo_root/scripts/install.sh" ]; then
      # Compare the explicit DSH_SOURCE physically: an unresolved but equivalent
      # path must still count as "the caller meant this checkout".
      _src_resolved=$(resolve_dir "$DSH_SOURCE")
      if [ "$DSH_SOURCE_EXPLICIT" = 0 ] || [ "$_src_resolved" = "$_repo_root" ]; then
        IN_REPO=1
        DSH_CHECKOUT=$_repo_root
      fi
    fi
  fi
fi

# --- terminal-aware prompting --------------------------------------------------
# stdin is the piped script, so read the controlling terminal for input.
if { true </dev/tty; } 2>/dev/null; then
  HAS_TTY=1
  # Restore terminal echo on exit or interrupt: ask_secret disables echo between
  # its stty toggles, and dash (a common `sh`) does not run an EXIT trap when the
  # shell is killed by a signal, so the fatal signals need their own handler. A
  # successful run ends in exec, which replaces this process and drops the traps.
  trap 'stty echo </dev/tty 2>/dev/null || true' EXIT
  trap 'stty echo </dev/tty 2>/dev/null || true; exit 130' INT TERM HUP
else
  HAS_TTY=0
fi

# Colour only when writing to a terminal.
if [ -t 1 ]; then
  B=$(printf '\033[1m'); DIM=$(printf '\033[2m'); RED=$(printf '\033[31m')
  GRN=$(printf '\033[32m'); YEL=$(printf '\033[33m'); RST=$(printf '\033[0m')
else
  B=''; DIM=''; RED=''; GRN=''; YEL=''; RST=''
fi

info()  { printf '%s==>%s %s\n' "$GRN" "$RST" "$1"; }
step()  { printf '\n%s==>%s %s%s%s\n' "$GRN" "$RST" "$B" "$1" "$RST"; }
warn()  { printf '%s warn%s %s\n' "$YEL" "$RST" "$1" >&2; }
die()   { printf '%serror%s %s\n' "$RED" "$RST" "$1" >&2; exit 1; }

# ask PROMPT [DEFAULT] -> answer on stdout (plain-text line).
ask() {
  [ "$HAS_TTY" = 1 ] || die "no terminal available for input; re-run in an interactive shell"
  printf '%s%s%s ' "$B" "$1" "$RST" >/dev/tty
  IFS= read -r _ans </dev/tty || _ans=''
  [ -n "$_ans" ] || _ans=${2:-}
  printf '%s' "$_ans"
}

# ask_secret PROMPT -> answer on stdout, with terminal echo suppressed.
ask_secret() {
  [ "$HAS_TTY" = 1 ] || die "no terminal available for input; re-run in an interactive shell"
  printf '%s%s%s ' "$B" "$1" "$RST" >/dev/tty
  stty -echo </dev/tty 2>/dev/null || true
  IFS= read -r _sec </dev/tty || _sec=''
  stty echo </dev/tty 2>/dev/null || true
  printf '\n' >/dev/tty
  printf '%s' "$_sec"
}

# confirm PROMPT [Y] -> exit 0 on yes. Default is no unless second arg is "Y".
confirm() {
  _def=${2:-N}
  if [ "$HAS_TTY" != 1 ]; then
    [ "$_def" = Y ]  # non-interactive: take the default
    return
  fi
  if [ "$_def" = Y ]; then _hint='[Y/n]'; else _hint='[y/N]'; fi
  printf '%s%s%s %s ' "$B" "$1" "$RST" "$_hint" >/dev/tty
  IFS= read -r _r </dev/tty || _r=''
  [ -n "$_r" ] || _r=$_def
  case "$_r" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

printf '%s\n' "${B}DeepSeek Harness — dsh installer${RST}"
if [ "$IN_REPO" = 1 ]; then
  printf '%scheckout %s%s\n' "$DIM" "$DSH_CHECKOUT" "$RST"
else
  printf '%smaster %s @ %s%s\n' "$DIM" "$DSH_MASTER" "$DSH_REF" "$RST"
  printf '%sstaging %s%s\n' "$DIM" "$DSH_STAGING" "$RST"
  printf '%scurrent %s%s\n' "$DIM" "$DSH_CURRENT" "$RST"
fi

# --- 1. dependency check -------------------------------------------------------
step "Checking dependencies"

command -v git >/dev/null 2>&1 || die "git is required but not found. Install git, then re-run."
info "git ... ok"

# Node ^22.19.0 || >=24.0.0 (see the root package.json "engines" field).
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  _v=$(node -v 2>/dev/null) || return 1
  _v=${_v#v}
  _major=${_v%%.*}
  _rest=${_v#*.}
  _minor=${_rest%%.*}
  case "$_major" in ''|*[!0-9]*) return 1 ;; esac
  case "$_minor" in ''|*[!0-9]*) _minor=0 ;; esac
  [ "$_major" -ge 24 ] && return 0
  [ "$_major" -eq 22 ] && [ "$_minor" -ge 19 ] && return 0
  return 1
}
if node_ok; then
  info "node $(node -v) ... ok"
else
  if command -v node >/dev/null 2>&1; then
    die "Node $(node -v) is unsupported. dsh needs ^22.19.0 || >=24.0.0 — upgrade Node, then re-run."
  fi
  die "Node is required but not found. Install Node ^22.19.0 || >=24, then re-run."
fi

# pnpm is the only dependency we offer to install for you.
if command -v pnpm >/dev/null 2>&1; then
  info "pnpm $(pnpm --version) ... ok"
else
  warn "pnpm is not installed."
  if confirm "Install pnpm now?" Y; then
    if command -v corepack >/dev/null 2>&1 && corepack enable pnpm >/dev/null 2>&1; then
      info "enabled pnpm via corepack"
    elif command -v npm >/dev/null 2>&1 && npm install -g pnpm >/dev/null 2>&1; then
      info "installed pnpm via npm"
    else
      die "could not install pnpm automatically. Install it (https://pnpm.io/installation), then re-run."
    fi
    command -v pnpm >/dev/null 2>&1 || die "pnpm still not on PATH after install. Open a new shell, then re-run."
  else
    die "pnpm is required. Install it (https://pnpm.io/installation), then re-run."
  fi
fi

# --- 2. resolve the repository and lay out the staging worktree ---------------
# The source container owns staging worktrees and `current`; the repository is
# *discovered*, not owned. A curl install discovers it by cloning to $DSH_MASTER;
# in-repo adoption discovers it from the checkout. Both then run one shared
# worktree/exclude/lock path, so an arbitrary clone and a managed install
# converge on the same layout.
#
# REPO_COMMON is the shared git directory every worktree of the repository
# points at; REPO_ROOT is the working tree that owns it (the master clone).
REPO_COMMON=''
REPO_ROOT=''

if [ "$IN_REPO" = 1 ]; then
  step "Using existing checkout at $DSH_CHECKOUT"
  info "running from inside the repo — never cloning, and DSH_REF is ignored"

  # Resolve the repository behind the checkout. --git-common-dir returns the
  # SHARED git dir, so a linked worktree resolves to the real clone rather than
  # itself; it is relative for a plain clone, so anchor it before resolving.
  # Require the resolved git dir to exist: resolve_dir echoes its argument back
  # for a missing path, so test the directory rather than the returned string.
  if _common=$(git -C "$DSH_CHECKOUT" rev-parse --git-common-dir 2>/dev/null) && [ -n "$_common" ]; then
    case "$_common" in /*) ;; *) _common=$DSH_CHECKOUT/$_common ;; esac
    [ -d "$_common" ] && REPO_COMMON=$(resolve_dir "$_common")
  fi
  [ -n "$REPO_COMMON" ] || die "$DSH_CHECKOUT is not a git repository — cannot adopt it."
  REPO_ROOT=$(dirname -- "$REPO_COMMON")

  # Reuse the container when the repository already lives inside it (the normal
  # managed install re-running its own script); otherwise treat that clone as
  # its own master and keep worktrees in the default container.
  _src_resolved=$(resolve_dir "$DSH_SOURCE")
  case "$REPO_ROOT/" in
    "$_src_resolved"/*) info "repository $REPO_ROOT is already inside $DSH_SOURCE" ;;
    *) info "adopting clone $REPO_ROOT as its own master" ;;
  esac
  DSH_MASTER=$REPO_ROOT
else
  step "Fetching source into $DSH_MASTER"
  if [ -d "$DSH_MASTER/.git" ]; then
    info "existing master clone found — updating"
    git -C "$DSH_MASTER" fetch origin "$DSH_REF"
    # Reset the master checkout to the freshly fetched tip. FETCH_HEAD (not
    # origin/<ref>) so this resolves for a tag as well as a branch, and -B makes
    # the re-run idempotent whether or not DSH_REF changed since the last install.
    git -C "$DSH_MASTER" checkout -q -B "$DSH_REF" FETCH_HEAD
  else
    mkdir -p "$DSH_SOURCE"
    git clone --branch "$DSH_REF" "$DSH_REPO" "$DSH_MASTER"
  fi
  # Physical on both branches: REPO_ROOT is compared against resolved paths
  # below, and REPO_COMMON stays symmetric with it so neither can be read as
  # carrying a different kind of path.
  REPO_COMMON=$(resolve_dir "$DSH_MASTER/.git")
  REPO_ROOT=$(resolve_dir "$DSH_MASTER")
fi

step "Adding staging worktree at $DSH_STAGING"
[ -e "$DSH_STAGING" ] && die "staging path $DSH_STAGING already exists — remove it or set DSH_SOURCE elsewhere, then re-run."
mkdir -p "$DSH_SOURCE"
# The staging worktree owns the branch dsh runs from; the repository stays as
# the fetch/upgrade base and is never a launcher target. A clone install
# branches from the ref it just fetched; adoption branches from the checkout's
# HEAD so the contributor's committed work is what runs.
if [ "$IN_REPO" = 1 ]; then
  git -C "$DSH_CHECKOUT" worktree add -b "$DSH_STAGING_BRANCH" "$DSH_STAGING" HEAD
else
  git -C "$DSH_MASTER" worktree add -b "$DSH_STAGING_BRANCH" "$DSH_STAGING" FETCH_HEAD 2>/dev/null \
    || git -C "$DSH_MASTER" worktree add -b "$DSH_STAGING_BRANCH" "$DSH_STAGING" HEAD
fi
# Exclude the per-worktree merge lock in the shared git dir's info/exclude,
# which every linked worktree inherits.
_exclude="$REPO_COMMON/info/exclude"
if [ -f "$_exclude" ] && ! grep -qxF '.agents/merge.lock' "$_exclude" 2>/dev/null; then
  printf '.agents/merge.lock\n' >>"$_exclude"
fi
mkdir -p "$DSH_STAGING/.agents"
: >"$DSH_STAGING/.agents/merge.lock"

# --- 3. install dependencies (no build; the launcher runs from source) --------
step "Installing dependencies with pnpm (this can take a while)"
( cd "$DSH_STAGING" && pnpm install )

[ -x "$DSH_STAGING/bin/dsh" ] || die "launcher $DSH_STAGING/bin/dsh missing after install — is DSH_REF a branch that ships apps/cli?"

# --- 4. put `dsh` on PATH ------------------------------------------------------
# Every install goes through a stable `current` symlink so an upgrade repoints
# one symlink (current -> new worktree) and the PATH launcher never moves:
# PATH/dsh -> current/bin/dsh -> <staging>/bin/dsh.
step "Linking dsh into $DSH_BIN_DIR"
mkdir -p "$DSH_BIN_DIR"
# The launcher must resolve to a staging worktree, never to the repository
# itself: an upgrade repoints `current`, so aliasing it onto the master clone
# would make every upgrade rewrite the fetch/upgrade base. Compare physical
# paths — a symlinked or unresolved path would slip past a string compare.
_staging_resolved=$(resolve_dir "$DSH_STAGING")
[ "$_staging_resolved" = "$REPO_ROOT" ] \
  && die "refusing to point $DSH_CURRENT at the repository $REPO_ROOT — the launcher must resolve to a staging worktree."
# Point `current` at this staging worktree with `ln -sfn`: -f replaces an
# existing `current` (re-run or upgrade) and -n stops `ln` from dereferencing
# an existing symlink-to-directory and dropping the new link *inside* the old
# worktree. `mv` is unusable here — BSD/macOS `mv` follows the existing dir
# symlink the same way. The swap is one unlink+symlink pair on a local fs; the
# installer holds no other process racing this path.
ln -sfn "$DSH_STAGING" "$DSH_CURRENT"
info "pointed $DSH_CURRENT -> $DSH_STAGING"
DSH_LAUNCH_TARGET=$DSH_CURRENT/bin/dsh
ln -sf "$DSH_LAUNCH_TARGET" "$DSH_BIN_DIR/dsh"
info "linked $DSH_BIN_DIR/dsh -> $DSH_LAUNCH_TARGET"

case ":$PATH:" in
  *":$DSH_BIN_DIR:"*) ON_PATH=1 ;;
  *) ON_PATH=0 ;;
esac
if [ "$ON_PATH" = 0 ]; then
  warn "$DSH_BIN_DIR is not on your PATH."
  _line="export PATH=\"$DSH_BIN_DIR:\$PATH\""
  _rc=''
  _sh=${SHELL:-}  # SHELL may be unset; word-removal on an unset var trips set -u under dash.
  case "${_sh##*/}" in
    zsh)  _rc="$HOME/.zshrc" ;;
    bash) _rc="$HOME/.bashrc" ;;
  esac
  if [ -n "$_rc" ] && [ -f "$_rc" ] && grep -qF "$_line" "$_rc" 2>/dev/null; then
    info "$_rc already exports $DSH_BIN_DIR — open a new shell to pick it up"
  elif [ -n "$_rc" ] && confirm "Add it to $_rc?" Y; then
    printf '\n# Added by the dsh installer\n%s\n' "$_line" >>"$_rc"
    info "updated $_rc — run 'source $_rc' or open a new shell to pick it up"
  else
    warn "add this line to your shell profile yourself:"
    printf '    %s\n' "$_line"
  fi
fi

# --- 5. credentials ------------------------------------------------------------
# Mirror app-boot's resolveDshHome precedence ($DSH_HOME, else ~/.dsh) so creds land where dsh reads them.
if [ -n "${DSH_HOME:-}" ]; then
  CONF="$DSH_HOME"
else
  CONF="$HOME/.dsh"
fi
ENV_FILE="$CONF/.env"

step "Configuring credentials"
if [ -f "$ENV_FILE" ] && grep -q '^DEEPSEEK_API_KEY=' "$ENV_FILE" 2>/dev/null; then
  info "DEEPSEEK_API_KEY already set in $ENV_FILE"
  if ! confirm "Replace it?" N; then
    SKIP_CREDS=1
  fi
fi
if [ "${SKIP_CREDS:-0}" != 1 ]; then
  if [ "$HAS_TTY" = 1 ]; then
    API_KEY=$(ask_secret "DeepSeek API key (input hidden):")
    if [ -z "$API_KEY" ]; then
      warn "no key entered — skipping. Set DEEPSEEK_API_KEY in $ENV_FILE before using dsh."
    else
      BASE_URL=$(ask "DeepSeek base URL (optional, Enter to skip):")
      mkdir -p "$CONF"
      # The installer owns exactly the two DEEPSEEK_* lines; any other lines the
      # user keeps in this .env are preserved. The rewrite happens in a subshell
      # so umask 077 (which closes the create-time permission race) does not leak
      # into the exec'd dsh, and lands atomically via a same-dir temp + mv.
      _tmp="$ENV_FILE.dsh.$$"
      (
        umask 077
        if [ -f "$ENV_FILE" ]; then
          grep -v -e '^DEEPSEEK_API_KEY=' -e '^DEEPSEEK_BASE_URL=' "$ENV_FILE" >"$_tmp" || true
        else
          : >"$_tmp"
        fi
        printf 'DEEPSEEK_API_KEY=%s\n' "$API_KEY" >>"$_tmp"
        if [ -n "$BASE_URL" ]; then printf 'DEEPSEEK_BASE_URL=%s\n' "$BASE_URL" >>"$_tmp"; fi
      )
      mv "$_tmp" "$ENV_FILE"
      chmod 600 "$ENV_FILE" 2>/dev/null || true
      info "wrote $ENV_FILE"
    fi
  else
    warn "no terminal for credential input — set DEEPSEEK_API_KEY in $ENV_FILE before using dsh."
  fi
fi

# --- 6. build and launch the Web interface -------------------------------------
step "Done"
if [ "$HAS_TTY" = 1 ]; then
  step "Building DeepSeek Harness for Web UI"
  ( cd "$DSH_STAGING" && pnpm run build )
  info "launching Web UI — run 'dsh web' anytime to start again"
  exec "$DSH_BIN_DIR/dsh" web </dev/tty
else
  info "install complete. Build and start the Web UI with:"
  printf '    (cd %s && pnpm run build)\n' "$DSH_STAGING"
  printf '    %s web\n' "$DSH_BIN_DIR/dsh"
fi
