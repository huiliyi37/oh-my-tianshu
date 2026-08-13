import { describe, expect, it } from 'vitest'
import { SERVER_NAME_PATTERN as CLIENT_SERVER_NAME_PATTERN } from '@deepseek-ai/dsh-mcp-client'
import { SERVER_NAME_PATTERN, parseMcpDocument, resolveMcpServers } from '../src/mcp.ts'

describe('repository plugin common .mcp.json support', () => {
  it('validates server names with exactly the pattern the MCP client registry enforces', () => {
    // mcp.ts restates the pattern to keep the prepare bin's module graph
    // zod-only; this pin is the drift guard.
    expect(SERVER_NAME_PATTERN.source).toBe(CLIENT_SERVER_NAME_PATTERN.source)
    expect(SERVER_NAME_PATTERN.flags).toBe(CLIENT_SERVER_NAME_PATTERN.flags)
  })

  it('maps Expo-style HTTP servers to the existing Streamable HTTP client config', () => {
    const document = parseMcpDocument(JSON.stringify({
      mcpServers: {
        expo: { type: 'http', url: 'https://mcp.expo.dev/mcp' },
      },
    }))

    expect(resolveMcpServers(document, {}, '/plugin')).toEqual([{
      transport: 'streamable-http',
      serverName: 'expo',
      url: 'https://mcp.expo.dev/mcp',
      headers: {},
      failOnStartupError: true,
    }])
  })

  it('maps DataJunction-style stdio servers and expands exact environment placeholders', () => {
    const document = parseMcpDocument(JSON.stringify({
      mcpServers: {
        datajunction: {
          command: 'dj-mcp',
          args: ['--endpoint', '${DJ_API_URL}'],
          env: { DJ_API_URL: '${DJ_API_URL}' },
        },
      },
    }))

    expect(resolveMcpServers(document, { DJ_API_URL: 'http://localhost:8000' }, '/plugin')).toEqual([{
      transport: 'stdio',
      serverName: 'datajunction',
      command: 'dj-mcp',
      args: ['--endpoint', 'http://localhost:8000'],
      env: { DJ_API_URL: 'http://localhost:8000' },
      cwd: '/plugin',
      failOnStartupError: true,
    }])
  })

  it('fails loud when a declared environment value is absent', () => {
    const document = parseMcpDocument(JSON.stringify({
      mcpServers: { datajunction: { command: 'dj-mcp', env: { DJ_API_URL: '${DJ_API_URL}' } } },
    }))

    expect(() => resolveMcpServers(document, {}, '/plugin')).toThrow('missing environment variable DJ_API_URL')
  })

  it('accepts explicit stdio defaults and expands HTTP URLs and headers', () => {
    const document = parseMcpDocument(JSON.stringify({
      mcpServers: {
        local: { type: 'stdio', command: 'local-mcp' },
        remote: {
          type: 'http',
          url: 'http://${MCP_HOST}/mcp',
          headers: { Authorization: 'Bearer ${MCP_TOKEN}' },
        },
      },
    }))

    expect(resolveMcpServers(document, { MCP_HOST: 'localhost:3000', MCP_TOKEN: 'test-token' }, '/plugin')).toEqual([
      {
        transport: 'stdio',
        serverName: 'local',
        command: 'local-mcp',
        args: [],
        env: {},
        cwd: '/plugin',
        failOnStartupError: true,
      },
      {
        transport: 'streamable-http',
        serverName: 'remote',
        url: 'http://localhost:3000/mcp',
        headers: { Authorization: 'Bearer test-token' },
        failOnStartupError: true,
      },
    ])
  })

  it('rejects malformed JSON, server names, placeholders, and non-HTTP URLs', () => {
    expect(() => parseMcpDocument('{')).toThrow('expected JSON')
    expect(() => parseMcpDocument(JSON.stringify({
      mcpServers: { 'bad name': { command: 'server' } },
    }))).toThrow('server name')
    expect(() => parseMcpDocument(JSON.stringify({
      mcpServers: { bad: { command: '${BAD-NAME}' } },
    }))).toThrow('unsupported environment placeholder')
    expect(() => parseMcpDocument(JSON.stringify({
      mcpServers: { bad: { command: '${UNFINISHED' } },
    }))).toThrow('unterminated environment placeholder')
    const ftp = parseMcpDocument(JSON.stringify({
      mcpServers: { remote: { type: 'http', url: 'ftp://example.test/mcp' } },
    }))
    expect(() => resolveMcpServers(ftp, {}, '/plugin')).toThrow('must use http or https')
  })

  it('rejects Work IQ OAuth fields instead of treating them as unauthenticated HTTP', () => {
    expect(() => parseMcpDocument(JSON.stringify({
      mcpServers: {
        workiq: {
          type: 'http',
          url: 'https://workiq.microsoft.com/mcp',
          oauthClientId: 'client-id',
          oauthPublicClient: true,
          auth: { redirectPort: 3317 },
        },
      },
    }))).toThrow('invalid .mcp.json')
  })
})
