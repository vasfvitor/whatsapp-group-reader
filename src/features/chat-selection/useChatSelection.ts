import { computed, shallowReadonly, shallowRef, type ShallowRef } from 'vue'
import type { AppConfig, ChatSummary, Source, SyncSettings } from '@shared/contracts'
import { matchingChatIds } from '@shared/sourceMatcher'
import { requestJson } from '@/shared/api/httpClient'
import type { RunOperation } from '@/app/applicationTypes'

export function useChatSelection(config: ShallowRef<AppConfig>, run: RunOperation) {
  const chats = shallowRef<ChatSummary[]>([])
  const refreshing = shallowRef(false)
  const selectedChats = computed(() =>
    chats.value.filter((chat) => config.value.selectedChatIds.includes(chat.id)),
  )
  async function refreshChats(force = false): Promise<void> {
    if (refreshing.value) return
    refreshing.value = true
    try {
      const result = await run(() =>
        requestJson<ChatSummary[]>(`/api/chats${force ? '?refresh=true' : ''}`),
      )
      if (result) chats.value = result
    } finally {
      refreshing.value = false
    }
  }
  function setSelectedChatIds(ids: string[]): void {
    config.value = { ...config.value, selectedChatIds: [...new Set(ids)] }
  }
  function setChatTags(chatTags: Record<string, string[]>): void {
    config.value = { ...config.value, chatTags }
    chats.value = chats.value.map((chat) => ({ ...chat, tags: chatTags[chat.id] ?? [] }))
  }
  function setSources(sources: Source[]): void {
    config.value = { ...config.value, sources }
  }
  function setSyncSettings(sync: SyncSettings): void {
    config.value = { ...config.value, sync }
  }
  function applySources(): number {
    const matches = matchingChatIds(chats.value, config.value.sources)
    setSelectedChatIds([...config.value.selectedChatIds, ...matches])
    return matches.length
  }
  return {
    chats: shallowReadonly(chats),
    refreshing: shallowReadonly(refreshing),
    selectedChats,
    refreshChats,
    setSelectedChatIds,
    setChatTags,
    setSources,
    setSyncSettings,
    applySources,
  }
}
