/**
 * Doc-sync gate for package README Model Experience sections. It validates
 * audited package classifications, model/token/KV-cache fields, package-owned
 * text blocks, generated-catalog links, and final-section order. See the
 * [Model Experience Agent Note](../.agents/notes/implemented/process/2026-07-12-package-model-experience-contract.md).
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { markdownHeadingLines, markdownProseLines, type MarkdownProseLine } from './markdown.ts'

const root = resolve(import.meta.dirname, '..')
const HEADING = '## Model Experience'
const LIMITATIONS_HEADING = '## Known Limitations and Deferred Work'
const MODEL_VIEW_HEADING = '#### What the model sees'
const TOKEN_EFFECT_HEADING = '#### Token effect'
const KV_CACHE_EFFECT_HEADING = '#### KV Cache effect'
const FIELD_HEADINGS = [MODEL_VIEW_HEADING, TOKEN_EFFECT_HEADING, KV_CACHE_EFFECT_HEADING] as const

type SentenceKind = 'none' | 'indirect'

interface SentenceContract {
  kind: SentenceKind
  reason: string
}

/**
 * Generic packages whose public contract is model-agnostic. Their READMEs omit
 * Model Experience entirely; the reason stays here as reviewable audit evidence
 * so an absent section cannot be mistaken for forgotten documentation.
 */
const NO_MODEL_EXPERIENCE_SECTION: Readonly<Record<string, string>> = {
  'packages/core/scope': 'The package is a model-agnostic registration and lifecycle primitive; model-facing consumers own any context selection.',
  'packages/util/brand': 'The package is a type-only primitive erased at compile time.',
  'packages/util/paths': 'The package only resolves harness-owned host paths; model-facing consumers own any rendered use.',
  'packages/util/environment': 'The package only resolves host environment values; model-facing consumers own any rendered use.',
}

/**
 * Packages whose Model Experience is simple enough for one gated sentence plus
 * a KV-cache field. Every other package must carry canonical context-surface
 * blocks. A package moves on or off this list with its context behavior.
 */
