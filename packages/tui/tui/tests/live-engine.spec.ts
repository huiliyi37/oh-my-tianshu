/**
 * padDynamicRegion / nextDynamicBudget / liveMaxRowsFor / Working 封顶 —
 * 定高视口契约。
 *
 * 动态段垫高或截断到恰好 budget display rows：
 * - 不足 → 内容与 chrome 之间垫空行（内容贴上、输入框贴下）
 * - 超出 → 从顶部丢掉最旧行
 * - budget ≤ 0 且 pad（默认）→ 原样返回（欢迎首帧不垫）
 * - skipPad / pad:false → 按 Working 封顶裁动态段、不垫空行，chrome 不被挤出
 * 高水位只涨不缩，避免 live region 回缩留下输入框重影与屏底黑洞。
 * 空闲帧：snapshot+chrome key 未变且无 spinner 时跳过组装；overlay 停写仍是 A6。
 */

import { describe, expect, it } from 'vitest'
import type { WriteStream } from 'node:tty'
import {
  LiveEngine,
  liveHasSpinner,
  liveIdleKey,
  liveMaxRowsFor,
  nextDynamicBudget,
  padDynamicRegion,
  shouldSkipIdleAssemble,
  workingRowsCap,
  LIVE_TOOL_CARD_MAX,
  type LiveRegionLine,
} from '../src/engine/live-engine.js'

/** 记录 stdout 写入的 LiveEngine 替身终端。 */
function makeLiveStdout(): { stdout: WriteStream; writes: string[] } {
  const writes: string[] = []
  const stdout = {
    columns: 80,
    rows: 24,
    write: (chunk: string) => {
      writes.push(chunk)
      return true
    },
  } as unknown as WriteStream
  return { stdout, writes }
}

function L(...texts: string[]): LiveRegionLine[] {
  return texts.map(text => ({ text }))
}

