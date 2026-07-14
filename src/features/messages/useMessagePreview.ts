import { shallowReadonly, shallowRef } from 'vue'
import type { MessagePreviewResponse, MessageRecord } from '@shared/contracts'
import { requestJson } from '@/shared/api/httpClient'

export function useMessagePreview() {
  const messages = shallowRef<MessageRecord[]>([])
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  async function load(chatId: string): Promise<void> {
    loading.value = true
    error.value = null
    messages.value = []
    try {
      const response = await requestJson<MessagePreviewResponse>(
        `/api/messages/preview?chatId=${encodeURIComponent(chatId)}`,
      )
      messages.value = response.messages
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    } finally {
      loading.value = false
    }
  }
  function clear(): void {
    messages.value = []
    error.value = null
  }
  return {
    messages: shallowReadonly(messages),
    loading: shallowReadonly(loading),
    error: shallowReadonly(error),
    load,
    clear,
  }
}
