import { describe, expect, it } from 'vitest'
import { AttachmentId, ImageVariantId } from '@huiliyi37/dsh-attachment'
import {
  CallId,
  contentHasImage,
  createUserMessage,
  OFFLOADED_IMAGE_TEXT,
  offloadRequestImages,
  offloadRequestImagesWithPolicy,
  projectImagesForTextModel,
  requestImageHandleText,
  TEXT_ONLY_IMAGE_TEXT,
  textOnlyImageText,
} from '../src/index.ts'
import type { ContentBlock } from '../src/index.ts'

const source = { kind: 'plugin' as const, plugin: 'test' }

/** An image block whose data URL carries exactly `payload` base64 characters. */
function image(payload: number): ContentBlock {
  return { type: 'image', dataUrl: `data:image/png;base64,${'A'.repeat(payload)}` }
}

describe('contentHasImage', () => {
  it('walks nested tool-result content', () => {
    expect(contentHasImage([{ type: 'text', text: 'plain' }])).toBe(false)
    expect(contentHasImage([{
      type: 'tool-result',
      toolCallId: CallId('call'),
      content: [{
        type: 'tool-result',
        toolCallId: CallId('nested'),
        content: [image(4)],
      }],
    }])).toBe(true)
  })
})

describe('offloadRequestImages', () => {
  it('preserves every image when no payload bound is configured', () => {
    const messages = [createUserMessage({ content: [image(300)], source })]
    expect(offloadRequestImages(messages, undefined)).toBe(messages)
  })

  it('preserves the original request when its base64 payload fits exactly', () => {
    const messages = [createUserMessage({ content: [image(4), image(4)], source })]
    expect(offloadRequestImages(messages, 8)).toBe(messages)
  })

  it('keeps five 4 MiB payloads at 20 MiB and offloads the oldest after one more byte', () => {
    const payload = 4 * 1024 * 1024
    const maxRequestImageBytes = 20 * 1024 * 1024
    const exact = [createUserMessage({
      content: Array.from({ length: 5 }, () => image(payload)),
      source,
    })]
    expect(offloadRequestImages(exact, maxRequestImageBytes)).toBe(exact)

    const over = [createUserMessage({
      content: [image(payload + 1), ...Array.from({ length: 4 }, () => image(payload))],
      source,
    })]
    expect(offloadRequestImages(over, maxRequestImageBytes)[0]?.content).toEqual([
      { type: 'text', text: OFFLOADED_IMAGE_TEXT },
      ...Array.from({ length: 4 }, () => image(payload)),
    ])
  })

  it('replaces the oldest nested occurrences without mutating durable messages', () => {
    const shared = image(4)
    const messages = [
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('shot'),
          content: [shared],
        }],
        source,
      }),
      createUserMessage({ content: [shared, image(4)], source }),
    ]

    const fitted = offloadRequestImages(messages, 8)
    expect(fitted).not.toBe(messages)
    expect(fitted[0]?.content).toEqual([{
      type: 'tool-result',
      toolCallId: CallId('shot'),
      content: [{ type: 'text', text: OFFLOADED_IMAGE_TEXT }],
    }])
    expect(fitted[1]?.content).toEqual([shared, image(4)])
    expect(messages[0]?.content[0]).toMatchObject({ type: 'tool-result', content: [shared] })
  })

  it('replaces a single image that cannot fit', () => {
    const messages = [createUserMessage({ content: [image(300)], source })]
    expect(offloadRequestImages(messages, 8)[0]?.content)
      .toEqual([{ type: 'text', text: OFFLOADED_IMAGE_TEXT }])
  })

  it('keeps unchanged nested content while replacing a later image', () => {
    const nested = {
      type: 'tool-result' as const,
      toolCallId: CallId('text-only'),
      content: [{ type: 'text' as const, text: 'kept' }],
    }
    const messages = [createUserMessage({ content: [nested, image(4)], source })]
    expect(offloadRequestImages(messages, 1)[0]?.content).toEqual([
      nested,
      { type: 'text', text: OFFLOADED_IMAGE_TEXT },
    ])
  })
})

