/**
 * InputController — 输入状态管理器契约测试（Phase 6.3 Tab 补全状态机）。
 *
 * - tabComplete 首次 Tab：解析光标前 @ 路径 token 并应用首候选。
 * - 多候选：再次 Tab 在候选间循环（fileCompletion.idx 取模推进）。
 * - 唯一候选：应用后不进入循环（fileCompletion 置 null）。
 * - 无 @ token / 无候选：返回 null，Tab 保持原行为（状态不触碰）。
 * - 状态字段：slashCommands / inputHistory / ctrlCPendingSince / lastEscAt
 *   为 TuiApp 消费的输入状态（本控制器只持有，不改写语义）。
 *
 * 补全数据源走真实 git ls-files（与 completion.spec.ts 同构：临时 git 仓库）。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InputController } from '../src/engine/input-controller.js'

/** 临时目录登记表：afterEach 统一清理。 */
const tmpDirs: string[] = []
function gitDirWith(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-input-ctrl-'))
  tmpDirs.push(dir)
  for (const f of files) writeFileSync(join(dir, f), `// ${f}`)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['add', '.'], { cwd: dir })
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('tabComplete 首次 Tab（@ 路径补全）', () => {
  it('应用首候选并记录补全状态（多候选进入循环模式）', () => {
    const dir = gitDirWith(['src.ts', 'src-test.ts'])
    const ctrl = new InputController()
    const out = ctrl.tabComplete('open @src', 'open @src'.length, dir, 8, 10_000)
    expect(out).not.toBeNull()
    expect(out!.text).toBe('open @file:src.ts ')
    expect(ctrl.fileCompletion).not.toBeNull()
    expect(ctrl.fileCompletion!.candidates).toHaveLength(2)
    expect(ctrl.fileCompletion!.idx).toBe(0)
  })

  it('唯一候选应用后不进入循环模式（fileCompletion 置 null）', () => {
    const dir = gitDirWith(['only.ts'])
    const ctrl = new InputController()
    const out = ctrl.tabComplete('open @onl', 'open @onl'.length, dir, 8, 10_000)
    expect(out!.text).toBe('open @file:only.ts ')
    expect(ctrl.fileCompletion).toBeNull()
  })
})

describe('tabComplete 循环（再次 Tab）', () => {
  it('多候选时 idx 取模推进到下一候选', () => {
    const dir = gitDirWith(['src.ts', 'src-test.ts'])
    const ctrl = new InputController()
    ctrl.tabComplete('open @src', 'open @src'.length, dir, 8, 10_000)
    const out2 = ctrl.tabComplete('open @file:src.ts ', 'open @file:src.ts '.length, dir)
    expect(out2!.text).toBe('open @file:src-test.ts ')
    expect(ctrl.fileCompletion!.idx).toBe(1)
    // 再 Tab 回到首候选（取模绕回）
    const out3 = ctrl.tabComplete('open @file:src-test.ts ', 'open @file:src-test.ts '.length, dir)
    expect(out3!.text).toBe('open @file:src.ts ')
    expect(ctrl.fileCompletion!.idx).toBe(0)
  })
})

describe('tabComplete 无路径提示', () => {
  it('光标前无 @ token → null，不触碰状态', () => {
    const dir = gitDirWith(['src.ts'])
    const ctrl = new InputController()
    expect(ctrl.tabComplete('hello world', 11, dir)).toBeNull()
    expect(ctrl.tabComplete('/theme', 6, dir)).toBeNull()
    expect(ctrl.fileCompletion).toBeNull()
  })

  it('@ token 无候选 → null（不进入补全态）', () => {
    const dir = gitDirWith(['src.ts'])
    const ctrl = new InputController()
    expect(ctrl.tabComplete('open @zzz', 'open @zzz'.length, dir, 8, 10_000)).toBeNull()
    expect(ctrl.fileCompletion).toBeNull()
  })
})

