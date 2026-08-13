/** Assistant block classifier (moved here with sessions/conversation.ts). */

import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@huiliyi37/dsh-client-connection/client'
import { toAssistantBlock, toAssistantBlocks } from '../src/client/sessions/conversation.ts'

describe('toAssistantBlock', () => {
  it('classifies the four block shapes', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: '正文' },
      { type: 'reasoning', text: '思考' },
      { type: 'tool-call', id: 'c1', name: 'echo', arguments: '{}' } as ContentBlock,
      { type: 'image', data: 'x' } as unknown as ContentBlock,
    ]
    expect(toAssistantBlocks(blocks)).toEqual([
      { kind: 'text', text: '正文' },
      { kind: 'reasoning', text: '思考' },
      { kind: 'tool-call', callId: 'c1', name: 'echo', argsRaw: '{}' },
      { kind: 'other', block: blocks[3] },
    ])
    expect(toAssistantBlock(blocks[0] as ContentBlock)).toEqual({ kind: 'text', text: '正文' })
  })
})
