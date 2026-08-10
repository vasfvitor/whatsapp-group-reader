// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultConfig,
  createIdleSyncProgress,
  type ConnectionState,
} from '../../shared/contracts.js'
import type { BackoffPolicy, RandomSource } from '../loadControl.js'
import { SyncInterruptedError, type SyncEngine } from '../sync/syncEngine.js'
import { WhatsAppService } from '../whatsappService.js'

interface EngineHarness {
  runAbort: AbortController | null
  progress: ReturnType<typeof createIdleSyncProgress>
  pacedDelay(sample: () => number, signal: AbortSignal): Promise<void>
  retryingRead<T>(
    operation: () => Promise<T>,
    policy: BackoffPolicy,
    label: string,
    signal: AbortSignal,
  ): Promise<T>
}

interface ServiceHarness {
  client: object | null
  clientAbortController: AbortController | null
  state: ConnectionState
  syncEngine: SyncEngine
  refreshRead<T>(
    operation: () => Promise<T>,
    policy: BackoffPolicy,
    signal: AbortSignal,
    label: string,
  ): Promise<T>
}

const centeredRandom: RandomSource = { next: () => 0.5 }
const retryPolicy: BackoffPolicy = {
  baseMs: 2_000,
  maxMs: 10_000,
  maxRetries: 2,
  jitterRatio: 0.2,
}

function createService(): WhatsAppService {
  const configStore = { get: () => createDefaultConfig() }
  const database = {
    countMessages: () => 0,
    pruneOperationalLogs: () => undefined,
    appendOperationalLog: (entry: object) => ({ sequence: 1, ...entry }),
    readOperationalLogs: () => ({ entries: [], cursor: 0 }),
  }
  return new WhatsAppService(
    configStore as never,
    database as never,
    'auth',
    'data',
    centeredRandom,
  )
}

function engineHarness(service: WhatsAppService): EngineHarness {
  return (service as unknown as ServiceHarness).syncEngine as unknown as EngineHarness
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WhatsAppService pacing', () => {
  it('retries a failed read at most twice with exponential delays', async () => {
    vi.useFakeTimers()
    const engine = engineHarness(createService())
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary one'))
      .mockRejectedValueOnce(new Error('temporary two'))
      .mockResolvedValue('ok')

    const result = engine.retryingRead(
      operation,
      retryPolicy,
      'Leitura',
      new AbortController().signal,
    )
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('returns the final read error after exhausting both retries', async () => {
    vi.useFakeTimers()
    const engine = engineHarness(createService())
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('still failing'))

    const result = engine.retryingRead(
      operation,
      retryPolicy,
      'Leitura',
      new AbortController().signal,
    )
    await Promise.all([
      expect(result).rejects.toThrow('still failing'),
      vi.advanceTimersByTimeAsync(6_000),
    ])

    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('stops pending refresh retries when the client is aborted', async () => {
    vi.useFakeTimers()
    const service = createService()
    const harness = service as unknown as ServiceHarness
    const abortController = new AbortController()
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('temporary'))

    const result = harness.refreshRead(operation, retryPolicy, abortController.signal, 'Leitura')
    await Promise.all([
      expect(result).rejects.toBeInstanceOf(Error),
      vi.advanceTimersByTimeAsync(0).then(() => abortController.abort()),
    ])

    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('requires a new full delay after pause and resume', async () => {
    vi.useFakeTimers()
    const service = createService()
    const engine = engineHarness(service)
    const runController = new AbortController()
    engine.runAbort = runController
    engine.progress.phase = 'running'
    let completed = false

    const waiting = engine.pacedDelay(() => 1_000, runController.signal).then(() => {
      completed = true
    })
    await vi.advanceTimersByTimeAsync(400)
    service.pauseSync()
    await vi.advanceTimersByTimeAsync(0)
    service.resumeSync()

    await vi.advanceTimersByTimeAsync(999)
    expect(completed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(completed).toBe(true)
  })

  it('cancels a paced delay as soon as the run is aborted', async () => {
    vi.useFakeTimers()
    const service = createService()
    const engine = engineHarness(service)
    const runController = new AbortController()
    engine.runAbort = runController
    engine.progress.phase = 'running'

    const waiting = engine.pacedDelay(() => 1_000, runController.signal)
    await vi.advanceTimersByTimeAsync(400)
    runController.abort()

    await expect(waiting).rejects.toBeInstanceOf(SyncInterruptedError)
  })

  it('coalesces chat refreshes and serves the cache while syncing', async () => {
    const service = createService()
    const harness = service as unknown as ServiceHarness
    let resolveChats!: (value: []) => void
    const getChats = vi.fn<() => Promise<[]>>(
      () => new Promise<[]>((resolve) => (resolveChats = resolve)),
    )
    const getContacts = vi.fn<() => Promise<object[]>>().mockResolvedValue([])
    const client = { getChats, getContacts }
    harness.client = client
    harness.clientAbortController = new AbortController()
    harness.state = 'ready'

    const first = service.getChats(true)
    const second = service.getChats(true)
    expect(getChats).toHaveBeenCalledTimes(1)
    resolveChats([])
    await Promise.all([first, second])
    expect(getContacts).toHaveBeenCalledTimes(1)

    engineHarness(service).runAbort = new AbortController()
    await service.getChats(true)
    expect(getChats).toHaveBeenCalledTimes(1)
  })

  it('enriches contact chats from the cached contacts list', async () => {
    const service = createService()
    const harness = service as unknown as ServiceHarness
    const id = { _serialized: '5511999999999@c.us', server: 'c.us', user: '5511999999999' }
    const client = {
      getChats: vi
        .fn<() => Promise<object[]>>()
        .mockResolvedValue([{ id, isGroup: false, name: '+55 11 99999-9999' }]),
      getContacts: vi.fn<() => Promise<object[]>>().mockResolvedValue([
        {
          id,
          isGroup: false,
          name: 'Maria Souza',
          verifiedName: undefined,
          pushname: 'Maria',
          shortName: 'Maria',
          number: '5511999999999',
          isMyContact: true,
          isBusiness: true,
        },
      ]),
    }
    harness.client = client
    harness.clientAbortController = new AbortController()
    harness.state = 'ready'

    const chats = await service.getChats(true)

    expect(chats[0]).toMatchObject({
      name: 'Maria Souza',
      phoneNumber: '5511999999999',
      isSavedContact: true,
      isBusiness: true,
    })
  })

  it('keeps contact chats available when metadata enrichment fails', async () => {
    vi.useFakeTimers()
    const service = createService()
    const harness = service as unknown as ServiceHarness
    const id = { _serialized: '5511999999999@c.us', server: 'c.us', user: '5511999999999' }
    const client = {
      getChats: vi
        .fn<() => Promise<object[]>>()
        .mockResolvedValue([{ id, isGroup: false, name: '+55 11 99999-9999' }]),
      getContacts: vi
        .fn<() => Promise<object[]>>()
        .mockRejectedValue(new Error('metadata unavailable')),
    }
    harness.client = client
    harness.clientAbortController = new AbortController()
    harness.state = 'ready'

    const pendingChats = service.getChats(true)
    await vi.runAllTimersAsync()
    const chats = await pendingChats

    expect(chats[0]).toMatchObject({
      name: '+55 11 99999-9999',
      phoneNumber: null,
      isSavedContact: false,
      isBusiness: false,
    })
    expect(client.getContacts).toHaveBeenCalledTimes(3)
  })
})
