import { shallowReadonly, shallowRef } from 'vue'
import type { OperationalLogEntry, OperationalLogResponse } from '@shared/contracts'
import { requestJson } from '@/shared/api/httpClient'

export function useOperationalLog() {
  const entries = shallowRef<OperationalLogEntry[]>([])
  let cursor = 0
  let polling = false
  async function poll(): Promise<void> {
    if (polling) return
    polling = true
    try {
      const response = await requestJson<OperationalLogResponse>(`/api/debug-log?after=${cursor}`)
      const restarted = response.cursor < cursor
      entries.value = (
        restarted ? response.entries : [...entries.value, ...response.entries]
      ).slice(-200)
      cursor = response.cursor
    } catch {
      /* Status polling surfaces persistent server failures. */
    } finally {
      polling = false
    }
  }
  return { entries: shallowReadonly(entries), poll }
}
