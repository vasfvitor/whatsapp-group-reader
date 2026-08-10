import { computed, shallowReadonly, shallowRef } from 'vue'
import type { MessagePreviewResponse, MessageRecord } from '@shared/contracts'
import { requestJson } from '@/shared/api/httpClient'

export function useMessagePreview() {
  const messages = shallowRef<MessageRecord[]>([])
  const error = shallowRef<string | null>(null)
  const pending = shallowRef<AbortController | null>(null)
  const loading = computed(() => pending.value !== null)

  async function load(chatId: string): Promise<void> {
    pending.value?.abort()
    const request = new AbortController()
    pending.value = request
    error.value = null
    messages.value = []
    try {
      const response = await requestJson<MessagePreviewResponse>(
        `/api/messages/preview?chatId=${encodeURIComponent(chatId)}`,
        { signal: request.signal },
      )
      if (pending.value !== request) return
      messages.value = response.messages
    } catch (caught) {
      // Every path that replaces pending aborts first, so the token check
      // also covers abort-triggered rejections.
      if (pending.value !== request) return
      error.value = caught instanceof Error ? caught.message : String(caught)
    } finally {
      if (pending.value === request) pending.value = null
    }
  }

  function clear(): void {
    pending.value?.abort()
    pending.value = null
    messages.value = []
    error.value = null
  }
  return {
    messages: shallowReadonly(messages),
    loading,
    error: shallowReadonly(error),
    load,
    clear,
  }
}
