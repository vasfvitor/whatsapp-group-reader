import { computed, type ShallowRef } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import type { AppConfig, ChatSummary, Source, SyncSettings } from '@shared/contracts'
import { matchingChatIds } from '@shared/sourceMatcher'
import { isChatAuthorized } from '@shared/configRules'
import { requestJson } from '@/shared/api/httpClient'
import type { RunOperation } from '@/app/applicationTypes'

export function useChatSelection(config: ShallowRef<AppConfig>, run: RunOperation) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['chats'],
    queryFn: () => requestJson<ChatSummary[]>('/api/chats'),
    enabled: false,
  })

  const chats = computed<ChatSummary[]>(() => query.data.value ?? [])
  const refreshing = computed(() => query.isFetching.value)
  const selectedChats = computed(() =>
    chats.value.filter((chat) => isChatAuthorized(config.value, chat.id)),
  )

  async function refreshChats(force = false): Promise<void> {
    // fetchQuery deduplicates concurrent refreshes on the same key.
    await run(() =>
      queryClient.fetchQuery({
        queryKey: ['chats'],
        queryFn: () => requestJson<ChatSummary[]>(`/api/chats${force ? '?refresh=true' : ''}`),
      }),
    )
  }
  function setSelectedChatIds(ids: string[]): void {
    config.value = { ...config.value, selectedChatIds: [...new Set(ids)] }
  }
  function setChatTags(chatTags: Record<string, string[]>): void {
    config.value = { ...config.value, chatTags }
    queryClient.setQueryData<ChatSummary[]>(['chats'], (current) =>
      current?.map((chat) => ({ ...chat, tags: chatTags[chat.id] ?? [] })),
    )
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
    chats,
    refreshing,
    selectedChats,
    refreshChats,
    setSelectedChatIds,
    setChatTags,
    setSources,
    setSyncSettings,
    applySources,
  }
}
