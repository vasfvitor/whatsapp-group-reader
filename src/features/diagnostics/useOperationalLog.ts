import { shallowReadonly, shallowRef } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import {
  OPERATIONAL_LOG_WINDOW,
  type OperationalLogEntry,
  type OperationalLogResponse,
} from '@shared/contracts'
import { requestJson } from '@/shared/api/httpClient'

export function useOperationalLog() {
  const entries = shallowRef<OperationalLogEntry[]>([])
  let cursor = 0

  useQuery({
    queryKey: ['debug-log'],
    queryFn: async () => {
      const response = await requestJson<OperationalLogResponse>(`/api/debug-log?after=${cursor}`)
      const restarted = response.cursor < cursor
      entries.value = (
        restarted ? response.entries : [...entries.value, ...response.entries]
      ).slice(-OPERATIONAL_LOG_WINDOW)
      cursor = response.cursor
      return response
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
  })

  return { entries: shallowReadonly(entries) }
}
