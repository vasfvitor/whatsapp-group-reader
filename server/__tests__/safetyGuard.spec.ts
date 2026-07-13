// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('WhatsApp read-only safety guard', () => {
  it('does not call known mutating whatsapp-web.js APIs', async () => {
    const source = await readFile(new URL('../whatsappService.ts', import.meta.url), 'utf8')
    const forbiddenCalls = [
      '.sendMessage(',
      '.sendSeen(',
      '.sendPresence',
      '.sendState',
      '.react(',
      '.downloadMedia(',
      '.logout(',
    ]

    for (const forbiddenCall of forbiddenCalls) expect(source).not.toContain(forbiddenCall)
  })
})