const SENTENCE_MODEL_EXPERIENCE: Readonly<Record<string, SentenceContract>> = {
  'packages/bash/bash': { kind: 'indirect', reason: 'The service interface delegates all model rendering to dsh-tool-bash.' },
  'packages/bash/bash-env': { kind: 'indirect', reason: 'The env service surfaces managed DSH_* facts through the shell tools (dsh-tool-bash/dsh-tool-pwsh); it registers no prompt or schema of its own.' },
  'packages/bash/bash-local': { kind: 'indirect', reason: 'The executor backend delegates model rendering to dsh-tool-bash.' },
  'packages/bash/pwsh-local': { kind: 'indirect', reason: 'The executor backend delegates model rendering to dsh-tool-pwsh.' },
  'packages/code-runtime/code-runtime': { kind: 'indirect', reason: 'The service interface delegates model rendering to Code Mode in dsh-tools.' },
  'packages/code-runtime/code-runtime-worker': { kind: 'indirect', reason: 'The worker backend delegates model rendering to Code Mode in dsh-tools.' },
  'packages/core/agent-default-model': { kind: 'indirect', reason: 'The service supplies a ModelSelection; request assembly and adapters own the model-visible request.' },
  'packages/typert/registry': { kind: 'none', reason: 'Runtime type registry; consumers (cordis_inspect, wire faces, gates) own any model-visible projection of registry contents.' },
  'packages/typert/loader': { kind: 'none', reason: 'Loader integration only registers generated artifacts; consumers own any model-visible projection.' },
  'packages/e2b/e2b': { kind: 'none', reason: 'The shared remote-runtime owner registers no model context; provider adapters and consumers own rendered effects.' },
  'packages/client/hmr': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/modules': { kind: 'none', reason: 'Browser-side module-loading kernel machinery; registers no model surface.' },
  'packages/client/test-runtime': { kind: 'none', reason: 'Browser-side test infrastructure (jsdom bench); registers no model surface.' },
  'packages/client/ui-slots': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-primitives': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/web-react': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/schema-form': { kind: 'none', reason: 'Browser-side form-rendering library; registers no model surface.' },
  'packages/client/connection': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/api/remotes': { kind: 'none', reason: 'The Remote BFF selects business methods and identity policy; selected services own any model-visible effect.' },
  'packages/client/runtime': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-layout': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-sidebar': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-conversation': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-tool': { kind: 'none', reason: 'Browser-side Tool presentation layer; renders logged calls without changing model context.' },
  'packages/client/ui-deliverables': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-slash': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-command': { kind: 'indirect', reason: 'The dispatch paths trigger the host command.execute RPC; each command handler\'s host package owns any model-visible effect.' },
  'packages/client/ui-model': { kind: 'indirect', reason: 'Selection routes session.selectModel; the Host snapshots the selection at the next prompt-assembly boundary and owns the model-visible effect.' },
  'packages/client/ui-goal': { kind: 'indirect', reason: 'The strip verbs route goal.* mutations; the host GoalService owns the model-visible goal/change context message.' },
  'packages/client/ui-permission': { kind: 'indirect', reason: 'The picker submits the host /permission command; the knob events it appends own the model-visible effect through the sandbox/approval consumers.' },
  'packages/client/ui-plan': { kind: 'indirect', reason: 'The chip dispatches /plan off; dsh-plan-mode owns the model-visible policy, exit tool, and logged state.' },
  'packages/client/ui-question': { kind: 'indirect', reason: 'The package mounts dsh-tool-ask-user; that tool owns the model-visible schema and answer rendering.' },
  'packages/client/ui-trajectory': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-workspace': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-theme': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-settings': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-settings-general': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/ui-models': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/locale': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/client/web': { kind: 'none', reason: 'Browser-side UI plugin layer; registers no model surface.' },
  'packages/examples/agent-spine-demo': { kind: 'indirect', reason: 'The bundle only mounts model-facing child plugins.' },
  'packages/fs/fs': { kind: 'indirect', reason: 'The service interface delegates model rendering to dsh-tool-fs.' },
  'packages/git/git': { kind: 'indirect', reason: 'The service interface delegates all model rendering to dsh-tool-git.' },
  'packages/fs/fs-snapshot': { kind: 'none', reason: 'The pre-write snapshot hook copies files aside and delegates to next() unchanged; it registers no model surface.' },
  'packages/guard/agent-router': { kind: 'indirect', reason: 'Dispatch injects the routed task as the delegate session\'s ordinary user message; the router registers no prompt or tool surface of its own.' },
  'packages/tui/tui': { kind: 'none', reason: 'Terminal-side presentation layer; renders logged session events and forwards ordinary user input; registers no model surface.' },
  'packages/e2b/fs-e2b': { kind: 'indirect', reason: 'The provider backend delegates model rendering to dsh-tool-fs.' },
  'packages/fs/fs-local': { kind: 'indirect', reason: 'The provider backend delegates model rendering to dsh-tool-fs.' },
  'packages/hooks/hook-protocol': { kind: 'indirect', reason: 'Only the hook bridge plugins render decoded hook output to a model.' },
  'packages/host/apiproxy': { kind: 'none', reason: 'The wire contract and fetch carriers move already-composed messages and register no model surface.' },
  'packages/host/directory-picker': { kind: 'none', reason: 'The GUI-host picking seam registers no model surface.' },
  'packages/host/directory-picker-auto': { kind: 'none', reason: 'The GUI-host picking chooser only mounts a backend row; registers no model surface.' },
  'packages/host/directory-picker-browse': { kind: 'none', reason: 'The GUI-host picking backend registers no model surface.' },
  'packages/host/directory-picker-native': { kind: 'none', reason: 'The GUI-host picking backend registers no model surface.' },
  'packages/host/webserver': { kind: 'none', reason: 'The HTTP carrier bridges browser and API handler and registers no model surface.' },
  'packages/host/frontend-static': { kind: 'none', reason: 'The SPA dist server answers browser asset requests and registers no model surface.' },
  'packages/bundle/base': { kind: 'indirect', reason: 'The bundle is a patch-list carrier; each inserted row\'s package owns its model surface.' },
  'packages/bundle/headless': { kind: 'none', reason: 'The one-shot runner submits the task as an ordinary user message; prompts and tools belong to the composed base and headless bundles.' },
  'packages/llm/llm': { kind: 'none', reason: 'The adapter registry forwards already-assembled requests unchanged.' },
  'packages/llm/token-meter': { kind: 'indirect', reason: 'The measurement service leaves model-visible changes to its consumers.' },
  'packages/lsp/lsp': { kind: 'indirect', reason: 'The provider registry delegates model rendering to dsh-tool-lsp.' },
  'packages/lsp/lsp-local': { kind: 'indirect', reason: 'The provider backend delegates model rendering to dsh-tool-lsp.' },
  'packages/subprocess/subprocess': { kind: 'indirect', reason: 'The seam delegates all model rendering to consumer seams such as the bash executor family.' },
  'packages/e2b/subprocess-e2b': { kind: 'indirect', reason: 'The remote spawn backend delegates model rendering to consumer seams such as the bash executor family.' },
  'packages/subprocess/subprocess-local': { kind: 'indirect', reason: 'The spawn backend delegates model rendering to consumer seams such as the bash executor family.' },
  'packages/sandbox/sandbox-local': { kind: 'indirect', reason: 'The provider backend delegates model rendering to dsh-bash-sandbox and dsh-tool-bash.' },
  'packages/scaffold/create-sdk': { kind: 'indirect', reason: 'The initializer only writes project files; selected runtime plugins provide the generated project model surface.' },
  'packages/scaffold/helper': { kind: 'none', reason: 'The project domain edits files and registers no live agent or model surface.' },
  'packages/scaffold/scripts': { kind: 'indirect', reason: 'The launcher delegates model context to the loaded project plugin tree.' },
  'packages/scaffold/client': { kind: 'none', reason: 'Client-process library; the model surface lives in the spawned runtime\'s composed plugins.' },
  'packages/scaffold/protocol': { kind: 'none', reason: 'Client-facing wire library; the runtime plugins behind the serving entry own the model surface.' },
  'packages/scaffold/telemetry': { kind: 'none', reason: 'The launcher-side reporter sends developer-cycle telemetry and registers no live agent or model surface.' },
  'packages/session/session-projection': { kind: 'none', reason: 'The projection registry serves client-facing read models of already-logged session state and registers no model surface.' },
  'packages/session/session-projection-cache': { kind: 'none', reason: 'The persisted cache accelerates host-side cold reads of projection state and registers no model surface.' },
  'packages/session-query/session-query': { kind: 'none', reason: 'The trusted query service exposes cloned records only to callers and registers no model surface.' },
  'packages/session-query/session-query-sqlite': { kind: 'none', reason: 'The search backend returns hits only to callers and registers no model surface.' },
  'packages/settings/settings': { kind: 'indirect', reason: 'The seam stores and resolves user settings; consumer plugins own any model surface a value feeds.' },
  'packages/settings/settings-local': { kind: 'indirect', reason: 'The file provider stores and publishes namespace sections; consumers of ctx.settings own any model surface.' },
  'packages/credentials/credentials': { kind: 'indirect', reason: 'The seam resolves credential references; the consuming adapter owns every model surface a value authorizes.' },
  'packages/credentials/credentials-local': { kind: 'indirect', reason: 'The file/environment provider stores credential values; consumers of ctx.credentials own any model surface.' },
  'packages/util/atomic-write': { kind: 'none', reason: 'Pure filesystem write primitive; registers no model surface.' },
  'packages/session/session-telemetry': { kind: 'none', reason: 'The seam observes the session stream and hands redacted copies outward; it registers no model surface.' },
  'packages/session/session-telemetry-otel': { kind: 'none', reason: 'The backend forwards seam records into the OTel SDK pipeline and registers no model surface.' },
  'packages/skill/skill': { kind: 'indirect', reason: 'The provider registry delegates model rendering to dsh-tool-skill.' },
  'packages/skill/skill-badge': { kind: 'indirect', reason: 'The bundled provider delegates model rendering to dsh-tool-skill.' },
  'packages/skill/skill-local': { kind: 'indirect', reason: 'The provider backend delegates model rendering to dsh-tool-skill.' },
  'packages/spill/spill': { kind: 'indirect', reason: 'The storage seam delegates model rendering to spill consumers.' },
  'packages/spill/spill-local': { kind: 'indirect', reason: 'The storage backend delegates model rendering to spill consumers.' },
  'packages/subagent/subagent': { kind: 'indirect', reason: 'The provider registry delegates parent-model rendering to dsh-tool-subagent.' },
  'packages/support/acp-snapshot': { kind: 'none', reason: 'The test harness observes and normalizes transcripts without changing live requests.' },
  'packages/support/agent-loop-testkit': { kind: 'none', reason: 'The test helper mounts services but neither drives nor modifies model requests.' },
  'packages/support/invariants': { kind: 'none', reason: 'The observer validates requests but never rewrites their context.' },
  'packages/support/loader-smoke': { kind: 'none', reason: 'The test harness submits an ordinary user task but delegates prompt and tool composition to the loaded tree.' },
  'packages/support/llm-mock-server': { kind: 'none', reason: 'The test server substitutes provider wire behavior without invoking a real model.' },
  'packages/support/llm-replay': { kind: 'none', reason: 'The keyless adapter invokes no provider model.' },
  'packages/api/gateway': { kind: 'none', reason: 'Remote dispatch infrastructure; invoked business methods own any model-visible effect.' },
  'packages/typert/type-meta': { kind: 'none', reason: 'Compiler-independent Remote protocol declarations; registers no model surface.' },
  'packages/typert/generator': { kind: 'none', reason: 'The build-time generator runs outside any agent runtime and touches no model request.' },
  'packages/tasks/tasks': { kind: 'indirect', reason: 'Producer and control-surface plugins own all model rendering over the task registry.' },
  'packages/tasks/tasks-local': { kind: 'indirect', reason: 'The registry backend delegates model rendering to producer plugins and dsh-tool-tasks.' },
  'packages/examples/acp-demo': { kind: 'indirect', reason: 'The app bundle delegates request composition to dsh-agent-spine-demo and dsh-acp.' },
  'packages/boot/app-boot': { kind: 'indirect', reason: 'Only the loaded plugin tree contributes model context.' },
  'packages/examples/jsonrpc-demo': { kind: 'indirect', reason: 'Only the externally configured plugin tree contributes model context.' },
  'packages/interaction/permission': { kind: 'indirect', reason: 'The service writes mechanism events rendered by dsh-user-approval and dsh-tool-bash.' },
  'packages/interaction/user-interaction': { kind: 'indirect', reason: 'Model-facing consumers render provider answers and seam errors.' },
  'packages/util/timeout': { kind: 'indirect', reason: 'Only timeout consumers render timeout outcomes.' },
  'packages/util/retention': { kind: 'indirect', reason: 'Only retention consumers render retained content and omission metadata.' },
  'packages/util/native-command': { kind: 'none', reason: 'The host-side subprocess runner registers no model surface.' },
  'packages/web/web': { kind: 'indirect', reason: 'The provider registry delegates model rendering to dsh-tool-web.' },
  'packages/web/web-fetch-local': { kind: 'indirect', reason: 'The provider backend delegates model rendering to dsh-tool-web.' },
  'packages/web/web-search-exa': { kind: 'indirect', reason: 'The provider backend delegates model rendering to dsh-tool-web.' },
  'packages/workflow/workflow': { kind: 'indirect', reason: 'The service delegates parent and child model rendering to its consumer and engine.' },
}

