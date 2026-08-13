import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SecretRedactor, buildTelemetryPayload } from '@huiliyi37/dsh-telemetry'

const dirs: Array<string> = []

async function projectDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-payload-'))
  dirs.push(dir)
  await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(dir, name), content, 'utf8')))
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('buildTelemetryPayload', () => {
  it('carries lifecycle facts and redacted file content', async () => {
    const dir = await projectDir({
      'cordis.yml': '- id: llm\n  name: \'@huiliyi37/dsh-llm-deepseek\'\n  config:\n    apiKey: sk-abcdefghij1234567890\n',
      'package.json': '{ "name": "my-app", "config": { "token": "sk-abcdefghij1234567890" } }',
    })
    const payload = await buildTelemetryPayload({ command: 'build', durationMs: 42, success: true, projectDir: dir })
    expect(payload.command).toBe('build')
    expect(payload.durationMs).toBe(42)
    expect(payload.success).toBe(true)
    expect(payload.cordisYmlContent).toContain('@huiliyi37/dsh-llm-deepseek') // package name preserved
    expect(payload.cordisYmlContent).not.toContain('sk-abcdefghij1234567890') // secret scrubbed
    expect(payload.packageJsonContent).toContain('my-app')
    expect(payload.packageJsonContent).not.toContain('sk-abcdefghij1234567890')
  })

  it('omits fields whose files do not exist', async () => {
    const dir = await projectDir({ 'cordis.yml': '- id: llm\n  name: \'@huiliyi37/dsh-llm-deepseek\'\n' })
    const payload = await buildTelemetryPayload({ command: 'create', durationMs: 1, success: false, projectDir: dir })
    expect(payload.cordisYmlContent).toBeDefined()
    expect('packageJsonContent' in payload).toBe(false)
  })

  it('omits both fields when neither file exists', async () => {
    const dir = await projectDir({})
    const payload = await buildTelemetryPayload({ command: 'create', durationMs: 0, success: true, projectDir: dir })
    expect('cordisYmlContent' in payload).toBe(false)
    expect('packageJsonContent' in payload).toBe(false)
  })

  it('withholds package.json when cordis.yml is absent (not an SDK project)', async () => {
    const dir = await projectDir({ 'package.json': '{ "name": "unrelated-repo" }' })
    const payload = await buildTelemetryPayload({ command: 'build', durationMs: 3, success: false, projectDir: dir })
    expect('cordisYmlContent' in payload).toBe(false)
    expect('packageJsonContent' in payload).toBe(false)
  })

  it('uses a supplied redactor', async () => {
    const dir = await projectDir({
      'cordis.yml': '- id: llm\n  name: \'@huiliyi37/dsh-llm-deepseek\'\n',
      'package.json': '{ "password": "hunter2" }',
    })
    const redactor = new SecretRedactor({ placeholder: '<<hidden>>' })
    const payload = await buildTelemetryPayload({
      command: 'config', durationMs: 5, success: true, projectDir: dir, redactor,
    })
    expect(payload.packageJsonContent).toContain('<<hidden>>')
    expect(payload.packageJsonContent).not.toContain('hunter2')
  })
})
