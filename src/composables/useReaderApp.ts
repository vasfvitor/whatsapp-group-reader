import { computed, onBeforeUnmount, onMounted, shallowReadonly, shallowRef } from 'vue'
import {
  createDefaultConfig,
  type AppConfig,
  type AppStatus,
  type ChatSummary,
  type ExportRequest,
  type ExportResult,
  type Source,
  type SyncSettings,
} from '@shared/contracts'
import { matchingChatIds } from '@shared/sourceMatcher'

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
  syncProgress: {
    phase: 'idle',
    trigger: null,
    totalChats: 0,
    completedChats: 0,
    skippedChats: 0,
    failedChats: 0,
    currentChatId: null,
    currentChatName: null,
    currentChunkTarget: null,
    nextActionAt: null,
  },
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `A operação falhou (${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function useReaderApp() {
  const status = shallowRef<AppStatus>(initialStatus)
  const config = shallowRef<AppConfig>(createDefaultConfig())
  const chats = shallowRef<ChatSummary[]>([])
  const error = shallowRef<string | null>(null)
  const loading = shallowRef(true)
  const saving = shallowRef(false)
  const exporting = shallowRef(false)
  const lastExport = shallowRef<ExportResult | null>(null)
  let pollTimer: number | null = null
  const syncing = computed(() => status.value.syncProgress.phase !== 'idle')

  async function run<T>(operation: () => Promise<T>): Promise<T | null> {
    error.value = null
    try {
      return await operation()
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
      return null
    }
  }

  async function pollStatus(): Promise<void> {
    const previousState = status.value.state
    try {
      const next = await requestJson<AppStatus>('/api/status')
      status.value = next
      if (
        (next.state === 'ready' || next.state === 'syncing') &&
        previousState !== 'ready' &&
        previousState !== 'syncing'
      ) {
        await refreshChats()
      }
    } catch {
      // A transient local-server restart is expected during development and reconnection.
    }
  }

  async function refreshChats(force = false): Promise<void> {
    const result = await run(() =>
      requestJson<ChatSummary[]>(`/api/chats${force ? '?refresh=true' : ''}`),
    )
    if (result) chats.value = result
  }

  async function load(): Promise<void> {
    loading.value = true
    const [loadedStatus, loadedConfig] = await Promise.all([
      run(() => requestJson<AppStatus>('/api/status')),
      run(() => requestJson<AppConfig>('/api/config')),
    ])
    if (loadedStatus) status.value = loadedStatus
    if (loadedConfig) config.value = loadedConfig
    if (loadedStatus?.state === 'ready' || loadedStatus?.state === 'syncing') await refreshChats()
    loading.value = false
  }

  function setSelectedChatIds(selectedChatIds: string[]): void {
    config.value = { ...config.value, selectedChatIds: [...new Set(selectedChatIds)] }
  }

  function setChatTags(chatTags: Record<string, string[]>): void {
    config.value = { ...config.value, chatTags }
    chats.value = chats.value.map((chat) => ({ ...chat, tags: chatTags[chat.id] ?? [] }))
  }

  function setSources(sources: Source[]): void {
    config.value = { ...config.value, sources }
  }

  function setSyncSettings(sync: SyncSettings): void {
    config.value = { ...config.value, sync }
  }

  function applySources(): number {
    const matches = matchingChatIds(chats.value, config.value.sources)
    setSelectedChatIds([...config.value.selectedChatIds, ...matches])
    return matches.length
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
      await refreshChats()
    }
    saving.value = false
  }

  async function syncNow(): Promise<void> {
    const result = await run(() =>
      requestJson<AppStatus>('/api/sync', {
        method: 'POST',
        body: JSON.stringify({ forceRecent: true }),
      }),
    )
    if (result) status.value = result
  }

  async function controlSync(action: 'pause' | 'resume' | 'cancel'): Promise<void> {
    const result = await run(() =>
      requestJson<AppStatus>(`/api/sync/${action}`, { method: 'POST' }),
    )
    if (result) status.value = result
  }

  async function resetSession(): Promise<void> {
    const result = await run(() => requestJson<AppStatus>('/api/session/reset', { method: 'POST' }))
    if (result) status.value = result
  }

  async function createExport(request: ExportRequest): Promise<void> {
    exporting.value = true
    const result = await run(() =>
      requestJson<ExportResult>('/api/exports', {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    )
    exporting.value = false
    if (!result) return
    lastExport.value = result
    const link = document.createElement('a')
    link.href = result.downloadUrl
    link.download = result.fileName
    link.click()
  }

  async function openDataDirectory(): Promise<void> {
    await run(() => requestJson<void>('/api/data-directory/open', { method: 'POST' }))
  }

  onMounted(() => {
    void load()
    pollTimer = window.setInterval(() => void pollStatus(), 2_000)
  })

  onBeforeUnmount(() => {
    if (pollTimer !== null) window.clearInterval(pollTimer)
  })

  return {
    status: shallowReadonly(status),
    config: shallowReadonly(config),
    chats: shallowReadonly(chats),
    error: shallowReadonly(error),
    loading: shallowReadonly(loading),
    saving: shallowReadonly(saving),
    syncing,
    exporting: shallowReadonly(exporting),
    lastExport: shallowReadonly(lastExport),
    refreshChats,
    setSelectedChatIds,
    setChatTags,
    setSources,
    setSyncSettings,
    applySources,
    saveConfig,
    syncNow,
    pauseSync: () => controlSync('pause'),
    resumeSync: () => controlSync('resume'),
    cancelSync: () => controlSync('cancel'),
    resetSession,
    createExport,
    openDataDirectory,
  }
}