interface Failure {
  path: string
  message: string
}

type Line = MarkdownProseLine

interface ContextSurface {
  heading: Line
  modelView: Line
  tokenEffect: Line
  kvCacheEffect: Line
  title: string
  modelViewVerbatimBlocks: number
  verbatimBlocks: number
}

interface ParsedField {
  value: Line
  verbatimBlocks: number
}

/** Validate H5-plus-markdown literals nested under one Model Experience field. */
function validateNestedVerbatim(raw: readonly string[], fragments: Set<string>): { blocks: number; error?: string } {
  let cursor = 0
  while (raw[cursor]?.trim().length === 0) cursor += 1
  if (cursor === raw.length) return { blocks: 0 }

  let blocks = 0
  while (true) {
    while (raw[cursor]?.trim().length === 0) cursor += 1
    if (cursor === raw.length) break
    if (!/^##### \S/.test(raw[cursor] ?? '')) {
      return { blocks, error: 'content after a field paragraph must be a titled H5 verbatim block' }
    }
    const title = (raw[cursor] as string).slice('##### '.length)
    const fragment = headingFragment(title)
    if (fragment.length === 0) return { blocks, error: 'verbatim H5 title must be non-empty' }
    if (fragments.has(fragment)) {
      return { blocks, error: `verbatim H5 title ${JSON.stringify(title)} is duplicated within its context surface` }
    }
    fragments.add(fragment)
    cursor += 1
    while (raw[cursor]?.trim().length === 0) cursor += 1
    if (raw[cursor] !== '```markdown') {
      return { blocks, error: 'each nested verbatim H5 requires an exact ```markdown fence' }
    }
    cursor += 1
    const contentStart = cursor
    while (cursor < raw.length && raw[cursor] !== '```') cursor += 1
    if (cursor === raw.length) return { blocks, error: 'unterminated nested ```markdown fence' }
    if (cursor === contentStart) return { blocks, error: 'nested ```markdown fence must not be empty' }
    cursor += 1
    blocks += 1
  }
  return { blocks }
}

