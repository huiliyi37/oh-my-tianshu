/**
 * Phase 6.2 中轮转向：/steer 解析 + 转向消息差异化渲染（RED 基线）。
 *
 * 覆盖两个纯函数：
 * - parseSlashCommand（ui/app.ts 导出）：/steer 与后续命令的最小前缀解析
 * - formatSteerMessage（format/steer-message.ts）：前缀/颜色区分 user 消息
 */

import { describe, expect, it } from 'vitest'
import { getTheme } from '../src/theme.js'
import { formatUserMessage } from '../src/format/user-message.js'
import { formatSteerMessage } from '../src/format/steer-message.js'
import { parseSlashCommand } from '../src/ui/app.js'

describe('parseSlashCommand — /steer 最小前缀解析', () => {
  it('解析 /steer <text>', () => {
    expect(parseSlashCommand('/steer 保持当前方向')).toEqual({ kind: 'steer', text: '保持当前方向' })
  })

  it('最小唯一前缀 /ste 同样解析', () => {
    // status 加入 BUILTIN_COMMAND_NAMES 后 /st 在 steer/status 间歧义（见下方歧义用例），
    // steer 的最小唯一前缀退化为 /ste。
    expect(parseSlashCommand('/ste 继续按方案')).toEqual({ kind: 'steer', text: '继续按方案' })
  })

  it('/steer 无文本返回空 text', () => {
    expect(parseSlashCommand('/steer')).toEqual({ kind: 'steer', text: '' })
  })

  it('/steer 尾随空格 trim 掉', () => {
    expect(parseSlashCommand('/steer  收敛  ')).toEqual({ kind: 'steer', text: '收敛' })
  })

  it('未知名命令返回 null', () => {
    expect(parseSlashCommand('/help')).toBeNull()
  })

  it('前缀歧义返回 null（不猜命令）', () => {
    // /s 在 session 与 steer 之间歧义；/st 在 steer 与 status 之间歧义。
    // 最小唯一前缀匹配不猜命令——两个输入都拒绝。
    expect(parseSlashCommand('/s')).toBeNull()
    expect(parseSlashCommand('/st 继续按方案')).toBeNull()
  })

  it('非斜杠输入返回 null', () => {
    expect(parseSlashCommand('hello')).toBeNull()
  })

  it('孤立斜杠返回 null', () => {
    expect(parseSlashCommand('/')).toBeNull()
  })
})

describe('formatSteerMessage — 转向消息差异化渲染', () => {
  it('单行：marker 前缀 + 正文', () => {
    const theme = getTheme()
    const lines = formatSteerMessage({ content: '收敛到最小方案', width: 80 }, theme)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/>>|➤/)
    expect(lines[0]).toContain('收敛到最小方案')
  })

  it('marker 与 user 消息前缀不同（区分说话人）', () => {
    const theme = getTheme()
    const steer = formatSteerMessage({ content: 'x', width: 80 }, theme).join('\n')
    const user = formatUserMessage({ content: 'x', width: 80 }, theme).join('\n')
    const steerMarker = steer.match(/>>|➤/)?.[0]
    const userMarker = user.match(/❯|▌/)?.[0]
    expect(steerMarker).toBeDefined()
    expect(userMarker).toBeDefined()
    expect(steerMarker).not.toBe(userMarker)
  })

  it('多行保持同导轨前缀', () => {
    const theme = getTheme()
    const lines = formatSteerMessage({ content: '第一行\n第二行', width: 80 }, theme)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('第一行')
    expect(lines[1]!).toContain('第二行')
  })

  it('空行只保留导轨', () => {
    const theme = getTheme()
    const lines = formatSteerMessage({ content: '首行\n\n尾行', width: 80 }, theme)
    expect(lines).toHaveLength(3)
    expect(lines[1]!).toMatch(/^.*>>|➤.*$/)
    expect(lines[1]!.trim().length).toBeLessThan(lines[0]!.length)
  })
})