describe('padDynamicRegion', () => {
  it('budget ≤ 0：原样返回', () => {
    const lines = L('a', 'b', 'chrome')
    expect(padDynamicRegion(lines, 2, 0)).toEqual({ lines, chromeStart: 2 })
    expect(padDynamicRegion(lines, 2, -1).lines).toEqual(lines)
  })

  it('动态段短于 budget：在内容与 chrome 之间垫空行到恰好 budget', () => {
    const { lines, chromeStart } = padDynamicRegion(L('think', '❯', 'foot'), 1, 4)
    expect(lines.map(l => l.text)).toEqual(['think', '', '', '', '❯', 'foot'])
    expect(chromeStart).toBe(4)
    expect(lines.slice(chromeStart).map(l => l.text)).toEqual(['❯', 'foot'])
  })

  it('动态段空：全部垫空行到 budget，chrome 贴尾', () => {
    const { lines, chromeStart } = padDynamicRegion(L('❯', 'foot'), 0, 3)
    expect(lines.map(l => l.text)).toEqual(['', '', '', '❯', 'foot'])
    expect(chromeStart).toBe(3)
  })

  it('动态段超过 budget：从顶部丢掉最旧行', () => {
    const { lines, chromeStart } = padDynamicRegion(
      L('old', 'mid', 'new', '❯', 'foot'),
      3,
      2,
    )
    expect(lines.map(l => l.text)).toEqual(['mid', 'new', '❯', 'foot'])
    expect(chromeStart).toBe(2)
  })

  it('恰好等于 budget：原样保留，无垫行无截断', () => {
    const { lines, chromeStart } = padDynamicRegion(L('think', 'tool', '❯'), 2, 2)
    expect(lines.map(l => l.text)).toEqual(['think', 'tool', '❯'])
    expect(chromeStart).toBe(2)
  })

  it('wrapping-aware：budget 按 display rows 计，短则垫齐', () => {
    const rowsForLine = (text: string) => (text === 'wide' ? 3 : 1)
    const { lines, chromeStart } = padDynamicRegion(
      L('wide', '❯'),
      1,
      5,
      rowsForLine,
    )
    expect(lines.map(l => l.text)).toEqual(['wide', '', '', '❯'])
    expect(chromeStart).toBe(3)
    const dynamicRows = lines.slice(0, chromeStart).reduce((n, l) => n + rowsForLine(l.text), 0)
    expect(dynamicRows).toBe(5)
  })

  it('超预算裁掉多 display-row 行后垫齐到恰好 budget', () => {
    const rowsForLine = (text: string) => (text === 'wide' ? 3 : 1)
    const { lines, chromeStart } = padDynamicRegion(
      L('wide', 'keep', '❯'),
      2,
      2,
      rowsForLine,
    )
    // drop wide (3 rows) → keep=1，垫 1 空行补到 2
    expect(lines.map(l => l.text)).toEqual(['keep', '', '❯'])
    expect(chromeStart).toBe(2)
  })

  it('pad:false：超 Working 封顶从顶裁，不垫空行，chrome 原样', () => {
    const working = Array.from({ length: 20 }, (_, i) => `w${i}`)
    const chrome = ['审批', '╭', '❯', '╰', 'foot']
    const { lines, chromeStart } = padDynamicRegion(
      L(...working, ...chrome),
      working.length,
      8,
      undefined,
      { pad: false },
    )
    expect(lines.slice(chromeStart).map(l => l.text)).toEqual(chrome)
    expect(chromeStart).toBe(8)
    expect(lines.map(l => l.text)).toEqual([...working.slice(-8), ...chrome])
  })

  it('pad:false 且 budget 0：丢掉全部动态段，只留 chrome', () => {
    const { lines, chromeStart } = padDynamicRegion(
      L('band', 'old', '╭', '❯'),
      2,
      0,
      undefined,
      { pad: false },
    )
    expect(lines.map(l => l.text)).toEqual(['╭', '❯'])
    expect(chromeStart).toBe(0)
  })

  it('24 行视口：满活动带不得把审批卡和输入轨裁掉', () => {
    const chrome = ['审批卡顶', '允许执行', '[y] 允许', '╭', '❯', '╰', 'footer']
    const working = Array.from({ length: 18 }, (_, i) => `activity-${i}`)
    const cap = workingRowsCap(24, chrome.length)
    expect(cap).toBe(liveMaxRowsFor(24) - chrome.length)
    const { lines, chromeStart } = padDynamicRegion(
      L(...working, ...chrome),
      working.length,
      cap,
      undefined,
      { pad: false },
    )
    expect(lines.slice(chromeStart).map(l => l.text)).toEqual(chrome)
    expect(chromeStart).toBe(cap)
    expect(lines.length).toBe(cap + chrome.length)
    expect(lines.length).toBeLessThanOrEqual(liveMaxRowsFor(24))
  })
})

describe('nextDynamicBudget', () => {
  it('skipPad：按 Working 封顶裁、不改高水位', () => {
    expect(nextDynamicBudget(4, 2, 10, true)).toEqual({ budget: 2, highWater: 4 })
    expect(nextDynamicBudget(4, 20, 8, true)).toEqual({ budget: 8, highWater: 4 })
  })

  it('ceiling ≤ 0：预算与高水位归零', () => {
    expect(nextDynamicBudget(8, 3, 0, false)).toEqual({ budget: 0, highWater: 0 })
  })

  it('只涨不缩：内容回落时保持高水位', () => {
    const grown = nextDynamicBudget(0, 6, 20, false)
    expect(grown).toEqual({ budget: 6, highWater: 6 })
    expect(nextDynamicBudget(grown.highWater, 1, 20, false)).toEqual({ budget: 6, highWater: 6 })
  })

  it('不超过 ceiling（含 resize 收缩）', () => {
    expect(nextDynamicBudget(12, 12, 8, false)).toEqual({ budget: 8, highWater: 8 })
  })

  it('freezeHighWater：本帧可加高，高水位不跟涨', () => {
    expect(nextDynamicBudget(6, 20, 28, false, true)).toEqual({ budget: 20, highWater: 6 })
  })

  it('freezeHighWater：ceiling 仍收缩高水位', () => {
    expect(nextDynamicBudget(12, 20, 8, false, true)).toEqual({ budget: 8, highWater: 8 })
  })
})