/** GitHub-style fragment for the simple ASCII nested titles allowed by this contract. */
function headingFragment(title: string): string {
  return title.toLowerCase().replaceAll('`', '').replaceAll(/[^a-z0-9 _-]/g, '').trim().replaceAll(/\s+/g, '-')
}

/** A direct stable system-prompt contribution, as named by the README contract. */
function isDirectSystemPromptSurface(title: string): boolean {
  return /\bsystem prompt\b/i.test(title)
}

/** Anchored generated-catalog links in one model-view field. */
function toolCatalogLinkFragments(text: string): string[] {
  return [...text.matchAll(/\]\(\.\.\/\.\.\/\.\.\/docs\/tool-catalog\.md#([a-z0-9_-]+)\)/g)]
    .map(match => match[1] as string)
}

const toolCatalogFragments = new Set<string>()
for (const line of readFileSync(resolve(root, 'docs/tool-catalog.md'), 'utf8').split('\n')) {
  const title = /^## (.+)$/.exec(line)?.[1]
  if (title !== undefined) toolCatalogFragments.add(headingFragment(title))
}

const failures: Failure[] = []
const packageJsons = globSync('packages/*/*/package.json', { cwd: root }).map(path => path.split(sep).join('/')).sort()
const scannedPackages = new Set(packageJsons.map(path => path.slice(0, -'/package.json'.length)))
let structuredCount = 0
let contextSurfaceCount = 0
let omittedSectionCount = 0
let explainedNoneCount = 0
let indirectCount = 0
let verbatimBlockCount = 0
let systemPromptSurfaceCount = 0
let toolSchemaSurfaceCount = 0
let kvCacheEffectCount = 0

for (const [pkg, reason] of Object.entries(NO_MODEL_EXPERIENCE_SECTION)) {
  if (!scannedPackages.has(pkg)) {
    failures.push({ path: `${pkg}/README.md`, message: 'no-section allowlist entry does not name a scanned package' })
  }
  if (reason.trim().length === 0) {
    failures.push({ path: `${pkg}/README.md`, message: 'no-section allowlist entry must retain its audit justification' })
  }
  if (SENTENCE_MODEL_EXPERIENCE[pkg] !== undefined) {
    failures.push({ path: `${pkg}/README.md`, message: 'package cannot appear in both Model Experience allowlists' })
  }
}

for (const [pkg, contract] of Object.entries(SENTENCE_MODEL_EXPERIENCE)) {
  if (!scannedPackages.has(pkg)) {
    failures.push({ path: `${pkg}/README.md`, message: 'sentence allowlist entry does not name a scanned package' })
  }
  if (contract.reason.trim().length === 0) {
    failures.push({ path: `${pkg}/README.md`, message: 'sentence allowlist entry must justify why structured context surfaces are unnecessary' })
  }
}

for (const packageJson of packageJsons) {
  const pkg = packageJson.slice(0, -'/package.json'.length)
  const readme = packageJson.replace(/package\.json$/, 'README.md')
  const abs = resolve(root, readme)
  if (!existsSync(abs)) {
    failures.push({ path: readme, message: 'missing package README' })
    continue
  }

  const text = readFileSync(abs, 'utf8')
  const rawLines = text.split('\n')
  const lines = markdownProseLines(text)
  const headings = markdownHeadingLines(text)
  const h2Headings = headings.filter(heading => heading.depth === 2)
  const modelExperienceHeadings = headings.filter(heading => heading.text
    .trim().replaceAll(/\s+/g, ' ').toLowerCase() === 'model experience')
  const modelHeadings = modelExperienceHeadings.filter(heading => heading.depth === 2 && heading.raw === HEADING)
  if (NO_MODEL_EXPERIENCE_SECTION[pkg] !== undefined) {
    if (modelExperienceHeadings.length !== 0) {
      for (const heading of modelExperienceHeadings) {
        failures.push({ path: readme, message: `line ${heading.index}: audited model-agnostic package must omit every Model Experience heading; found ${JSON.stringify(heading.raw)}` })
      }
    } else {
      omittedSectionCount += 1
    }
    continue
  }
  const nonCanonicalModelHeading = modelExperienceHeadings.find(heading => heading.depth !== 2 || heading.raw !== HEADING)
  if (nonCanonicalModelHeading !== undefined) {
    failures.push({ path: readme, message: `line ${nonCanonicalModelHeading.index}: non-canonical Model Experience heading ${JSON.stringify(nonCanonicalModelHeading.raw)}; use exactly ${JSON.stringify(HEADING)}` })
    continue
  }
  const modelHeading = modelHeadings.at(0)
  if (modelHeading === undefined) {
    failures.push({
      path: readme,
      message: `missing ${HEADING}`,
    })
    continue
  }
  if (modelHeadings.length !== 1) {
    failures.push({ path: readme, message: `contains ${modelHeadings.length} copies of ${HEADING}` })
    continue
  }
  const modelH2Index = h2Headings.indexOf(modelHeading)
  const limitationsH2Index = h2Headings.findIndex(heading => heading.depth === 2 && heading.raw === LIMITATIONS_HEADING)
  if (limitationsH2Index >= 0) {
    if (modelH2Index !== h2Headings.length - 2 || limitationsH2Index !== h2Headings.length - 1) {
      failures.push({
        path: readme,
        message: `${HEADING} and ${LIMITATIONS_HEADING} must be the final two H2 sections, in that order`,
      })
      continue
    }
  } else if (modelH2Index !== h2Headings.length - 1) {
    failures.push({ path: readme, message: `${HEADING} must be the final H2 when ${LIMITATIONS_HEADING} is absent` })
    continue
  }

  const modelHeadingAt = lines.findIndex(line => line.index === modelHeading.index)
  const body = lines.slice(modelHeadingAt + 1)
  const h2Lines = new Set(h2Headings.map(heading => heading.index))
  const nextH2 = body.findIndex(line => h2Lines.has(line.index))
  const section = nextH2 < 0 ? body : body.slice(0, nextH2)
  const nextH2Line = nextH2 < 0 ? rawLines.length + 1 : (body[nextH2] as Line).index
  const rawSection = rawLines.slice(modelHeading.index, nextH2Line - 1)
  const content = section.filter(line => line.raw.trim().length > 0)
  const sentenceContract = SENTENCE_MODEL_EXPERIENCE[pkg]
  if (sentenceContract !== undefined) {
    const pattern = sentenceContract.kind === 'none' ? /^None, as .+\.$/ : /^Indirectly, through .+\.$/
    const rawContent = rawSection.filter(line => line.trim().length > 0)
    const sentence = content[0]
    const kvCacheHeading = content[1]
    const kvCacheEffect = content[2]
    if (content.length !== 3 || rawContent.length !== 3 || !pattern.test(sentence?.raw ?? '')) {
      const prefix = sentenceContract.kind === 'none' ? 'None, as ' : 'Indirectly, through '
      failures.push({ path: readme, message: `must contain exactly one sentence beginning ${JSON.stringify(prefix)} and ending with a period, followed by ${KV_CACHE_EFFECT_HEADING} and one non-empty paragraph` })
      continue
    }
    if (kvCacheHeading?.raw !== KV_CACHE_EFFECT_HEADING
      || kvCacheEffect === undefined
      || /^#{1,6} /.test(kvCacheEffect.raw)
      || kvCacheEffect.raw.trim().length === 0) {
      failures.push({ path: readme, message: `line ${kvCacheHeading?.index ?? sentence?.index ?? modelHeading.index}: short Model Experience form requires exact ${KV_CACHE_EFFECT_HEADING} and one non-empty paragraph` })
      continue
    }
    if (sentence === undefined
      || sentence.index !== modelHeading.index + 2
      || kvCacheHeading.index !== sentence.index + 2
      || kvCacheEffect.index !== kvCacheHeading.index + 2) {
      failures.push({ path: readme, message: 'short Model Experience sentence, KV-cache H4, and paragraph require one blank line between each element' })
      continue
    }
    if (sentenceContract.kind === 'none') explainedNoneCount += 1
    else indirectCount += 1
    kvCacheEffectCount += 1
    continue
  }

  const shortSentence = content.find(line => line.raw === 'None.' || /^None, as |^Indirectly, through /.test(line.raw))
  if (shortSentence !== undefined) {
    failures.push({ path: readme, message: `line ${shortSentence.index}: short Model Experience form requires an audited entry in SENTENCE_MODEL_EXPERIENCE` })
    continue
  }

  const surfaceStarts = content
    .map((line, index) => ({ line, index }))
    .filter(entry => /^### \S/.test(entry.line.raw))
  if (surfaceStarts.length === 0 || surfaceStarts[0]?.index !== 0) {
    failures.push({ path: readme, message: 'must contain one or more complete context-surface blocks' })
    continue
  }

  const surfaces: ContextSurface[] = []
  const surfaceFragments = new Set<string>()
  let surfaceError = false
  for (let surfaceIndex = 0; surfaceIndex < surfaceStarts.length; surfaceIndex += 1) {
    const start = surfaceStarts[surfaceIndex] as { line: Line; index: number }
    const end = surfaceStarts[surfaceIndex + 1]?.index ?? content.length
    const entries = content.slice(start.index, end)
    const heading = entries[0] as Line
    const title = heading.raw.slice('### '.length)
    const fragment = headingFragment(title)
    if (fragment.length === 0) {
      failures.push({ path: readme, message: `line ${heading.index}: each context surface requires a non-empty H3 heading` })
      surfaceError = true
      break
    }
    if (surfaceFragments.has(fragment)) {
      failures.push({ path: readme, message: `line ${heading.index}: duplicate context-surface link fragment ${JSON.stringify(fragment)}` })
      surfaceError = true
      break
    }
    const fieldStarts = entries
      .map((line, index) => ({ line, index }))
      .filter(entry => /^#### \S/.test(entry.line.raw))
    if (fieldStarts.length !== FIELD_HEADINGS.length || fieldStarts[0]?.index !== 1) {
      failures.push({ path: readme, message: `line ${heading.index}: context surface requires exactly three ordered H4 fields: ${FIELD_HEADINGS.join(', ')}` })
      surfaceError = true
      break
    }
    if ((surfaceIndex === 0 && heading.index !== modelHeading.index + 2)
      || rawLines[heading.index - 2]?.trim().length !== 0
      || fieldStarts[0].line.index !== heading.index + 2) {
      failures.push({ path: readme, message: `line ${heading.index}: context-surface heading and first field require one blank line between them` })
      surfaceError = true
      break
    }
    const parsedFields: ParsedField[] = []
    const verbatimFragments = new Set<string>()
    for (let fieldIndex = 0; fieldIndex < FIELD_HEADINGS.length; fieldIndex += 1) {
      const fieldStart = fieldStarts[fieldIndex] as { line: Line; index: number }
      const expectedHeading = FIELD_HEADINGS[fieldIndex] as string
      if (fieldStart.line.raw !== expectedHeading) {
        failures.push({ path: readme, message: `line ${fieldStart.line.index}: expected exact field heading ${JSON.stringify(expectedHeading)}, found ${JSON.stringify(fieldStart.line.raw)}` })
        surfaceError = true
        break
      }
      const fieldEnd = fieldStarts[fieldIndex + 1]?.index ?? entries.length
      const fieldEntries = entries.slice(fieldStart.index, fieldEnd)
      const value = fieldEntries[1]
      if (value === undefined || /^#{1,6} /.test(value.raw) || value.raw.trim().length === 0) {
        failures.push({ path: readme, message: `line ${fieldStart.line.index}: ${expectedHeading} requires one non-empty paragraph` })
        surfaceError = true
        break
      }
      if (value.index !== fieldStart.line.index + 2) {
        failures.push({ path: readme, message: `line ${fieldStart.line.index}: ${expectedHeading} and its paragraph require one blank line between them` })
        surfaceError = true
        break
      }
      const unexpected = fieldEntries.slice(2).find(line => !/^##### \S/.test(line.raw))
      if (unexpected !== undefined) {
        failures.push({ path: readme, message: `line ${unexpected.index}: content after ${expectedHeading} paragraph must be a titled H5 plus \`markdown\` fence owned by that field` })
        surfaceError = true
        break
      }
      const nextHeadingLine = fieldStarts[fieldIndex + 1]?.line.index
        ?? surfaceStarts[surfaceIndex + 1]?.line.index
        ?? nextH2Line
      if (rawLines[nextHeadingLine - 2]?.trim().length !== 0) {
        failures.push({ path: readme, message: `line ${nextHeadingLine}: Model Experience headings require a preceding blank line` })
        surfaceError = true
        break
      }
      const verbatim = validateNestedVerbatim(rawLines.slice(value.index, nextHeadingLine - 1), verbatimFragments)
      if (verbatim.error !== undefined) {
        failures.push({ path: readme, message: `line ${value.index}: ${verbatim.error}` })
        surfaceError = true
        break
      }
      if (fieldEntries.length - 2 !== verbatim.blocks) {
        failures.push({ path: readme, message: `line ${value.index}: every nested H5 must own exactly one \`markdown\` fence` })
        surfaceError = true
        break
      }
      parsedFields.push({ value, verbatimBlocks: verbatim.blocks })
    }
    if (surfaceError) break
    const modelViewField = parsedFields[0] as ParsedField
    const tokenEffectField = parsedFields[1] as ParsedField
    const kvCacheEffectField: ParsedField = parsedFields[2] as ParsedField
    const modelView = modelViewField.value
    const tokenEffect = tokenEffectField.value
    const kvCacheEffect = kvCacheEffectField.value
    if (/\]\(#[^)]+\)/.test(modelView.raw) || /\]\(#[^)]+\)/.test(tokenEffect.raw) || /\]\(#[^)]+\)/.test(kvCacheEffect.raw)) {
      failures.push({ path: readme, message: `line ${heading.index}: Model Experience fields must not link between local subsections; nest the H5 in its owning H4 field` })
      surfaceError = true
      break
    }
    surfaceFragments.add(fragment)
    surfaces.push({
      heading,
      modelView,
      tokenEffect,
      kvCacheEffect,
      title,
      modelViewVerbatimBlocks: modelViewField.verbatimBlocks,
      verbatimBlocks: parsedFields.reduce((total, field) => total + field.verbatimBlocks, 0),
    })
  }
  if (surfaceError) continue

  const promptWithoutVerbatim = surfaces.find(surface => isDirectSystemPromptSurface(surface.title)
    && surface.modelViewVerbatimBlocks === 0)
  if (promptWithoutVerbatim !== undefined) {
    failures.push({ path: readme, message: `line ${promptWithoutVerbatim.heading.index}: system-prompt surface must contain a titled H5 plus verbatim \`markdown\` block under ${MODEL_VIEW_HEADING}` })
    continue
  }
  const hasConcreteLiteral = surfaces.some(surface => surface.verbatimBlocks > 0
    || surface.modelView.raw.includes('`')
    || surface.tokenEffect.raw.includes('`')
    || toolCatalogLinkFragments(surface.modelView.raw).length > 0)
  if (!hasConcreteLiteral) {
    failures.push({ path: readme, message: 'structured Model Experience must ground at least one surface with inline code, a nested `markdown` block, or an anchored tool-catalog link' })
    continue
  }
  let catalogError = false
  for (const surface of surfaces) {
    if (!/\bschemas?\b/i.test(surface.title)) continue
    const fragments = toolCatalogLinkFragments(surface.modelView.raw)
    if (fragments.length === 0) {
      failures.push({ path: readme, message: `line ${surface.heading.index}: tool-schema surface must link an anchored section of ../../../docs/tool-catalog.md` })
      catalogError = true
      break
    }
    const invalid = fragments.find(fragment => !toolCatalogFragments.has(fragment))
    if (invalid !== undefined) {
      failures.push({ path: readme, message: `line ${surface.modelView.index}: tool-catalog link fragment ${JSON.stringify(invalid)} does not name an H2 section` })
      catalogError = true
      break
    }
  }
  if (catalogError) continue
  verbatimBlockCount += surfaces.reduce((total, surface) => total + surface.verbatimBlocks, 0)
  contextSurfaceCount += surfaces.length
  systemPromptSurfaceCount += surfaces.filter(surface => isDirectSystemPromptSurface(surface.title)).length
  toolSchemaSurfaceCount += surfaces.filter(surface => /\bschemas?\b/i.test(surface.title)).length
  kvCacheEffectCount += surfaces.length
  structuredCount += 1
}

if (failures.length === 0) {
  console.log(`verify-package-readme-model-experience: ${packageJsons.length} README(s) checked (${omittedSectionCount} audited omissions, ${structuredCount} structured, ${contextSurfaceCount} context surfaces, ${kvCacheEffectCount} KV-cache fields, ${systemPromptSurfaceCount} fenced system-prompt surfaces, ${toolSchemaSurfaceCount} catalog-linked tool-schema surfaces, ${explainedNoneCount} explained none, ${indirectCount} indirect, ${verbatimBlockCount} verbatim markdown blocks), all conform.`)
  process.exit(0)
}

console.error('verify-package-readme-model-experience failed:')
for (const failure of failures) {
  console.error(`  ${relative(root, resolve(root, failure.path))}: ${failure.message}`)
}
process.exit(1)
