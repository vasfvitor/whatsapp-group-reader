import type { ChatSummary, Source } from './contracts.js'

export function normalizeFilterValue(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR')
}

export function matchesSource(chat: Pick<ChatSummary, 'name' | 'tags'>, source: Source): boolean {
  const value = normalizeFilterValue(source.value)
  if (!value) return false

  if (source.type === 'tag') {
    return chat.tags.some((tag) => normalizeFilterValue(tag) === value)
  }

  const name = normalizeFilterValue(chat.name)
  return source.type === 'exact' ? name === value : name.includes(value)
}

export function matchesAnySource(
  chat: Pick<ChatSummary, 'name' | 'tags'>,
  sources: Source[],
): boolean {
  return sources.some((source) => matchesSource(chat, source))
}

export function matchingChatIds(chats: ChatSummary[], sources: Source[]): string[] {
  if (sources.length === 0) return []
  return chats.filter((chat) => matchesAnySource(chat, sources)).map((chat) => chat.id)
}
