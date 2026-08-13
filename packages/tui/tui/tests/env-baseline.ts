/**
 * tui 包级测试环境基线 — 把逐 spec 手工 save/restore 的环境固定收敛成一处。
 *
 * 渲染核心的隐式探测读 process.env：width.ts 的 RIVET_AMBIGUOUS_WIDTH、
 * term-caps 的 RIVET_ASCII_UI 与 LANG/LC_ALL/LC_CTYPE（CJK locale 判定）。
 * 宿主机 locale（如 zh_CN）或残留覆盖会让探测结果换台机器就变，宽度/字形
 * 断言随之翻红。统一在 beforeEach 固定英文 UTF-8 基线、清掉两个 RIVET
 * 覆盖并重置探测缓存；afterEach 恢复宿主原值再重置缓存。需要非基线值的
 * 用例在测试体内自行覆盖（beforeEach 之后生效，afterEach 统一恢复）。
 */

import { afterEach, beforeEach } from 'vitest'
import { resetTermCapsCache } from '../src/term-caps.js'
import { resetWidthModeCache } from '../src/width.js'

/** 基线值：string 为固定值，undefined 为必须不存在。 */
const BASELINE: ReadonlyArray<readonly [key: string, value: string | undefined]> = [
  ['LANG', 'en_US.UTF-8'],
  ['LC_ALL', undefined],
  ['LC_CTYPE', undefined],
  ['RIVET_AMBIGUOUS_WIDTH', undefined],
  ['RIVET_ASCII_UI', undefined],
]

/**
 * 安装 tui 环境基线钩子。env 敏感的 spec 在模块顶层调用一次；钩子按注册
 * 顺序先于 spec 自己的 beforeEach 运行，spec 内的显式覆盖照常生效。
 */
export function pinTuiEnvBaseline(): void {
  let saved: Map<string, string | undefined> = new Map()
  beforeEach(() => {
    saved = new Map()
    for (const [key, value] of BASELINE) {
      saved.set(key, process.env[key])
      // oxlint no-dynamic-delete：Reflect.deleteProperty 等价删除动态键
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
    resetTermCapsCache()
    resetWidthModeCache()
  })
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
    resetTermCapsCache()
    resetWidthModeCache()
  })
}
