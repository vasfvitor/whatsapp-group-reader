import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig, createIdleSyncProgress, type AppStatus } from '@shared/contracts'
import { requestJson } from '@/shared/api/httpClient'
import { useReaderApp } from '../app/useReaderApp'

vi.mock('@/shared/api/httpClient', () => ({
  requestJson: vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(),
}))

const requestJsonMock = vi.mocked(requestJson)

const statusResponse: AppStatus = {
  state: 'starting',
  qrDataUrl: null,
  message: '',
  lastError: null,
  lastSyncAt: null,
  collectedMessages: 0,
  selectedChats: 0,
  dataDirectory: '',
  warnings: [],
  syncProgress: createIdleSyncProgress(),
}

let statusFails = false
let configPutFails = false
let reader: ReturnType<typeof useReaderApp>
let wrapper: VueWrapper

const Harness = defineComponent({
  setup() {
    reader = useReaderApp()
    return () => null
  },
})

async function mountReader(): Promise<void> {
  wrapper = mount(Harness)
  await flushPromises()
}

describe('useReaderApp', () => {
  beforeEach(() => {
    statusFails = false
    configPutFails = false
    vi.useFakeTimers()
    requestJsonMock.mockImplementation(async (url, init) => {
      if (url === '/api/status') {
        if (statusFails) throw new Error('fetch failed')
        return statusResponse
      }
      if (url === '/api/config') {
        if (init?.method === 'PUT') {
          if (configPutFails) throw new Error('Falha ao salvar.')
          return createDefaultConfig()
        }
        return createDefaultConfig()
      }
      if (url.startsWith('/api/debug-log')) return { entries: [], cursor: 0 }
      throw new Error(`Unexpected request: ${url}`)
    })
  })

  afterEach(() => {
    wrapper.unmount()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('keeps an action error visible across successful status polls', async () => {
    await mountReader()
    configPutFails = true

    await reader.saveConfig()
    expect(reader.error.value).toBe('Falha ao salvar.')

    await vi.advanceTimersByTimeAsync(2_000)

    expect(reader.error.value).toBe('Falha ao salvar.')
    expect(reader.connectionError.value).toBeNull()
  })

  it('reports a connection problem only after consecutive poll failures', async () => {
    await mountReader()
    statusFails = true

    await vi.advanceTimersByTimeAsync(2_000)
    expect(reader.connectionError.value).toBeNull()

    await vi.advanceTimersByTimeAsync(2_000)
    expect(reader.connectionError.value).toBe(
      'Não foi possível contatar o processo local. Tentando reconectar…',
    )

    statusFails = false
    await vi.advanceTimersByTimeAsync(2_000)
    expect(reader.connectionError.value).toBeNull()
  })
})
