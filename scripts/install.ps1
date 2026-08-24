# One-line installer for @huiliyi37/oh-my-tianshu (Windows).
#
# Auto-repairs the npm-mirror sync window: right after a release, mirrors such
# as npmmirror have the entry package but not every dependency yet, and a plain
# `npm i -g` then dies with ETARGET before any of our code exists on the
# machine. Resolution-time failures cannot be intercepted from inside a
# package, so the retry lives here: install with the user's configured
# registry first, and on failure retry once against the official registry —
# which always has the complete release.
#
# Usage: irm <repo>/scripts/install.ps1 | iex
#
# Piped-through-iex scripts must never call `exit` — it closes the host
# window mid-run — so everything is function-wrapped and bails via `return`.

$Package = '@huiliyi37/oh-my-tianshu'
$OfficialRegistry = 'https://registry.npmjs.org'
$AllowScripts = 'koffi,node-pty,@huiliyi37/dsh-subprocess-local,@google/genai,protobufjs'

function Log([string]$Message) { Write-Host "[oh-my-tianshu] $Message" }

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
  $Flags = @()
  if ($NpmMajor -ge 11) { $Flags = @("--allow-scripts=$AllowScripts") }

  $Registry = "$(npm config get registry)".Trim()
  Log "registry: $Registry"

  & npm install -g @Flags $Package
  if ($LASTEXITCODE -eq 0) {
    Log 'installed. Start with: oh-my-tianshu tui   (quit: Ctrl+Q or /exit)'
    return
  }

  Log 'install failed on the configured registry.'
  Log 'most likely a mirror sync window (entry package present, dependencies not yet).'
  Log "retrying once against the official registry ($OfficialRegistry)..."
  & npm install -g "--registry=$OfficialRegistry" @Flags $Package
  if ($LASTEXITCODE -eq 0) {
    Log 'installed from the official registry. Start with: oh-my-tianshu tui'
    return
  }

  Log 'both attempts failed. If the error is not ETARGET, check Node version (^22.19 || >=24) and network.'
}

Main
