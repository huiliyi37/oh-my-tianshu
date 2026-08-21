/**
 * key-dialog.spec.ts — DeepSeek API Key 设置对话框（/key；首启引导）。
 *
 * 覆盖：掩码函数（≤8 全 • / >8 只露末 4）、预检（服务缺席降级指引 /
 * writable=false 遮蔽说明）、提交三态流（probe ok 落盘成功态 + onSaved /
 * invalid 拒存回输入态 / unknown 确认态可强存可取消 / set 抛错回输入态带
 * message）、粘贴剥空白、probeDeepSeekKey 的状态码分类与凭据安全（key 只进
 * Authorization 头）。fetch 与 credentials 服务在外部边界打桩。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  KeyDialogController,
  maskKeyInput,
  probeDeepSeekKey,
  type KeyDialogCredentials,
  type KeyProbeResult,
} from '../src/ui/key-dialog.js'
import type { RivetTheme } from '../src/theme.js'

function fakeTheme(): RivetTheme {
  return {
    primary: '#111111', secondary: '#222222', success: '#333333',
    warning: '#444444', error: '#555555', dim: '#666666', muted: '#777777',
    pulseQuiet: '#888888', pulseActive: '#999999', pulseAlert: '#aaaaaa',
    userColor: '#bbbbbb', assistantColor: '#cccccc', systemColor: '#dddddd',
    brandColor: '#eeeeee', toolColor: () => '#000000', contextColor: () => '#000000',
  }
}

function plain(lines: readonly string[]): string[] {
  return lines.map(l => l.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ''))
}

/** 凭据面桩：describe/set 可断言；默认未配置但可写。 */
function makeCredentials(overrides: {
  describe?: KeyDialogCredentials['describe']
  set?: KeyDialogCredentials['set']
} = {}): KeyDialogCredentials & { describe: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } {
  return {
    describe: overrides.describe ?? vi.fn(async () => ({ configured: false, writable: true })),
    set: overrides.set ?? vi.fn(async () => {}),
  } as KeyDialogCredentials & { describe: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }
}

/** 装配对话框：probe 缺省立即 ok；返回 onSaved/onChange 计数桩。 */
function makeDialog(opts: {
  probe?: (key: string) => Promise<KeyProbeResult>
} = {}) {
  const onSaved = vi.fn()
  const onChange = vi.fn()
  const dialog = new KeyDialogController({
    getTheme: fakeTheme,
    probe: opts.probe ?? (async () => 'ok'),
    onSaved,
    onChange,
  })
  return { dialog, onSaved, onChange }
}

/** 逐字符键入（可打印字符 name 为 'unknown'，与 input-handler 一致）。 */
function type(dialog: KeyDialogController, text: string): void {
  for (const ch of text) dialog.handleKey('unknown', ch)
}

