/**
 * prefs — 本地偏好持久化层单元测试。
 *
 * 覆盖：parse 容错（损坏/非对象/非法档位逐项丢弃）、read 缺失容错、
 * write 合并语义（本包未建模的 key 原样保留——与官方宿主插件共享
 * ~/.dsh-tui/prefs.json，整文件覆写会清掉对方设置）、prefsEnabled 测试密封门。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FOOTER_INFO_LEVELS,
  defaultPrefsPath,
  parsePrefs,
  prefsEnabled,
  readPrefs,
  writePrefs,
} from '../src/prefs.js'

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** 每例一个独立 tmp 目录（真实 FS；writePrefs 走 tmp+rename 需要同目录原子性）。 */
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'dsh-tui-prefs-'))
  dirs.push(d)
  return d
}

describe('parsePrefs — 容错解析', () => {
  it('合法 footerInfo 原样保留', () => {
    expect(parsePrefs('{"footerInfo":"compact"}')).toEqual({ footerInfo: 'compact' })
  })

  it('非法档位 / 非字符串丢弃', () => {
    expect(parsePrefs('{"footerInfo":"mega"}')).toEqual({})
    expect(parsePrefs('{"footerInfo":2}')).toEqual({})
  })

  it('损坏 JSON / 非对象根 → 空偏好，永不抛', () => {
    expect(parsePrefs('{broken')).toEqual({})
    expect(parsePrefs('[1]')).toEqual({})
    expect(parsePrefs('"s"')).toEqual({})
  })

  it('未知 key 不进建模结果（合并写路径负责原样保留）', () => {
    expect(parsePrefs('{"theme":"cobalt","notifyOs":true}')).toEqual({})
  })
})

describe('readPrefs / writePrefs — 文件层', () => {
  it('缺失文件读为空偏好', () => {
    expect(readPrefs(join(tempDir(), 'absent.json'))).toEqual({})
  })

  it('合并写：覆盖建模 key，保留官方宿主插件的未知 key', () => {
    const path = join(tempDir(), 'prefs.json')
    // 对方工具（dsh-tianshu-tui）写入的本包不建模 key
    writeFileSync(path, '{"theme":"cobalt","notifyOs":false,"preset":"standard"}\n')
    writePrefs(path, { footerInfo: 'compact' })
    const merged = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    expect(merged.footerInfo).toBe('compact')
    expect(merged.theme).toBe('cobalt')
    expect(merged.notifyOs).toBe(false)
    expect(merged.preset).toBe('standard')
  })

  it('显式 undefined 清除建模 key 且不动他人 key', () => {
    const path = join(tempDir(), 'prefs.json')
    writePrefs(path, { footerInfo: 'off' })
    writePrefs(path, {})
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({})
  })

  it('损坏基线：从空对象起步覆盖，不继承垃圾文本', () => {
    const path = join(tempDir(), 'prefs.json')
    writeFileSync(path, '{not json')
    writePrefs(path, { footerInfo: 'full' })
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ footerInfo: 'full' })
  })
})

describe('prefsEnabled — 测试密封门', () => {
  const savedEnv = { ...process.env }

  afterEach(() => {
    process.env.VITEST = savedEnv.VITEST
  })

  it('显式路径优先（含显式 null 禁用）', () => {
    expect(prefsEnabled('/tmp/x.json')).toBe('/tmp/x.json')
    expect(prefsEnabled(null)).toBeNull()
  })

  it('VITEST 环境 → 禁用（不落真实 home）', () => {
    process.env.VITEST = '1'
    expect(prefsEnabled(undefined)).toBeNull()
  })

  it('生产环境 → ~/.dsh-tui/prefs.json', () => {
    delete process.env.VITEST
    expect(prefsEnabled(undefined)).toBe(defaultPrefsPath())
    expect(defaultPrefsPath()).toContain('.dsh-tui')
  })

  it('FOOTER_INFO_LEVELS 封闭档位集', () => {
    expect([...FOOTER_INFO_LEVELS]).toEqual(['full', 'compact', 'off'])
  })
})
