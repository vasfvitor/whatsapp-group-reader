import { computed, type ComputedRef } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import type { AppStatus } from '@shared/contracts'
import { requestJson } from '@/shared/api/httpClient'
import type { RunOperation } from '@/app/applicationTypes'

export function useSyncActions(status: ComputedRef<AppStatus>, run: RunOperation) {
  const queryClient = useQueryClient()
  const syncing = computed(() => status.value.syncProgress.phase !== 'idle')

  function publishStatus(result: AppStatus | null): void {
    if (result) queryClient.setQueryData(['status'], result)
  }
  async function syncNow(forceRecent = false): Promise<void> {
    publishStatus(
      await run(() =>
        requestJson<AppStatus>('/api/sync', {
          method: 'POST',
          body: JSON.stringify({ forceRecent }),
        }),
      ),
    )
  }
  async function control(action: 'pause' | 'resume' | 'cancel'): Promise<void> {
    publishStatus(
      await run(() => requestJson<AppStatus>(`/api/sync/${action}`, { method: 'POST' })),
    )
  }
  return {
    syncing,
    syncNow,
    pauseSync: () => control('pause'),
    resumeSync: () => control('resume'),
    cancelSync: () => control('cancel'),
  }
}
