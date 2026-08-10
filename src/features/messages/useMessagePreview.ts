import { computed, shallowRef } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import type { MessagePreviewResponse, MessageRecord } from '@shared/contracts'
import { requestJson } from '@/shared/api/httpClient'

export function useMessagePreview() {
  const queryClient = useQueryClient()
  const chatId = shallowRef<string | null>(null)

  const query = useQuery({
    queryKey: computed(() => ['preview', chatId.value] as const),
    queryFn: ({ signal }) =>
      requestJson<MessagePreviewResponse>(
        `/api/messages/preview?chatId=${encodeURIComponent(chatId.value ?? '')}`,
        { signal },
      ),
    enabled: computed(() => chatId.value !== null),
  })

  const messages = computed<MessageRecord[]>(() => query.data.value?.messages ?? [])
  const loading = computed(() => query.isFetching.value)
  const error = computed(() => (query.error.value ? query.error.value.message : null))

  function load(nextChatId: string): void {
    if (chatId.value === nextChatId) {
      void query.refetch()
      return
    }
    chatId.value = nextChatId
  }

  function clear(): void {
    void queryClient.cancelQueries({ queryKey: ['preview'] })
    queryClient.removeQueries({ queryKey: ['preview'] })
    chatId.value = null
  }

  return { messages, loading, error, load, clear }
}
