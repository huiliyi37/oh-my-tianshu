import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  projectCordisCatalog,
  renderInheritedPage,
  renderPageRegion,
} from '../src/cordis-catalog.ts'
import { CORDIS_CATALOG_POLICY, EVENT_SCOPE_PAGE, REGION_BEGIN, REGION_END, SERVICE_PAGE } from '../../../../scripts/gen-cordis-catalog.ts'

const workspaceRoot = resolve(import.meta.dirname, '../../../..')

describe('Typert-backed Cordis catalog', () => {
  it('reproduces every committed catalog artifact byte for byte', { timeout: 480_000 }, () => {
    const { projector, model } = projectCordisCatalog(workspaceRoot, CORDIS_CATALOG_POLICY)
    const expected = (path: string): string => { return readFileSync(join(workspaceRoot, path), 'utf8') }

    expect(renderInheritedPage(CORDIS_CATALOG_POLICY)).toBe(expected('docs/cordis-api/inherited.md'))
    for (const page of [...new Set([...Object.values(SERVICE_PAGE), ...Object.values(EVENT_SCOPE_PAGE)])].sort()) {
      const region = renderPageRegion(
        page,
        [...model.services].filter(s => SERVICE_PAGE[s.key] === page),
        [...model.events].filter(e => EVENT_SCOPE_PAGE[e.scope] === page),
        CORDIS_CATALOG_POLICY,
      )
      for (const side of [page, page.replace(/\.md$/, '.zh.md')]) {
        const committed = expected(`docs/subsystems/${side}`)
        const begin = committed.indexOf(REGION_BEGIN)
        const end = committed.indexOf(REGION_END)
        expect(begin, `docs/subsystems/${side} carries the region`).toBeGreaterThanOrEqual(0)
        expect(committed.slice(begin, end + REGION_END.length)).toBe(region)
      }
    }
    expect(projector.renderRuntimeApi(model)).toBe(
      expected('packages/self-modification/tool-cordis/src/api-catalog.ts'),
    )
  })
})
