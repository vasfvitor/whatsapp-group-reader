import { computed, shallowReadonly, shallowRef, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  createDefaultConfig,
  createIdleSyncProgress,
  type AppConfig,
  type AppStatus,
} from '@shared/contracts'
import { requestJson } from '@/shared/api/httpClient'
import { useChatSelection } from '@/features/chat-selection/useChatSelection'
import { useOperationalLog } from '@/features/diagnostics/useOperationalLog'
import { useMessagePreview } from '@/features/messages/useMessagePreview'
import { useSyncActions } from '@/features/sync/useSyncActions'
import { useExports } from '@/features/exports/useExports'

const initialStatus: AppStatus = {
  state: 'starting',
  qrDataUrl: null,
  message: 'Iniciando aplicação…',
  lastError: null,
  lastSyncAt: null,
  collectedMessages: 0,
  selectedChats: 0,
  dataDirectory: '',
  warnings: [],
  syncProgress: createIdleSyncProgress(),
}

function isConnected(state: AppStatus['state']): boolean {
  return state === 'ready' || state === 'syncing'
}

export function useReaderApp() {
  const queryClient = useQueryClient()
  const config = shallowRef<AppConfig>(createDefaultConfig())
  const configLoaded = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const saving = shallowRef(false)

  async function run<T>(operation: () => Promise<T>): Promise<T | null> {
    error.value = null
    try {
      return await operation()
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
      return null
    }
  }

  const statusQuery = useQuery({
    queryKey: ['status'],
    queryFn: () => requestJson<AppStatus>('/api/status'),
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
  })
  const status = computed<AppStatus>(() => statusQuery.data.value ?? initialStatus)
  // A single failure is usually a transient local restart; only surface persistent ones.
  const errorCountAtLastSuccess = shallowRef(0)
  watch(
    () => statusQuery.dataUpdatedAt.value,
    () => {
      errorCountAtLastSuccess.value = statusQuery.errorUpdateCount.value
    },
  )
  const connectionError = computed(() =>
    statusQuery.errorUpdateCount.value - errorCountAtLastSuccess.value >= 2
      ? 'Não foi possível contatar o processo local. Tentando reconectar…'
      : null,
  )

  const selection = useChatSelection(config, run)
  const diagnostics = useOperationalLog()
  const preview = useMessagePreview()
  const sync = useSyncActions(status, run)
  const exports = useExports(run)

  watch(
    () => status.value.state,
    (next, previous) => {
      if (isConnected(next) && !isConnected(previous ?? 'starting')) {
        void selection.refreshChats()
      }
    },
  )

  void run(() => requestJson<AppConfig>('/api/config')).then((loaded) => {
    if (loaded) config.value = loaded
    configLoaded.value = true
  })
  const loading = computed(() => !configLoaded.value || statusQuery.isPending.value)

  async function saveConfig(): Promise<void> {
    saving.value = true
    const saved = await run(() =>
      requestJson<AppConfig>('/api/config', {
        method: 'PUT',
        body: JSON.stringify(config.value),
      }),
    )
    if (saved) {
      config.value = saved
      await selection.refreshChats()
    }
    saving.value = false
  }

  async function resetSession(): Promise<void> {
    const result = await run(() => requestJson<AppStatus>('/api/session/reset', { method: 'POST' }))
    if (result) queryClient.setQueryData(['status'], result)
  }

  return {
    status,
    config: shallowReadonly(config),
    error: shallowReadonly(error),
    connectionError,
    loading,
    saving: shallowReadonly(saving),
    chats: selection.chats,
    refreshing: selection.refreshing,
    selectedChats: selection.selectedChats,
    debugLog: diagnostics.entries,
    previewMessages: preview.messages,
    previewLoading: preview.loading,
    previewError: preview.error,
    exporting: exports.exporting,
    lastExport: exports.lastExport,
    syncing: sync.syncing,
    refreshChats: selection.refreshChats,
    setSelectedChatIds: selection.setSelectedChatIds,
    setChatTags: selection.setChatTags,
    setSources: selection.setSources,
    setSyncSettings: selection.setSyncSettings,
    applySources: selection.applySources,
    saveConfig,
    syncNow: sync.syncNow,
    pauseSync: sync.pauseSync,
    resumeSync: sync.resumeSync,
    cancelSync: sync.cancelSync,
    resetSession,
    createExport: exports.createExport,
    openDataDirectory: exports.openDataDirectory,
    loadMessagePreview: preview.load,
    clearMessagePreview: preview.clear,
  }
}
