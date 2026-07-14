import type { AppConfig, Source } from './contracts.js'
import { normalizeFilterValue } from './sourceMatcher.js'

function sourceKey(source: Source): string {
  return `${source.type}:${normalizeFilterValue(source.value)}`
}

export function normalizeAppConfig(config: AppConfig): AppConfig {
  const sourceKeys = new Set<string>()
  const sources = config.sources.filter((source) => {
    const key = sourceKey(source)
    if (sourceKeys.has(key)) return false
    sourceKeys.add(key)
    return true
  })
  const chatTags = Object.fromEntries(
    Object.entries(config.chatTags)
      .map(([chatId, tags]) => [
        chatId,
        [...new Set(tags.map(normalizeFilterValue).filter(Boolean))],
      ])
      .filter(([, tags]) => (tags as string[]).length > 0),
  )
  return { ...config, sources, selectedChatIds: [...new Set(config.selectedChatIds)], chatTags }
}

export function isChatAuthorized(
  config: Pick<AppConfig, 'selectedChatIds'>,
  chatId: string,
): boolean {
  return config.selectedChatIds.includes(chatId)
}