/** 异步状态翻转（probe/set 微任务链）落定。 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 10))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('maskKeyInput — 输入行掩码', () => {
  it('≤8 字符全显 •', () => {
    expect(maskKeyInput('')).toBe('')
    expect(maskKeyInput('sk')).toBe('••')
    expect(maskKeyInput('12345678')).toBe('••••••••')
  })

  it('>8 字符只露末 4 位明文', () => {
    expect(maskKeyInput('sk-testkey12345')).toBe('••••…2345')
    expect(maskKeyInput('123456789')).toBe('••••…6789')
  })
})

describe('KeyDialogController — 打开预检', () => {
  it('凭据服务缺席 → 降级指引态（环境变量路径），Enter 关闭', async () => {
    const { dialog } = makeDialog()
    await dialog.open(undefined)
    const text = plain(dialog.render(100, 24)).join('\n')
    expect(text).toContain('当前部署无凭据存储')
    expect(text).toContain('DEEPSEEK_API_KEY')
    dialog.handleKey('return', '')
    expect(dialog.wantsClose()).toBe(true)
  })

  it('writable=false（进程环境遮蔽）→ 说明态，不进入输入，set 不可达', async () => {
    const { dialog } = makeDialog()
    const credentials = makeCredentials({
      describe: vi.fn(async () => ({ configured: true, source: 'env', writable: false })),
    })
    await dialog.open(credentials)
    const text = plain(dialog.render(100, 24)).join('\n')
    expect(text).toContain('进程环境已提供 DEEPSEEK_API_KEY')
    expect(text).not.toContain('Key:')
    // 说明态只认关闭键：打字与 Enter 都不触发 set
    type(dialog, 'sk-shadowed')
    dialog.handleKey('return', '')
    expect(credentials.set).not.toHaveBeenCalled()
    expect(dialog.wantsClose()).toBe(true)
  })

  it('describe 抛错（面不匹配）→ 进入输入态（set 时才暴露真实错误）', async () => {
    const { dialog } = makeDialog()
    const credentials = makeCredentials({
      describe: vi.fn(async () => { throw new Error('bad facet') }),
    })
    await dialog.open(credentials)
    expect(plain(dialog.render(100, 24)).join('\n')).toContain('Key:')
    expect(dialog.wantsClose()).toBe(false)
  })
})

describe('KeyDialogController — 输入态编辑', () => {
  it('键入渲染掩码（>8 字符只露末 4），明文不泄漏到渲染帧', async () => {
    const { dialog } = makeDialog()
    await dialog.open(makeCredentials())
    type(dialog, 'sk-testkey12345')
    const text = plain(dialog.render(100, 24)).join('\n')
    expect(text).toContain('Key: ••••…2345')
    expect(text).not.toContain('sk-testkey12345')
  })

  it('退格删除末字符；Esc 请求关闭', async () => {
    const { dialog } = makeDialog()
    await dialog.open(makeCredentials())
    type(dialog, 'sk-ab')
    dialog.handleKey('backspace', '')
    expect(plain(dialog.render(100, 24)).join('\n')).toContain('Key: ••••')
    dialog.handleKey('escape', '')
    expect(dialog.wantsClose()).toBe(true)
  })

  it('空值 Enter 不提交（probe 不触发）', async () => {
    const probe = vi.fn(async () => 'ok' as const)
    const { dialog } = makeDialog({ probe })
    await dialog.open(makeCredentials())
    dialog.handleKey('return', '')
    await settle()
    expect(probe).not.toHaveBeenCalled()
  })

  it('pasteText 剥掉全部空白字符（粘贴来源带换行/空格）', async () => {
    const { dialog } = makeDialog()
    await dialog.open(makeCredentials())
    dialog.pasteText('  sk-test\nkey12345 \n')
    expect(plain(dialog.render(100, 24)).join('\n')).toContain('Key: ••••…2345')
  })
})

describe('KeyDialogController — 提交三态流', () => {
  it('probe ok → credentials.set 落盘 → 成功态 + onSaved 回调；Enter 关闭', async () => {
    const { dialog, onSaved } = makeDialog()
    const credentials = makeCredentials()
    await dialog.open(credentials)
    type(dialog, 'sk-testkey12345')
    dialog.handleKey('return', '')
    await settle()
    expect(credentials.set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-testkey12345')
    expect(onSaved).toHaveBeenCalledTimes(1)
    const text = plain(dialog.render(100, 24)).join('\n')
    expect(text).toContain('已保存并生效')
    expect(text).not.toContain('sk-testkey12345')
    expect(dialog.wantsClose()).toBe(false)
    dialog.handleKey('return', '')
    expect(dialog.wantsClose()).toBe(true)
  })

  it('probe invalid（401/403）→ 拒存回输入态带错误；改键后可重提交', async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce('invalid' as const)
      .mockResolvedValueOnce('ok' as const)
    const { dialog, onSaved } = makeDialog({ probe })
    const credentials = makeCredentials()
    await dialog.open(credentials)
    type(dialog, 'sk-badkey00000')
    dialog.handleKey('return', '')
    await settle()
    expect(credentials.set).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(plain(dialog.render(100, 24)).join('\n')).toContain('Key 无效（401/403）')
    // 回输入态：退格改键 + 重提交走新一轮探测
    dialog.handleKey('backspace', '')
    type(dialog, '9')
    dialog.handleKey('return', '')
    await settle()
    expect(probe).toHaveBeenCalledTimes(2)
    expect(credentials.set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-badkey00009')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('probe unknown（网络/超时）→ 确认态；Enter 仍要保存', async () => {
    const { dialog, onSaved } = makeDialog({ probe: async () => 'unknown' })
    const credentials = makeCredentials()
    await dialog.open(credentials)
    type(dialog, 'sk-testkey12345')
    dialog.handleKey('return', '')
    await settle()
    expect(credentials.set).not.toHaveBeenCalled()
    const text = plain(dialog.render(100, 24)).join('\n')
    expect(text).toContain('无法验证')
    expect(text).toContain('Enter 仍要保存 · Esc 取消')
    dialog.handleKey('return', '')
    await settle()
    expect(credentials.set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'sk-testkey12345')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('probe unknown → 确认态 Esc 取消（不落盘）', async () => {
    const { dialog } = makeDialog({ probe: async () => 'unknown' })
    const credentials = makeCredentials()
    await dialog.open(credentials)
    type(dialog, 'sk-testkey12345')
    dialog.handleKey('return', '')
    await settle()
    dialog.handleKey('escape', '')
    expect(dialog.wantsClose()).toBe(true)
    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('credentials.set 抛错（竞争遮蔽等）→ 回输入态显示其 message', async () => {
    const { dialog, onSaved } = makeDialog()
    const credentials = makeCredentials({
      set: vi.fn(async () => { throw new Error('shadowed by process env') }),
    })
    await dialog.open(credentials)
    type(dialog, 'sk-testkey12345')
    dialog.handleKey('return', '')
    await settle()
    expect(onSaved).not.toHaveBeenCalled()
    const text = plain(dialog.render(100, 24)).join('\n')
    expect(text).toContain('shadowed by process env')
    expect(text).toContain('Key:')
  })

  it('onDeactivate 后迟到的探测结果不再改状态（openFlag 守卫）', async () => {
    let resolveProbe: ((result: KeyProbeResult) => void) | undefined
    const { dialog, onSaved } = makeDialog({
      probe: () => new Promise<KeyProbeResult>((resolve) => { resolveProbe = resolve }),
    })
    const credentials = makeCredentials()
    await dialog.open(credentials)
    type(dialog, 'sk-testkey12345')
    dialog.handleKey('return', '')
    await settle()
    dialog.onDeactivate()
    resolveProbe?.('ok')
    await settle()
    expect(credentials.set).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('probeDeepSeekKey — 真实探测（fetch 外部边界打桩）', () => {
  it('2xx → ok；401/403 → invalid；其他状态码 → unknown；异常 → unknown', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await probeDeepSeekKey('k1')).toBe('ok')
    expect(await probeDeepSeekKey('k2')).toBe('invalid')
    expect(await probeDeepSeekKey('k3')).toBe('invalid')
    expect(await probeDeepSeekKey('k4')).toBe('unknown')
    expect(await probeDeepSeekKey('k5')).toBe('unknown')
  })

  it('key 只进 Authorization 头，不进 URL', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    // 宿主机可能设了 DEEPSEEK_BASE_URL（根 .env 分层）——固定缺省端点再断言
    vi.stubEnv('DEEPSEEK_BASE_URL', undefined)
    await probeDeepSeekKey('sk-secret-value')
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(url).not.toContain('sk-secret-value')
    expect(url).toBe('https://api.deepseek.com/models')
    expect(init.headers.Authorization).toBe('Bearer sk-secret-value')
  })

  it('DEEPSEEK_BASE_URL 覆盖端点（尾随斜杠归一）', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('DEEPSEEK_BASE_URL', 'https://proxy.example.com/')
    await probeDeepSeekKey('k')
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://proxy.example.com/models')
  })
})