describe('offloadRequestImagesWithPolicy', () => {
  it('drops 129 MiB to 64 MiB and keeps the removed prefix stable through 192 MiB', () => {
    const mib = 1024 * 1024
    const project = (count: number) => offloadRequestImagesWithPolicy([
      createUserMessage({ content: Array.from({ length: count }, () => image(4)), source }),
    ], {
      representation: 'raw',
      maxBytes: 128 * mib,
      byteQuantum: 64 * mib,
      byteLength: () => mib,
    })[0]?.content

    expect(project(128)?.filter(block => block.type === 'image')).toHaveLength(128)
    expect(project(129)?.filter(block => block.type === 'text')).toHaveLength(65)
    expect(project(192)?.filter(block => block.type === 'text')).toHaveLength(65)
    expect(project(193)?.filter(block => block.type === 'text')).toHaveLength(129)
  })

  it('rounds a count excess up to a 20-image removal step', () => {
    const projected = offloadRequestImagesWithPolicy([
      createUserMessage({ content: Array.from({ length: 601 }, () => image(4)), source }),
    ], {
      representation: 'raw',
      maxImages: 600,
      countQuantum: 20,
    })
    expect(projected[0]?.content.filter(block => block.type === 'text')).toHaveLength(20)
    expect(projected[0]?.content.filter(block => block.type === 'image')).toHaveLength(581)
  })

  it('uses route-owned request byte lengths when supplied', () => {
    const messages = [createUserMessage({ content: [image(100), image(100)], source })]
    const projected = offloadRequestImagesWithPolicy(messages, {
      representation: 'raw',
      maxBytes: 3,
      byteLength: () => 2,
    })
    expect(projected[0]?.content).toEqual([
      { type: 'text', text: OFFLOADED_IMAGE_TEXT },
      image(100),
    ])
  })

  it('accounts decoded raw bytes of the inline payload when no length resolver applies', () => {
    const messages = [createUserMessage({ content: [image(8), image(8)], source })]
    const projected = offloadRequestImagesWithPolicy(messages, {
      representation: 'raw',
      maxBytes: 9,
    })
    expect(projected[0]?.content).toEqual([
      { type: 'text', text: OFFLOADED_IMAGE_TEXT },
      image(8),
    ])
  })
})

describe('projectImagesForTextModel', () => {
  it('returns image-free history unchanged', () => {
    const messages = [createUserMessage({ content: [{ type: 'text', text: 'plain' }], source })]
    expect(projectImagesForTextModel(messages)).toBe(messages)
  })

  it('replaces direct and nested images while retaining unaffected messages and blocks', () => {
    const plain = createUserMessage({ content: [{ type: 'text', text: 'plain' }], source })
    const nested = {
      type: 'tool-result' as const,
      toolCallId: CallId('nested-image'),
      content: [{ type: 'text' as const, text: 'before' }, image(4), { type: 'text' as const, text: 'after' }],
    }
    const unchangedNested = {
      type: 'tool-result' as const,
      toolCallId: CallId('text-only'),
      content: [{ type: 'text' as const, text: 'unchanged' }],
    }
    const visual = createUserMessage({
      content: [{ type: 'text', text: 'lead' }, image(4), unchangedNested, nested],
      source,
    })

    const projected = projectImagesForTextModel([plain, visual])
    expect(projected[0]).toBe(plain)
    expect(projected[1]?.content).toEqual([
      { type: 'text', text: 'lead' },
      { type: 'text', text: TEXT_ONLY_IMAGE_TEXT },
      unchangedNested,
      {
        ...nested,
        content: [
          { type: 'text', text: 'before' },
          { type: 'text', text: TEXT_ONLY_IMAGE_TEXT },
          { type: 'text', text: 'after' },
        ],
      },
    ])
  })
})

describe('request-image text helpers', () => {
  it('builds a stable text-only placeholder from a durable reference', () => {
    expect(TEXT_ONLY_IMAGE_TEXT).toBe('[image omitted because this model accepts text only]')
    expect(textOnlyImageText({
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: 'image/png',
      bytes: 3,
      width: 1,
      height: 1,
    })).toBe('[image omitted because this model accepts text only; attachment sha256:aaaaaaaa]')
  })

  it('names the complete attachment id and actual request dimensions', () => {
    expect(requestImageHandleText({
      variantId: ImageVariantId(`sha256:${'b'.repeat(64)}`),
      attachment: {
        attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
        mediaType: 'image/png',
        bytes: 3,
        width: 2,
        height: 1,
      },
      data: Uint8Array.of(1, 2, 3),
      mediaType: 'image/png',
      bytes: 3,
      width: 1130,
      height: 565,
      depth: 'uchar',
      space: 'srgb',
      hasAlpha: false,
    })).toBe(`Image sha256:${'a'.repeat(64)}; request image 1130x565px.`)
  })
})
