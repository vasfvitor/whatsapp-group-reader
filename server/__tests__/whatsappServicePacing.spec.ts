// @vitest-environment node
/// <reference path="../write-file-atomic.d.ts" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDefaultConfig,
  createIdleSyncProgress,
  type ConnectionState,
} from '../../shared/contracts.js'
import type { BackoffPolicy, RandomSource } from '../loadControl.js'
import { WhatsAppService } from '../whatsappService.js'

interface SyncControlHarness {
  cancelled: boolean
  paused: boolean
}

interface ServiceHarness {
  client: object | null
  clientAbortController: AbortController | null
  state: ConnectionState
  syncPromise: Promise<void> | null
  syncControl: SyncControlHarness | null
  syncProgress: ReturnType<typeof createIdleSyncProgress>
  pauseResolve: (() => void) | null
  readWithRetry<T>(
    operation: () => Promise<T>,
    policy: BackoffPolicy,
    client: object,
    signal: AbortSignal | undefined,
    control: SyncControlHarness | null,
    label: string,
  ): Promise<T>
  waitForControlledDelay(
    milliseconds: () => number,
    client: object,
    control: SyncControlHarness,
  ): Promise<void>
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
  const database = { countMessages: () => 0 }
  return new WhatsAppService(
    configStore as never,
    database as never,
    'auth',
    'data',
    centeredRandom,
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('WhatsAppService pacing', () => {
  it('retries a failed read at most twice with exponential delays', async () => {
    vi.useFakeTimers()
    const service = createService()
    const harness = service as unknown as ServiceHarness
    const client = {}
    harness.client = client
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary one'))
      .mockRejectedValueOnce(new Error('temporary two'))
      .mockResolvedValue('ok')

    const result = harness.readWithRetry(operation, retryPolicy, client, undefined, null, 'Leitura')
    await vi.advanceTimersByTimeAsync(6_000)

    await expect(result).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('returns the final read error after exhausting both retries', async () => {
    vi.useFakeTimers()
    const service = createService()
    const harness = service as unknown as ServiceHarness
    const client = {}
    harness.client = client
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('still failing'))

    const result = harness.readWithRetry(operation, retryPolicy, client, undefined, null, 'Leitura')
    const assertion = expect(result).rejects.toThrow('still failing')
    await vi.advanceTimersByTimeAsync(6_000)

    await assertion
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('stops pending retries when the client operation is aborted', async () => {
    vi.useFakeTimers()
    const service = createService()
    const harness = service as unknown as ServiceHarness
    const client = {}
    const abortController = new AbortController()
    harness.client = client
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('temporary'))

    const result = harness.readWithRetry(
      operation,
      retryPolicy,
      client,
      abortController.signal,
      null,
      'Leitura',
    )
    const assertion = expect(result).rejects.toBeInstanceOf(Error)
    await vi.advanceTimersByTimeAsync(0)
    abortController.abort()

    await assertion
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('requires a new full delay after pause and resume', async () => {
    vi.useFakeTimers()
    const service = createService()
    const harness = service as unknown as ServiceHarness
    const client = {}
    const control = { cancelled: false, paused: false }
    harness.client = client
    harness.syncControl = control
    harness.syncProgress = { ...createIdleSyncProgress(), phase: 'running' }
    let completed = false

    const waiting = harness
      .waitForControlledDelay(() => 1_000, client, control)
      .then(() => {
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

  it('coalesces chat refreshes and serves the cache while syncing', async () => {
    const service = createService()
    const harness = service as unknown as ServiceHarness
    let resolveChats!: (value: []) => void
    const getChats = vi.fn(() => new Promise<[]>((resolve) => (resolveChats = resolve)))
    const getContacts = vi.fn().mockResolvedValue([])
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

    harness.syncPromise = new Promise<void>(() => undefined)
    await service.getChats(true)
    expect(getChats).toHaveBeenCalledTimes(1)
  })

  it('enriches contact chats from the cached contacts list', async () => {
    const service = createService()
    const harness = service as unknown as ServiceHarness
    const id = { _serialized: '5511999999999@c.us', server: 'c.us', user: '5511999999999' }
    const client = {
      getChats: vi.fn().mockResolvedValue([{ id, isGroup: false, name: '+55 11 99999-9999' }]),
      getContacts: vi.fn().mockResolvedValue([
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
      getChats: vi.fn().mockResolvedValue([{ id, isGroup: false, name: '+55 11 99999-9999' }]),
      getContacts: vi.fn().mockRejectedValue(new Error('metadata unavailable')),
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
