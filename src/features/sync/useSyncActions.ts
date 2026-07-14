import { computed, type ShallowRef } from 'vue'
import type { AppStatus } from '@shared/contracts'
import { requestJson } from '@/shared/api/httpClient'
import type { RunOperation } from '@/app/applicationTypes'

export function useSyncActions(status: ShallowRef<AppStatus>, run: RunOperation) {
  const syncing = computed(() => status.value.syncProgress.phase !== 'idle')
  async function syncNow(forceRecent = false): Promise<void> {
    const result = await run(() =>
      requestJson<AppStatus>('/api/sync', {
        method: 'POST',
        body: JSON.stringify({ forceRecent }),
      }),
    )
    if (result) status.value = result
  }
  async function control(action: 'pause' | 'resume' | 'cancel'): Promise<void> {
    const result = await run(() =>
      requestJson<AppStatus>(`/api/sync/${action}`, { method: 'POST' }),
    )
    if (result) status.value = result
  }
  return {
    syncing,
    syncNow,
    pauseSync: () => control('pause'),
    resumeSync: () => control('resume'),
    cancelSync: () => control('cancel'),
  }
}
