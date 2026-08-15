/**
 * LSP JSON-RPC 传输层（移植自天枢 src/lsp/rpc.ts 的测试语义；纯函数
 * 编解码 + 假流分发）。
 */

import { describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import {
  createRpcClient,
  decodeMessages,
  encodeMessage,
  type RpcClient,
} from '../src/lsp/rpc.js'

describe('encodeMessage / decodeMessages（Content-Length 帧）', () => {
  it('编码含 Content-Length 头（字节数非字符数）', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const wire = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(wire).toBe(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  })

  it('解码单条消息', () => {
    const msg = { jsonrpc: '2.0' as const, id: 1, result: { ok: true } }
    const { messages, rest } = decodeMessages(encodeMessage(msg))
    expect(messages).toEqual([msg])
    expect(rest).toBe('')
  })

  it('分块输入累积解码（半帧 + 跨块）', () => {
    const msg = { jsonrpc: '2.0' as const, id: 2, result: 42 }
    const wire = encodeMessage(msg)
    const mid = Math.floor(wire.length / 2)
    const first = decodeMessages(wire.slice(0, mid))
    expect(first.messages).toEqual([])
    expect(first.rest.length).toBeGreaterThan(0)
    const second = decodeMessages(first.rest + wire.slice(mid))
    expect(second.messages).toEqual([msg])
  })

  it('多帧拼接解码', () => {
    const a = { jsonrpc: '2.0' as const, id: 1, result: 'a' }
    const b = { jsonrpc: '2.0' as const, id: 2, result: 'b' }
    const { messages } = decodeMessages(encodeMessage(a) + encodeMessage(b))
    expect(messages).toEqual([a, b])
  })

  it('body 不完整时等待（rest 保留，不丢后续帧）', () => {
    const good = encodeMessage({ jsonrpc: '2.0' as const, id: 1, result: 'x' })
    // Content-Length 声明 999 字节但实际不足：保守等待更多数据（rest 含全部剩余）
    const partial = 'Content-Length: 999\r\n\r\n{broken'
    const { messages, rest } = decodeMessages(partial + good)
    expect(messages).toEqual([])
    expect(rest).toBe(partial + good)
  })
})

describe('createRpcClient（假流分发）', () => {
  function setup(): { client: RpcClient; serverIn: PassThrough; serverOut: PassThrough } {
    const serverIn = new PassThrough()
    const serverOut = new PassThrough()
    const client = createRpcClient(serverIn, serverOut)
    return { client, serverIn, serverOut }
  }

  it('request 发送编码请求并接收结果', async () => {
    const { client, serverIn, serverOut } = setup()
    const promise = client.request('initialize', { processId: 1 })
    // server 侧读到请求（帧解码）；PassThrough.read 返回 any——收窄后解码。
    const raw = serverOut.read() as Buffer | null
    const { messages } = decodeMessages(raw ?? Buffer.alloc(0))
    expect(messages[0]).toMatchObject({ method: 'initialize', params: { processId: 1 } })
    const id = (messages[0] as { id: number }).id
    // server 响应
    serverIn.write(encodeMessage({ jsonrpc: '2.0', id, result: { capabilities: {} } }))
    await expect(promise).resolves.toEqual({ capabilities: {} })
  })

  it('request 错误响应 reject', async () => {
    const { client, serverIn, serverOut } = setup()
    const promise = client.request('textDocument/diagnostic', { textDocument: { uri: 'file:///a.ts' } })
    const { messages } = decodeMessages((serverOut.read() as Buffer | null) ?? Buffer.alloc(0))
    const id = (messages[0] as { id: number }).id
    serverIn.write(encodeMessage({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } }))
    await expect(promise).rejects.toThrow('method not found')
  })

  it('notification 分发到注册处理器（publishDiagnostics 路径）', async () => {
    const { client, serverIn } = setup()
    const handler = vi.fn()
    client.onNotification('textDocument/publishDiagnostics', handler)
    serverIn.write(encodeMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///a.ts', diagnostics: [{ severity: 1 }] },
    }))
    expect(handler).toHaveBeenCalledWith({ uri: 'file:///a.ts', diagnostics: [{ severity: 1 }] })
  })

  it('notify 只写不等待', () => {
    const { client, serverOut } = setup()
    client.notify('initialized', {})
    const { messages } = decodeMessages((serverOut.read() as Buffer | null) ?? Buffer.alloc(0))
    expect(messages[0]).toMatchObject({ method: 'initialized' })
    expect(messages[0]).not.toHaveProperty('id')
  })

  it('dispose 清挂起与处理器', async () => {
    const { client, serverIn } = setup()
    const handler = vi.fn()
    client.onNotification('x', handler)
    client.dispose()
    serverIn.write(encodeMessage({ jsonrpc: '2.0', method: 'x', params: {} }))
    expect(handler).not.toHaveBeenCalled()
  })
})
