/** /doctor 原生依赖预检与审批卡键位折行的行为规格。 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { displayWidth } from '../src/width.js'
import {
  APPROVAL_KEY_HINTS,
  wrapApprovalHintRows,
} from '../src/format/approval-card.js'
import {
  collectNativeDependencyChecks,
  defaultNativeModuleProbe,
  DOCTOR_FIXES,
  getDoctorFixGuidance,
  NATIVE_DEPENDS_FIX_COMMAND,
  type NativeModuleProbe,
} from '../src/format/doctor-report.js'

describe('collectNativeDependencyChecks（P1② 原生依赖预检）', () => {
  it('全可加载：两项 ok、无 fixId', () => {
    const probe: NativeModuleProbe = () => 'ok'
    const checks = collectNativeDependencyChecks(probe)
    expect(checks).toHaveLength(2)
    for (const check of checks) {
      expect(check.status).toBe('ok')
      expect(check.fixId).toBeUndefined()
    }
  })

  it('node-pty 缺失：warn + fixId 3 指向 --allow-scripts 重装指引', () => {
    const probe: NativeModuleProbe = specifier => (specifier === 'node-pty' ? 'missing' : 'ok')
    const [koffi, pty] = collectNativeDependencyChecks(probe)
    expect(koffi?.status).toBe('ok')
    expect(pty?.status).toBe('warn')
    expect(pty?.fixId).toBe(3)
    expect(pty?.value).toContain('bash 终端执行器')
    const guidance = getDoctorFixGuidance(3)
    expect(guidance).toContain(NATIVE_DEPENDS_FIX_COMMAND)
    expect(DOCTOR_FIXES.some(fix => fix.id === 3)).toBe(true)
  })

  it('koffi 缺失：warn + fixId 3（与 node-pty 共用一条指引）', () => {
    const probe: NativeModuleProbe = specifier => (specifier === 'koffi' ? 'missing' : 'ok')
    const [koffi] = collectNativeDependencyChecks(probe)
    expect(koffi?.status).toBe('warn')
    expect(koffi?.fixId).toBe(3)
  })

  it('默认探针在开发环境可加载两个原生依赖（本仓安装了它们）', () => {
    expect(defaultNativeModuleProbe('node-pty')).toBe('ok')
    expect(defaultNativeModuleProbe('koffi')).toBe('ok')
  })

  it('默认探针在 plain Node（tsx ESM，非 vite 路径映射）下可加载 koffi / node-pty', async () => {
    const execFileAsync = promisify(execFile)
    const probeHref = pathToFileURL(fileURLToPath(new URL('../src/format/doctor-report.ts', import.meta.url))).href
    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx/esm',
      '--input-type=module',
      '--eval',
      `import { defaultNativeModuleProbe } from ${JSON.stringify(probeHref)};
       console.log(JSON.stringify({
         koffi: defaultNativeModuleProbe('koffi'),
         pty: defaultNativeModuleProbe('node-pty'),
       }));`,
    ], { cwd: fileURLToPath(new URL('../../../..', import.meta.url)) })
    expect(JSON.parse(stdout)).toEqual({ koffi: 'ok', pty: 'ok' })
  }, 20_000)
})

describe('wrapApprovalHintRows（审批卡键位折行）', () => {
  it('宽轨（100 列）：提示单行不折', () => {
    expect(wrapApprovalHintRows(APPROVAL_KEY_HINTS, 100)).toEqual([APPROVAL_KEY_HINTS])
  })

  it('窄轨（60 列）：段间折行且 [esc] 取消保持可见（不被截断）', () => {
    const rows = wrapApprovalHintRows(APPROVAL_KEY_HINTS, 60)
    expect(rows.length).toBeGreaterThan(1)
    const joined = rows.join('\n')
    for (const segment of ['[y] 允许', '[n] 拒绝', '[a] 本会话总是允许', '[p] 永久允许', '[esc] 取消']) {
      expect(joined).toContain(segment)
    }
    // 每个折行段都不超预算（60 列轨线内宽 56）。
    for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(56)
  })

  it('极窄轨（≤4 列）：原样返回单行，由轨线截断兜底', () => {
    expect(wrapApprovalHintRows(APPROVAL_KEY_HINTS, 3)).toEqual([APPROVAL_KEY_HINTS])
  })
})
