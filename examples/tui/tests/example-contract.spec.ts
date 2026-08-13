import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** examples/ 根目录（本文件位于 examples/tui/tests/）。 */
const examplesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('examples/tui example contract', () => {
  it('examples/package.json declares @huiliyi37/dsh-tui as workspace:*', () => {
    const pkg = JSON.parse(readFileSync(resolve(examplesRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.['@huiliyi37/dsh-tui']).toBe('workspace:*')
  })

  it('examples/tui/cordis.yml references the @huiliyi37/dsh-tui bundle', () => {
    const cordis = readFileSync(resolve(examplesRoot, 'tui', 'cordis.yml'), 'utf8')
    expect(cordis).toContain('@huiliyi37/dsh-tui')
  })

  it('examples/tui/README.md carries a minimal run instruction', () => {
    const readme = readFileSync(resolve(examplesRoot, 'tui', 'README.md'), 'utf8')
    expect(readme).toMatch(/DEEPSEEK_API_KEY/)
    expect(readme).toMatch(/tui-runner|dsh-tui|cordis\.yml/)
  })
})
