/**
 * LSP 三件套装配不变量（dsh-tianshu-tui#54 回流，2026-08-27）。
 *
 * 仓内约定：@huiliyi37/* 相互依赖一律声明为 peerDependencies（宿主树自带
 * fork 全家桶）。代价是：作为独立插件装进「没有这套 fork 包」的外部 profile
 * 时（pnpm `autoInstallPeers: false`、npm `legacy-peer-deps` 均不自动补装
 * peer），任何一个未声明的值导入都会 ERR_MODULE_NOT_FOUND，整棵插件树加载
 * 失败——真实案例：dsh-tianshu-tui#54，三件套以 peers 装配进 tui profile
 * 即崩，靠消费方显式声明全部运行时依赖才解除。
 *
 * 本守卫钉死不变量：**src 下每个值导入的 @huiliyi37/* 裸包名，必须已声明在
 * 本包 peerDependencies（或 dependencies）中**。`import type` 为构建期擦除
 * 的类型导入，不计入。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PACKAGES = ['lsp', 'lsp-local', 'tool-lsp'] as const
const FAMILY_ROOT = join(import.meta.dirname, '..', '..')

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.ts')) yield full
  }
}

function bareHuiliyi37ValueImports(file: string): string[] {
  const code = readFileSync(file, 'utf8')
  const out = new Set<string>()
  // 值导入（排除 `import type` 开头的类型导入）；包名取 @scope/name 两段，
  // 深子路径（如 @huiliyi37/dsh-llm/types）归并到包名。
  for (const m of code.matchAll(
    /^\s*import\s+(?!type\b)(?:[\w$*\s{},]+\s+from\s+)?["'](@huiliyi37\/[^'"/]+)(?:\/[^"']*)?["']/gm,
  )) {
    out.add(m[1] as string)
  }
  for (const m of code.matchAll(/import\(\s*["'](@huiliyi37\/[^'"/]+)/g)) {
    out.add(m[1] as string)
  }
  return [...out]
}

describe('LSP 三件套装配不变量（#54 回流）', () => {
  for (const pkg of PACKAGES) {
    it(`${pkg}：值导入的 @huiliyi37/* 裸包全部已声明（peer ∪ dependencies）`, () => {
      const manifest = JSON.parse(readFileSync(join(FAMILY_ROOT, pkg, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
      }
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ])
      const undeclared = new Set<string>()
      for (const file of walk(join(FAMILY_ROOT, pkg, 'src'))) {
        for (const name of bareHuiliyi37ValueImports(file)) {
          if (!declared.has(name)) undeclared.add(name)
        }
      }
      expect(
        [...undeclared],
        `${pkg} 存在未声明 peer 的运行时导入——独立装配即 #54 同款整树失败`,
      ).toEqual([])
    })
  }
})