describe('liveMaxRowsFor', () => {
  it('高终端封顶 28，小终端 rows-1，下限 4，缺失回退 24-1', () => {
    expect(liveMaxRowsFor(50)).toBe(28)
    expect(liveMaxRowsFor(29)).toBe(28)
    expect(liveMaxRowsFor(20)).toBe(19)
    expect(liveMaxRowsFor(10)).toBe(9)
    expect(liveMaxRowsFor(4)).toBe(4)
    expect(liveMaxRowsFor(2)).toBe(4)
    expect(liveMaxRowsFor(0)).toBe(23)
  })
})

describe('LiveEngine suppressProbe 期间不写 stdout（overlay 引擎层闸）', () => {
  it('suppressProbe 后 render 不把主屏帧写进 stdout', () => {
    const { stdout, writes } = makeLiveStdout()
    const live = new LiveEngine({ stdout })
    live.render([{ text: 'hello' }])
    expect(writes.join('')).toContain('hello')
    writes.length = 0

    live.suppressProbe()
    live.render([{ text: 'ghost-into-alt' }])
    expect(writes).toHaveLength(0)
  })

  it('suppressProbe 后 clear / clearForCommit 不擦屏、不改主屏几何', () => {
    const { stdout, writes } = makeLiveStdout()
    const live = new LiveEngine({ stdout })
    live.render([{ text: 'hello' }])
    live.suppressProbe()
    writes.length = 0
    live.clear()
    live.clearForCommit()
    expect(writes).toHaveLength(0)

    live.resumeProbe()
    writes.length = 0
    live.render([{ text: 'hello' }])
    // 主屏 live 区仍是 overlay 进入前的帧：H2 短路，不得当空区再 append 一份。
    expect(writes).toHaveLength(0)
  })

  it('resumeProbe 后 render 恢复写屏', () => {
    const { stdout, writes } = makeLiveStdout()
    const live = new LiveEngine({ stdout })
    live.suppressProbe()
    live.render([{ text: 'hidden' }])
    expect(writes).toHaveLength(0)
    live.resumeProbe()
    live.render([{ text: 'after' }])
    expect(writes.join('')).toContain('after')
  })
})

describe('LIVE_TOOL_CARD_MAX', () => {
  it('live 区最多同时展开 3 张进行中工具卡', () => {
    expect(LIVE_TOOL_CARD_MAX).toBe(3)
  })
})

describe('workingRowsCap', () => {
  it('动态段上限 = liveMax − chrome，且不为负', () => {
    expect(workingRowsCap(24, 8)).toBe(15)
    expect(workingRowsCap(24, 30)).toBe(0)
    expect(workingRowsCap(50, 4)).toBe(24)
  })
})

describe('idle assemble skip', () => {
  it('snapshot+chrome key 未变且无 spinner → 跳过组装', () => {
    const key = liveIdleKey({ snapshotKey: 'snap-a', chromeKey: 'input' })
    expect(shouldSkipIdleAssemble({ prevKey: key, nextKey: key, hasSpinner: false })).toBe(true)
  })

  it('有 spinner 时即使 key 相同也不跳过（ticker 只给转圈行）', () => {
    const key = liveIdleKey({ snapshotKey: 'snap-a', chromeKey: 'input' })
    expect(shouldSkipIdleAssemble({ prevKey: key, nextKey: key, hasSpinner: true })).toBe(false)
  })

  it('key 变化必须组装', () => {
    expect(shouldSkipIdleAssemble({
      prevKey: liveIdleKey({ snapshotKey: 'a', chromeKey: 'x' }),
      nextKey: liveIdleKey({ snapshotKey: 'b', chromeKey: 'x' }),
      hasSpinner: false,
    })).toBe(false)
  })

  it('首帧 prevKey 为空不跳过', () => {
    expect(shouldSkipIdleAssemble({
      prevKey: null,
      nextKey: liveIdleKey({ snapshotKey: 'a', chromeKey: 'x' }),
      hasSpinner: false,
    })).toBe(false)
  })

  it('liveHasSpinner：任一转圈源为真即要 tick', () => {
    expect(liveHasSpinner({
      agentRunning: false,
      activityRunning: false,
      pendingTools: false,
      reasoningLive: false,
    })).toBe(false)
    expect(liveHasSpinner({
      agentRunning: false,
      activityRunning: true,
      pendingTools: false,
      reasoningLive: false,
    })).toBe(true)
  })
})

