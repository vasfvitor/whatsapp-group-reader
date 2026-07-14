// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('WhatsApp read-only safety guard', () => {
  it('does not call known mutating whatsapp-web.js APIs', async () => {
    const serverDirectory = new URL('..', import.meta.url)
    const files = await readdir(serverDirectory, { recursive: true })
    const sources = await Promise.all(
      files
        .filter((file) => file.endsWith('.ts') && !file.includes('__tests__'))
        .map((file) => readFile(new URL(file.replaceAll(path.sep, '/'), serverDirectory), 'utf8')),
    )
    const source = sources.join('\n')
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