describe('输入状态字段（W-B5 提取的 6 域）', () => {
  it('初始默认值：slash 列表空、历史空、双按窗口未激活', () => {
    const ctrl = new InputController()
    expect(ctrl.slashCommands).toEqual([])
    expect(ctrl.slashSelectedIdx).toBe(0)
    expect(ctrl.inputHistory).toEqual([])
    expect(ctrl.ctrlCPendingSince).toBe(0)
    expect(ctrl.lastEscAt).toBe(0)
  })

  it('可写入状态字段（TuiApp 装配层消费）', () => {
    const ctrl = new InputController()
    ctrl.slashCommands = [{ name: 'clear', description: '清空' }]
    ctrl.inputHistory = ['first', 'second']
    ctrl.ctrlCPendingSince = 123
    ctrl.lastEscAt = 456
    expect(ctrl.slashCommands[0]!.name).toBe('clear')
    expect(ctrl.inputHistory[0]).toBe('first')
    expect(ctrl.ctrlCPendingSince).toBe(123)
    expect(ctrl.lastEscAt).toBe(456)
  })
})

describe('slash 菜单状态机（refresh/move/scroll/close）', () => {
  function ctrlWith(): InputController {
    const ctrl = new InputController()
    ctrl.slashCommands = [
      { name: 'model', description: '切换模型', argsHint: '<name>' },
      { name: 'clear', description: '清空会话' },
      { name: 'theme', description: '切换主题' },
      { name: 'session', description: '会话管理' },
    ]
    return ctrl
  }

  it('非 / 输入 → 菜单关闭', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('hello')
    expect(ctrl.slashMenu.open).toBe(false)
    ctrl.refreshSlash('')
    expect(ctrl.slashMenu.open).toBe(false)
  })

  it('孤立 / → 全量命令列表打开', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/')
    expect(ctrl.slashMenu.open).toBe(true)
    expect(ctrl.slashMenu.matches).toHaveLength(4)
    expect(ctrl.slashMenu.query).toBe('')
  })

  it('前缀匹配优先 + 子串兜底，稳定排序', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/se')
    expect(ctrl.slashMenu.matches.map(m => m.name)).toEqual(['session'])
    ctrl.refreshSlash('/h')
    // 前缀无匹配 → 子串兜底（仅 theme 含 h）
    expect(ctrl.slashMenu.matches.map(m => m.name)).toEqual(['theme'])
  })

  it('无匹配 → 关闭', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/xyz')
    expect(ctrl.slashMenu.open).toBe(false)
    expect(ctrl.slashMenu.matches).toEqual([])
  })

  it('query 不变时 carry 保持选中；query 变化重置为 0', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/')
    ctrl.moveSlashSelection(2) // selected = 2（theme）
    ctrl.refreshSlash('/') // query 不变 → carry
    expect(ctrl.slashMenu.selected).toBe(2)
    ctrl.refreshSlash('/t') // query 变化 → 重置 0
    expect(ctrl.slashMenu.selected).toBe(0)
  })

  it('moveSlashSelection 环绕；菜单关闭时不动作', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/')
    ctrl.moveSlashSelection(1)
    expect(ctrl.slashMenu.selected).toBe(1)
    ctrl.moveSlashSelection(-2)
    expect(ctrl.slashMenu.selected).toBe(3) // 环绕：1-2+4=3
    ctrl.closeSlash()
    ctrl.moveSlashSelection(1)
    expect(ctrl.slashMenu.selected).toBe(3) // 不动作
  })

  it('scrollSlashSelection 两端 clamp 不环绕', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/')
    ctrl.scrollSlashSelection(-99)
    expect(ctrl.slashMenu.selected).toBe(0)
    ctrl.scrollSlashSelection(99)
    expect(ctrl.slashMenu.selected).toBe(3)
  })

  it('菜单关闭时 scroll/move 均不动作', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/')
    ctrl.closeSlash()
    ctrl.scrollSlashSelection(2)
    expect(ctrl.slashMenu.selected).toBe(0)
  })

  it('carry 时选中命令已不在新匹配中 → 回 0', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/')
    ctrl.moveSlashSelection(1) // 选中 clear
    ctrl.slashCommands = [{ name: 'only', description: 'x' }] // 命令列表变化
    ctrl.refreshSlash('/') // query 相同但 clear 不在新匹配
    expect(ctrl.slashMenu.selected).toBe(0)
  })

  it('closeSlash 置 open=false（matches 保留）', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/')
    ctrl.closeSlash()
    expect(ctrl.slashMenu.open).toBe(false)
    expect(ctrl.slashMenu.matches).toHaveLength(4)
  })
})

