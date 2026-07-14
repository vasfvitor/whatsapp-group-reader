import { onBeforeUnmount, onMounted, shallowReadonly, shallowRef } from 'vue'
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

export function useReaderApp() {
  const status = shallowRef<AppStatus>(initialStatus)
  const config = shallowRef<AppConfig>(createDefaultConfig())
  const error = shallowRef<string | null>(null)
  const loading = shallowRef(true)
  const saving = shallowRef(false)
  let pollTimer: number | null = null

  async function run<T>(operation: () => Promise<T>): Promise<T | null> {
    error.value = null
    try {
      return await operation()
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
      return null
    }
  }

  const selection = useChatSelection(config, run)
  const diagnostics = useOperationalLog()
  const preview = useMessagePreview()
  const sync = useSyncActions(status, run)
  const exports = useExports(run)

  async function pollStatus(): Promise<void> {
    const previousState = status.value.state
    try {
      const next = await requestJson<AppStatus>('/api/status')
      status.value = next
      error.value = null
      if (
        (next.state === 'ready' || next.state === 'syncing') &&
        previousState !== 'ready' &&
        previousState !== 'syncing'
      ) {
        await selection.refreshChats()
      }
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  }

  async function load(): Promise<void> {
    loading.value = true
    const [loadedStatus, loadedConfig] = await Promise.all([
      run(() => requestJson<AppStatus>('/api/status')),
      run(() => requestJson<AppConfig>('/api/config')),
    ])
    if (loadedStatus) status.value = loadedStatus
    if (loadedConfig) config.value = loadedConfig
    if (loadedStatus?.state === 'ready' || loadedStatus?.state === 'syncing') {
      await selection.refreshChats()
    }
    await diagnostics.poll()
    loading.value = false
  }

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
    if (result) status.value = result
  }

  onMounted(() => {
    void load()
    pollTimer = window.setInterval(() => {
      void pollStatus()
      void diagnostics.poll()
    }, 2_000)
  })
  onBeforeUnmount(() => {
    if (pollTimer !== null) window.clearInterval(pollTimer)
  })

  return {
    status: shallowReadonly(status),
    config: shallowReadonly(config),
    error: shallowReadonly(error),
    loading: shallowReadonly(loading),
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
