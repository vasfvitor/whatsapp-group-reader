import { shallowReadonly, shallowRef } from 'vue'
import type { MessagePreviewResponse, MessageRecord } from '@shared/contracts'
import { requestJson } from '@/shared/api/httpClient'

export function useMessagePreview() {
  const messages = shallowRef<MessageRecord[]>([])
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  let activeRequest: AbortController | null = null

  async function load(chatId: string): Promise<void> {
    activeRequest?.abort()
    const request = new AbortController()
    activeRequest = request
    loading.value = true
    error.value = null
    messages.value = []
    try {
      const response = await requestJson<MessagePreviewResponse>(
        `/api/messages/preview?chatId=${encodeURIComponent(chatId)}`,
        { signal: request.signal },
      )
      if (activeRequest !== request) return
      messages.value = response.messages
    } catch (caught) {
      // Every path that replaces activeRequest aborts first, so the token check
      // also covers abort-triggered rejections.
      if (activeRequest !== request) return
      error.value = caught instanceof Error ? caught.message : String(caught)
    } finally {
      if (activeRequest === request) {
        activeRequest = null
        loading.value = false
      }
    }
  }

  function clear(): void {
    activeRequest?.abort()
    activeRequest = null
    loading.value = false
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
