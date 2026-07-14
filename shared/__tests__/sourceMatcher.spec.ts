import { describe, expect, it } from 'vitest'
import type { ChatSummary } from '../contracts.js'
import { matchesSource, matchingChatIds } from '../sourceMatcher.js'

const chats: ChatSummary[] = [
  {
    id: 'one@g.us',
    name: 'Equipe Projeto',
    type: 'group',
    phoneNumber: null,
    isSavedContact: false,
    isBusiness: false,
    tags: ['resumir'],
    selected: false,
  },
  {
    id: 'two@g.us',
    name: 'Diretoria São Paulo',
    type: 'group',
    phoneNumber: null,
    isSavedContact: false,
    isBusiness: false,
    tags: ['liderança'],
    selected: false,
  },
  {
    id: 'three@c.us',
    name: 'Maria Diretoria',
    type: 'contact',
    phoneNumber: '5511999999999',
    isSavedContact: true,
    isBusiness: false,
    tags: ['Resumir'],
    selected: false,
  },
]

describe('sourceMatcher', () => {
  it('matches exact names without case sensitivity', () => {
    expect(matchesSource(chats[0]!, { type: 'exact', value: 'equipe projeto' })).toBe(true)
    expect(matchesSource(chats[1]!, { type: 'exact', value: 'diretoria' })).toBe(false)
  })

  it('matches partial names without case sensitivity', () => {
    const ids = matchingChatIds(chats, [{ type: 'contains', value: 'DIRETORIA' }])
    expect(ids).toEqual(['two@g.us', 'three@c.us'])
  })

  it('matches local tags without case sensitivity', () => {
    const ids = matchingChatIds(chats, [{ type: 'tag', value: 'RESUMIR' }])
    expect(ids).toEqual(['one@g.us', 'three@c.us'])
  })

  it('does not select anything without source rules', () => {
    expect(matchingChatIds(chats, [])).toEqual([])
  })
})
