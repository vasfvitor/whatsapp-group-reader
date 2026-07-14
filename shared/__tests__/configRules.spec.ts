import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../contracts.js'
import { isChatAuthorized, normalizeAppConfig } from '../configRules.js'

describe('configuration rules', () => {
  it('normalizes duplicate selections, sources and tags in one canonical place', () => {
    const normalized = normalizeAppConfig({
      ...createDefaultConfig(),
      selectedChatIds: ['one', 'one'],
      sources: [
        { type: 'exact', value: ' Equipe ' },
        { type: 'exact', value: 'equipe' },
      ],
      chatTags: { one: [' Urgente ', 'urgente', ''] },
    })

    expect(normalized.selectedChatIds).toEqual(['one'])
    expect(normalized.sources).toEqual([{ type: 'exact', value: ' Equipe ' }])
    expect(normalized.chatTags).toEqual({ one: ['urgente'] })
  })

  it('authorizes only explicitly selected chats', () => {
    expect(isChatAuthorized({ selectedChatIds: ['allowed'] }, 'allowed')).toBe(true)
    expect(isChatAuthorized({ selectedChatIds: ['allowed'] }, 'blocked')).toBe(false)
  })
})
