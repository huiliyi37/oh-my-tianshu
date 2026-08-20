/**
 * Task-card generator: pure functions that turn a first user message into a
 * structured task card. Two producers feed a single renderer:
 *
 * - `parseLlmCard` — a fixed markdown contract parsed from LLM output
 *   (`# title` / `## 目标` / `## 约束` / `## 验收`); returns `undefined` when
 *   the title or goal is missing, so the caller falls back to the template.
 * - `templateCard` — a zero-cost semantic fallback that derives a capped
 *   title from the first line and keeps the whole original as the goal.
 *
 * `renderTaskCard` always appends the verbatim original under
 * {@link ORIGINAL_MARKER}: the session log holds only the rewritten message
 * (agent-loop appends `decision.messages`), so the marker section is what
 * keeps the user's exact input reconstructable.
 *
 * @module @huiliyi37/dsh-task-card/generate
 */

/** Separator line between the structured card and the verbatim original. */
export const ORIGINAL_MARKER = '—— 原始请求 ——'

/** Default title budget for {@link templateCard} (inclusive, before the ellipsis). */
export const TITLE_MAX_DEFAULT = 40

/** The parsed structure of a task card. */
export interface TaskCard {
  /** One-line task title. */
  title: string
  /** Goal restatement (1-2 sentences; template mode keeps the original). */
  goal: string
  /** Constraints; empty when the card has none. */
  constraints: readonly string[]
  /** Acceptance criteria; empty when the card has none. */
  acceptance: readonly string[]
}

/**
 * Parse a card from LLM markdown output. The title and the `## 目标` section
 * are mandatory; `## 约束` and `## 验收` are optional. Any structural miss
 * returns `undefined` so the caller falls back to the template — a bad model
 * response must never ship a card without a goal.
 *
 * @param text - raw LLM output (already assembled from the stream).
 * @returns the parsed card, or `undefined` when the contract is not met.
 */
export function parseLlmCard(text: string): TaskCard | undefined {
  let title: string | undefined
  const sections = new Map<string, string[]>()
  let current: string | undefined
  for (const rawLine of text.split('\n')) {
    const titleMatch = /^#\s+(.+)$/u.exec(rawLine)
    if (titleMatch !== null && title === undefined) {
      const captured = titleMatch[1]
      if (captured !== undefined) {
        title = captured.trim()
        current = undefined
        continue
      }
    }
    const sectionMatch = /^##\s+(.+)$/u.exec(rawLine)
    if (sectionMatch !== null) {
      const captured = sectionMatch[1]
      if (captured !== undefined) {
        current = captured.trim()
        sections.set(current, [])
      }
      continue
    }
    if (current !== undefined) {
      const line = rawLine.trim()
      if (line !== '') sections.get(current)?.push(line)
    }
  }
  if (title === undefined || title === '') return undefined
  const goal = (sections.get('目标') ?? []).join('\n').trim()
  if (goal === '') return undefined
  const strip = (items: string[] | undefined): string[] => (items ?? [])
    .map(item => item.replace(/^-\s+/u, '').trim())
    .filter(item => item !== '')
  return {
    title,
    goal,
    constraints: strip(sections.get('约束')),
    acceptance: strip(sections.get('验收')),
  }
}

/**
 * Semantic-template fallback: a capped first-line title plus the whole
 * original as the goal. Zero cost, deterministic, always succeeds — the last
 * rung of the generation ladder (LLM → template → untouched is decided by the
 * caller, this function itself never fails).
 *
 * @param input - the user's first message text.
 * @param titleMax - inclusive title budget before the ellipsis.
 * @returns a card whose goal is the verbatim input.
 */
export function templateCard(input: string, titleMax: number = TITLE_MAX_DEFAULT): TaskCard {
  const firstLine = input.split('\n')[0] ?? ''
  const title = firstLine.length <= titleMax
    ? firstLine
    : `${firstLine.slice(0, titleMax)}…`
  return { title, goal: input, constraints: [], acceptance: [] }
}

/**
 * Render a card plus the verbatim original into the model-facing message
 * text. Empty optional sections are omitted; the original always follows
 * {@link ORIGINAL_MARKER}.
 *
 * @param card - parsed or templated card.
 * @param original - the user's exact original text (kept verbatim).
 * @returns the rewritten message text.
 */
export function renderTaskCard(card: TaskCard, original: string): string {
  const sections = [`# ${card.title}`, '', '## 目标', card.goal]
  if (card.constraints.length > 0) {
    sections.push('', '## 约束', ...card.constraints.map(item => `- ${item}`))
  }
  if (card.acceptance.length > 0) {
    sections.push('', '## 验收', ...card.acceptance.map(item => `- ${item}`))
  }
  sections.push('', ORIGINAL_MARKER, original)
  return sections.join('\n')
}

/**
 * Idempotence marker: whether a message text already carries a card (a `# `
 * title plus the original marker). Guards resume/fork paths against
 * double-rewriting.
 *
 * @param text - message text.
 * @returns whether the text already looks like a rendered card.
 */
export function hasTaskCard(text: string): boolean {
  return text.includes(ORIGINAL_MARKER) && /^#\s+.+$/mu.test(text)
}
