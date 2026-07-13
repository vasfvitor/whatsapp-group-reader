// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeMessage } from '../messageNormalizer.js'

const baseMessage = {
  id: 'message-id',
  body: 'Olá, mundo',
  type: 'chat',
  hasMedia: false,
  timestamp: 1_700_000_000,
}

describe('normalizeMessage', () => {
  it('normalizes plain text and trims outer whitespace', () => {
    expect(normalizeMessage({ ...baseMessage, body: '  Olá\n  ' })).toMatchObject({
      messageId: 'message-id',
      text: 'Olá',
      timestampUnix: 1_700_000_000,
    })
  })

  it('keeps a media caption without touching media contents', () => {
    expect(
      normalizeMessage({ ...baseMessage, type: 'image', hasMedia: true, body: 'Legenda' }),
    ).toMatchObject({ text: 'Legenda' })
  })

  it('ignores empty media and non-text system content', () => {
    expect(normalizeMessage({ ...baseMessage, type: 'image', hasMedia: true, body: '' })).toBeNull()
    expect(
      normalizeMessage({ ...baseMessage, type: 'group_notification', body: 'Entrou no grupo' }),
    ).toBeNull()
  })
})
