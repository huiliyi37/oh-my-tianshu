/**
 * Enforce intra-package domain layering inside `packages/client/*\/src/client/`.
 * verify-module-graph covers package-level edges; this gate covers the
 * directory level the future package split will land on: domain directories
 * may import `contract/` and never each other, and only the assembly point
 * (`apply.ts` / `index.ts`) may import across domains.
 *
 * Layer model (lower may not import higher):
 *   0  contract/            shared contract surface (types + slot declarations)
 *   1  <domain>/ + service  domain implementations (skeleton/, chat/, ...)
 *   2  apply.ts, index.ts   assembly point and re-export shell
 *
 * Not yet wired into the gate sequence (loose-gate window); run directly:
 *   pnpm exec tsx scripts/verify-client-domain-graph.ts
 */

import { globSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const CLIENT_DIR = join(root, 'packages/client')

/** Directory names treated as the shared contract layer (importable by all). */
const CONTRACT_DIRS = new Set(['contract'])
/** Top-level client files allowed to import across domains (assembly layer). */
const ASSEMBLY_FILES = new Set(['apply.ts', 'index.ts', 'index.tsx'])

interface Violation { file: string; imported: string; reason: string }

/**
 * Cross-domain imports that predate the public-snapshot enforcement, keyed as
 * `<file> -> <specifier>`. They are tolerated so the gate can hold the line on
 * new violations; shrink this list by routing shared surface through
 * contract/ — never add to it.
 */
const GRANDFATHERED = new Set([
  'runtime/src/client/contract/session-history.ts -> ../sessions/history.ts',
  'runtime/src/client/contract/session.ts -> ../sessions/conversation.ts',
  'runtime/src/client/contract/sessions.ts -> ../agents/scope.ts',
  'runtime/src/client/contract/sessions.ts -> ../sessions/manager.ts',
  'runtime/src/client/contract/sessions.ts -> ../sessions/service.ts',
  'runtime/src/client/contract/workspaces.ts -> ../workspaces/service.ts',
  'runtime/src/client/session-history/history-fold.ts -> ../sessions/conversation.ts',
  'runtime/src/client/session-history/history-fold.ts -> ../sessions/context-provenance.ts',
  'runtime/src/client/session-history/history-fold.ts -> ../sessions/steering-history.ts',
  'runtime/src/client/session-history/history-fold.ts -> ../sessions/conversation-context.ts',
  'runtime/src/client/session-history/history-fold.ts -> ../sessions/request-inspection.ts',
  'runtime/src/client/session-history/history-fold.ts -> ../sessions/partial.ts',
  'runtime/src/client/session-history/history-fold.ts -> ../sessions/assistant-timing.ts',
  'runtime/src/client/session-history/history-fold.ts -> ../sessions/tool-call-tree.ts',
  'runtime/src/client/session-history/source.ts -> ../sessions/history.ts',
  'runtime/src/client/session-history/source.ts -> ../sessions/notifier.ts',
  'runtime/src/client/session-history/source.ts -> ../sessions/partial.ts',
  'runtime/src/client/sessions/history.ts -> ../session-history/history-fold.ts',
  'runtime/src/client/sessions/service.ts -> ../agents/scope.ts',
  'runtime/src/client/workspaces/manager.ts -> ../sessions/notifier.ts',
  'runtime/src/client/workspaces/workspace.ts -> ../sessions/notifier.ts',
  'ui-conversation/src/client/contract/slots.ts -> ../input/blocks.ts',
  'ui-conversation/src/client/contract/slots.ts -> ../input/contract.ts',
  'ui-conversation/src/client/conversation-nodes/turn-tail.ts -> ../chat/turn-metrics.ts',
  'ui-conversation/src/client/input/hub.ts -> ../queue/store.ts',
  'ui-conversation/src/client/queue/store.ts -> ../input/contract.ts',
  'ui-conversation/src/client/service.ts -> ./input/blocks.ts',
  'ui-conversation/src/client/service.ts -> ./input/contract.ts',
  'ui-conversation/src/client/skeleton/ApprovalPanel.tsx -> ../chat/tool-node-reader.ts',
  'ui-conversation/src/client/skeleton/ContextMeter.tsx -> ../chat/StatsLine.tsx',
  'ui-conversation/src/client/skeleton/DetailsPanel.tsx -> ../chat/tool-node-reader.ts',
  'ui-conversation/src/client/skeleton/InputBar.tsx -> ../input/decorations.ts',
  'ui-slash/src/client/controller.ts -> ../core/detect.ts',
  'ui-slash/src/client/controller.ts -> ../core/menu.ts',
  'ui-slash/src/client/controller.ts -> ../core/contract.ts',
  'ui-slash/src/client/slots.ts -> ../core/contract.ts',
  'ui-workspace/src/client/WorkspaceBrowser.tsx -> ./rows/Rows.tsx',
])

/** Recursively list .ts/.tsx files under dir (relative paths). */
function listSources(dir: string): string[] {
  return globSync('**/*.{ts,tsx}', { cwd: dir })
    .map(rel => rel.split(sep).join('/'))
    .filter(rel => !/\.legacy\./.test(rel.slice(rel.lastIndexOf('/') + 1)))
    .sort()
}

/** First path segment of a client-relative file, or '' for top-level files. */
function domainOf(rel: string): string {
  const ix = rel.indexOf('/')
  return ix === -1 ? '' : rel.slice(0, ix)
}

function checkPackage(pkgName: string, clientDir: string): Violation[] {
  const violations: Violation[] = []
  const files = listSources(clientDir)
  for (const rel of files) {
    const fromDomain = domainOf(rel)
    const isAssembly = fromDomain === '' && ASSEMBLY_FILES.has(rel)
    if (isAssembly) continue
    const source = readFileSync(join(clientDir, rel), 'utf8')
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const spec = match[1]
      if (spec === undefined) continue
      // Resolve the relative specifier against the importing file's directory
      // to a client-dir-relative path.
      const fromDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
      const parts = (fromDir ? fromDir.split('/') : [])
      for (const seg of spec.split('/')) {
        if (seg === '.') continue
        if (seg === '..') parts.pop()
        else parts.push(seg)
      }
      const target = parts.join('/')
      if (target.startsWith('..')) continue // out of client dir (package root) — package-level rules govern
      const toDomain = domainOf(target)
      if (toDomain === '' || CONTRACT_DIRS.has(toDomain)) continue // top-level shared file or contract layer
      if (fromDomain === toDomain) continue // inside one domain
      if (GRANDFATHERED.has(`${pkgName}/src/client/${rel} -> ${spec}`)) continue
      violations.push({
        file: `${pkgName}/src/client/${rel}`,
        imported: spec,
        reason: fromDomain === ''
          ? `top-level non-assembly file imports domain "${toDomain}" (only apply/index may assemble)`
          : `domain "${fromDomain}" imports sibling domain "${toDomain}" (route shared surface through contract/)`,
      })
    }
  }
  return violations
}

const violations: Violation[] = []
for (const pkg of readdirSync(CLIENT_DIR)) {
  const clientDir = join(CLIENT_DIR, pkg, 'src/client')
  try {
    if (!statSync(clientDir).isDirectory()) continue
  } catch {
    // No client half in this package — nothing to layer-check.
    continue
  }
  violations.push(...checkPackage(pkg, clientDir))
}

if (violations.length > 0) {
  console.error(`verify-client-domain-graph: ${violations.length} violation(s):`)
  for (const v of violations) console.error(`  ${v.file} -> ${v.imported}\n    ${v.reason}`)
  process.exit(1)
}
console.log('verify-client-domain-graph: client domain layering clean.')
