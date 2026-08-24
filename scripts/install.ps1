# One-line installer for @huiliyi37/oh-my-tianshu (Windows).
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
# Usage: irm <repo>/scripts/install.ps1 | iex
#
# Piped-through-iex scripts must never call `exit` — it closes the host
# window mid-run — so everything is function-wrapped and bails via `return`.

$Package = '@huiliyi37/oh-my-tianshu'
$OfficialRegistry = 'https://registry.npmjs.org'
$TencentRegistry = 'https://mirrors.cloud.tencent.com/npm'
$AllowScripts = 'koffi,node-pty,@huiliyi37/dsh-subprocess-local,@google/genai,protobufjs'
$RetryFlags = @('--fetch-retries=5', '--fetch-retry-mintimeout=10000')

function Log([string]$Message) { Write-Host "[oh-my-tianshu] $Message" }

# Best-effort removal of a partial install of our scope; a locked directory
# (Windows handles, antivirus) is reported but does not abort the install.
function Clean-Partial {
  $Root = (npm root -g 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $Root) { return }
  $ScopeDir = Join-Path "$Root".Trim() '@huiliyi37'
  if (Test-Path $ScopeDir) {
    try { Remove-Item -Recurse -Force $ScopeDir -ErrorAction Stop }
    catch { Log "could not remove a locked partial install: $ScopeDir (close editors/AV and retry)" }
  }
}

function Try-Registry([string]$Label, [string[]]$ExtraFlags) {
  & npm install -g @ExtraFlags $script:Flags $Package
  return ($LASTEXITCODE -eq 0)
}

function Main {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Log 'npm not found. Install Node.js (^22.19 || >=24) first: https://nodejs.org/'
    return
  }

  # npm >= 11 blocks not-allowlisted lifecycle scripts; older npm runs them by
  # default and rejects the unknown flag. `npm -v` may print extra lines on
  # some setups, so parse defensively and treat anything unparseable as old.
  $NpmVersion = ''
  foreach ($line in @(npm -v)) {
    $trimmed = "$line".Trim()
    if ($trimmed -match '^[0-9]+\.[0-9]+\.[0-9]+$') { $NpmVersion = $trimmed; break }
  }
  $NpmMajor = if ($NpmVersion -match '^([0-9]+)\.') { [int]$Matches[1] } else { 0 }
  $script:Flags = @()
  if ($NpmMajor -ge 11) { $script:Flags = @("--allow-scripts=$AllowScripts") }

  $Registry = "$(npm config get registry)".Trim()
  Log "registry: $Registry"

  if (Try-Registry 'configured' @()) {
    Log 'installed. Start with: oh-my-tianshu tui   (quit: Ctrl+Q or /exit)'
    return
  }

  Log 'install failed on the configured registry.'
  Log 'most likely a mirror sync window (entry package present, dependencies not yet).'
  Clean-Partial
  Log "retrying against the official registry ($OfficialRegistry)..."
  if (Try-Registry 'official' (@("--registry=$OfficialRegistry") + $RetryFlags)) {
    Log 'installed from the official registry. Start with: oh-my-tianshu tui'
    return
  }

  Log 'official registry attempt failed (often a network reset).'
  Clean-Partial
  Log "last retry against the Tencent mirror ($TencentRegistry)..."
  if (Try-Registry 'tencent' (@("--registry=$TencentRegistry") + $RetryFlags)) {
    Log 'installed from the Tencent mirror. Start with: oh-my-tianshu tui'
    return
  }

  Log 'all three attempts failed. Check Node version (^22.19 || >=24), network/proxy,'
  Log "and any locked files under: npm root -g"
}

Main