describe('LiveEngine CPR 污染判定（基线折算与几何变化守卫）', () => {
  /** 帧 1：输入 1 行（6 display rows；80 列终端上 caret 行 = 第 28 行 1-based）。 */
  const frame1 = (): LiveRegionLine[] => [
    { text: 'STATUS' }, { text: '' }, { text: '╭rail╮' },
    { text: '❯ ab', caretCol: 3 }, { text: '╰rail╯' }, { text: 'footer' },
  ]
  /** 帧 2：输入 Enter 增行为 2 逻辑行（7 display rows；caret 行 = 第 29 行 1-based）。 */
  const frame2 = (): LiveRegionLine[] => [
    { text: 'STATUS' }, { text: '' }, { text: '╭rail╮' },
    { text: '❯ ab' }, { text: '❯ █', caretCol: 2 }, { text: '╰rail╯' }, { text: 'footer' },
  ]

  it('基线建立：首个响应只记录不判污染', () => {
    const { stdout } = makeLiveStdout()
    let polluted = 0
    const live = new LiveEngine({ stdout, onProbeRequest: () => {}, onPolluted: () => { polluted++ } })
    live.render(frame1())
    live.requestProbe()
    live.noteCpr(28, 4) // 帧 1 caret 行（1-based 28）+ rowsUp(2) → 区域末行 30
    expect(polluted).toBe(0)
  })

  it('外部写入把光标推离驻停点 → 判污染并触发恢复重铺', () => {
    const { stdout, writes } = makeLiveStdout()
    let polluted = 0
    const live = new LiveEngine({ stdout, onProbeRequest: () => {}, onPolluted: () => { polluted++ } })
    live.render(frame1())
    live.requestProbe()
    live.noteCpr(28, 4) // 基线 {row: 30}
    live.render(frame1()) // 同帧（H2 短路，几何不变）
    live.requestProbe()
    live.noteCpr(29, 5) // 外来行把光标推下一行 → 区域末行 31 ≠ 30
    expect(polluted).toBe(1)
    // 污染后的下一次 render 走恢复重铺：回顶量按旧几何 + CPR 报告行双封顶
    const before = writes.length
    live.render(frame1())
    const rewrite = writes.slice(before).join('')
    expect(rewrite).toContain('STATUS')
  })

  it('打字列变（同行）：不判污染', () => {
    const { stdout } = makeLiveStdout()
    let polluted = 0
    const live = new LiveEngine({ stdout, onProbeRequest: () => {}, onPolluted: () => { polluted++ } })
    live.render(frame1())
    live.requestProbe()
    live.noteCpr(28, 4) // 基线
    live.render([{ text: 'STATUS' }, { text: '' }, { text: '╭rail╮' },
      { text: '❯ abc', caretCol: 4 }, { text: '╰rail╯' }, { text: 'footer' }])
    live.requestProbe()
    live.noteCpr(28, 5) // 同行、列变 → 只比行不比列
    expect(polluted).toBe(0)
  })

  it('输入增行（区域 display rows 变化）：作废基线，不误判污染', () => {
    const { stdout, writes } = makeLiveStdout()
    let polluted = 0
    const live = new LiveEngine({ stdout, onProbeRequest: () => {}, onPolluted: () => { polluted++ } })
    live.render(frame1())
    live.requestProbe()
    live.noteCpr(28, 4) // 基线 {row: 30}（帧 1 几何）
    live.render(frame2()) // 输入增行：区域 6 → 7 display rows，几何已变
    // 在途探针响应到达（反映帧 2 的 caret 位置）：旧基线折算会误判污染，
    // 修复后应因「总数变化 → 基线作废」而不判，且不触发恢复性全量重铺。
    const before = writes.length
    live.requestProbe()
    live.noteCpr(29, 3) // 帧 2 caret 行（1-based 29）+ rowsUp(2) → 31；基线已作废
    expect(polluted).toBe(0)
    live.render(frame2()) // 正常增量帧，不应出现恢复重铺特有的爬升+全擦序列
    const next = writes.slice(before).join('')
    expect(next).not.toContain('\x1b[0J') // ERASE_SCREEN_END 仅在恢复重铺/清屏出现
  })
})