describe('slash MRU 排序（阶段 2）', () => {
  function ctrlWith(): InputController {
    const ctrl = new InputController()
    ctrl.slashCommands = [
      { name: 'model', description: '切换模型' },
      { name: 'clear', description: '清空会话' },
      { name: 'theme', description: '切换主题' },
      { name: 'session', description: '会话管理' },
    ]
    return ctrl
  }

  it('recordSlashUse：去重前移', () => {
    const ctrl = ctrlWith()
    ctrl.recordSlashUse('theme')
    ctrl.recordSlashUse('clear')
    ctrl.recordSlashUse('theme')
    expect(ctrl.slashMru).toEqual(['theme', 'clear'])
  })

  it('recordSlashUse：超上限截断尾部', () => {
    const ctrl = new InputController()
    for (let i = 0; i < 15; i++) ctrl.recordSlashUse(`c${i}`)
    expect(ctrl.slashMru).toHaveLength(10)
    expect(ctrl.slashMru[0]).toBe('c14')
    expect(ctrl.slashMru[9]).toBe('c5')
  })

  it('孤立 /：MRU 命中者排前，其余保持注册序', () => {
    const ctrl = ctrlWith()
    ctrl.recordSlashUse('session')
    ctrl.recordSlashUse('clear')
    ctrl.refreshSlash('/')
    expect(ctrl.slashMenu.matches.map(m => m.name)).toEqual(['clear', 'session', 'model', 'theme'])
  })

  it('前缀匹配组内 MRU 优先', () => {
    const ctrl = ctrlWith()
    ctrl.recordSlashUse('theme')
    ctrl.refreshSlash('/t')
    expect(ctrl.slashMenu.matches.map(m => m.name)).toEqual(['theme'])
  })
})

describe('slash 参数模式（阶段 2：完整命令名 + 尾空格）', () => {
  function ctrlWith(): InputController {
    const ctrl = new InputController()
    ctrl.slashCommands = [
      { name: 'theme', description: '切换主题', argsHint: '<name>' },
      { name: 'clear', description: '清空会话' },
    ]
    return ctrl
  }

  it('/cmd （带 argsHint）：菜单保持打开且只显示该命令', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/theme ')
    expect(ctrl.slashMenu.open).toBe(true)
    expect(ctrl.slashMenu.matches.map(m => m.name)).toEqual(['theme'])
    expect(ctrl.slashMenu.selected).toBe(0)
  })

  it('/cmd （无 argsHint）：不进入参数模式，按常规匹配', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/clear ')
    // 'clear ' 无匹配（尾空格）→ 关闭
    expect(ctrl.slashMenu.open).toBe(false)
  })

  it('非完整命令名 + 尾空格：不进入参数模式', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/the ')
    expect(ctrl.slashMenu.open).toBe(false)
  })

  it('参数模式后继续输入 → 常规匹配接管', () => {
    const ctrl = ctrlWith()
    ctrl.refreshSlash('/theme ')
    expect(ctrl.slashMenu.open).toBe(true)
    ctrl.refreshSlash('/theme x')
    // 'theme x' 无匹配 → 关闭
    expect(ctrl.slashMenu.open).toBe(false)
  })
})
