/**
 * plugin-ecosystem.spec.ts — 生态边界警告（plugin reconcile 的防呆面）。
 *
 * 覆盖：foreignOfficialPeer 纯函数（@deepseek-ai/* peer 判定）与
 * warnIfForeignEcosystem 的集成行为（临时 profile + 假包解析 → stderr
 * 警告一次；本生态/解析失败 → 静默）。安装本身不阻断（fail-open）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProfileManifest } from '@huiliyi37/dsh-app-boot'
import { foreignOfficialPeer, warnIfForeignEcosystem } from '../src/plugin.ts'

const createdDirs: string[] = []

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 临时 profile 目录：package.json 锚点 + 可选已装假包。 */
function makeProfile(packages: Record<string, ProfileManifest> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'omts-eco-'))
  createdDirs.push(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-x', private: true }))
  for (const [name, manifest] of Object.entries(packages)) {
    const pkgDir = join(dir, 'node_modules', name)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(manifest))
  }
  return dir
}

describe('foreignOfficialPeer — @deepseek-ai/* peer 判定（纯函数）', () => {
  it('peerDependencies 含 @deepseek-ai/* → 返回首个命中', () => {
    const manifest = { peerDependencies: { '@huiliyi37/cordis': '^4.0.0', '@deepseek-ai/dsh-session': '^0.1.0' } } as ProfileManifest
    expect(foreignOfficialPeer(manifest)).toBe('@deepseek-ai/dsh-session')
  })

  it('无 peerDependencies / 空 / 仅本生态 → undefined', () => {
    expect(foreignOfficialPeer({} as ProfileManifest)).toBeUndefined()
    expect(foreignOfficialPeer({ peerDependencies: {} } as ProfileManifest)).toBeUndefined()
    expect(foreignOfficialPeer({ peerDependencies: { '@huiliyi37/cordis': '^4.0.0' } } as ProfileManifest)).toBeUndefined()
  })
})

describe('warnIfForeignEcosystem — 官方生态插件混装警告（fail-open）', () => {
  it('peers 指向 @deepseek-ai → stderr 警告一次，含包名与 peer 名', () => {
    const dir = makeProfile({
      'fake-official-plugin': {
        name: 'fake-official-plugin',
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.0' },
      } as ProfileManifest,
    })
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      warnIfForeignEcosystem('fake-official-plugin', dir)
      const out = err.mock.calls.map(c => String(c[0])).join('')
      expect(out).toContain('fake-official-plugin')
      expect(out).toContain('targets the official dsh ecosystem')
      expect(out).toContain('@deepseek-ai/cordis')
    } finally {
      err.mockRestore()
    }
  })

  it('本生态插件（@huiliyi37 peers）→ 无警告', () => {
    const dir = makeProfile({
      'fake-omts-plugin': {
        name: 'fake-omts-plugin',
        peerDependencies: { '@huiliyi37/cordis': '^4.0.0' },
      } as ProfileManifest,
    })
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      warnIfForeignEcosystem('fake-omts-plugin', dir)
      expect(err.mock.calls).toHaveLength(0)
    } finally {
      err.mockRestore()
    }
  })

  it('包不可解析 → 静默返回（bundle-less 警告路径另行覆盖）', () => {
    const dir = makeProfile()
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(() => warnIfForeignEcosystem('not-installed-anywhere', dir)).not.toThrow()
      expect(err.mock.calls).toHaveLength(0)
    } finally {
      err.mockRestore()
    }
  })
})
