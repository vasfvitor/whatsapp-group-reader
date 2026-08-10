import type WAWebJSTypes from 'whatsapp-web.js'
import {
  createIdleSyncProgress,
  type SyncProgress,
  type SyncTrigger,
} from '../../shared/contracts.js'
import type { ConfigStore } from '../configStore.js'
import type { MessageRepository } from '../messages/messageRepository.js'
import type { SyncStateRepository } from './syncStateRepository.js'
import {
  evaluateHistoryPage,
  LOAD_PROFILES,
  sampleExponentialBackoff,
  sampleInteger,
  sampleMilliseconds,
  shuffled,
  withReadRetry,
  type BackoffPolicy,
  type GaussianRange,
  type LoadProfileSettings,
  type RandomSource,
} from '../loadControl.js'
import type { OperationalLogBuffer } from '../operationalLog.js'
import {
  chatDisplayName,
  operationalChatName,
  type ChatCatalog,
  type WhatsAppChat,
} from '../chats/chatCatalog.js'
import type { MessageCollector } from '../messages/messageCollector.js'

type WhatsAppClient = WAWebJSTypes.Client

export class SyncInterruptedError extends Error {}

export interface SyncOptions {
  trigger: SyncTrigger
  forceRecent: boolean
}

export type SyncOutcome =
  | { status: 'completed' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: string }

export interface SyncEngineDependencies {
  configStore: Pick<ConfigStore, 'get'>
  messages: MessageRepository
  syncStates: SyncStateRepository
  chatCatalog: ChatCatalog
  messageCollector: MessageCollector
  operationalLog: OperationalLogBuffer
  random: RandomSource
  /** Publishes the user-facing status line. */
  notify: (message: string) => void
  /** Records a warning kept visible after the run finishes. */
  warn: (warning: string) => void
}

/** Sleep that rejects with SyncInterruptedError as soon as the signal aborts. */
export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new SyncInterruptedError())
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

const HISTORY_CHUNK_SIZE = 50

/**
 * Runs one paced history sync at a time. Interruption is a single AbortSignal
 * (user cancel or client teardown, linked in run()); pause/resume only gates
 * pacing waits — the operation in flight always completes first.
 */
export class SyncEngine {
  progress: SyncProgress = createIdleSyncProgress()

  private runAbort: AbortController | null = null
  private paused = false
  private resumeWaiters: Array<() => void> = []
  private pauseInterrupt = new AbortController()

  private readonly configStore: Pick<ConfigStore, 'get'>
  private readonly messages: MessageRepository
  private readonly syncStates: SyncStateRepository
  private readonly chatCatalog: ChatCatalog
  private readonly messageCollector: MessageCollector
  private readonly operationalLog: OperationalLogBuffer
  private readonly random: RandomSource
  private readonly notify: (message: string) => void
  private readonly warn: (warning: string) => void

  constructor(dependencies: SyncEngineDependencies) {
    this.configStore = dependencies.configStore
    this.messages = dependencies.messages
    this.syncStates = dependencies.syncStates
    this.chatCatalog = dependencies.chatCatalog
    this.messageCollector = dependencies.messageCollector
    this.operationalLog = dependencies.operationalLog
    this.random = dependencies.random
    this.notify = dependencies.notify
    this.warn = dependencies.warn
  }

  get running(): boolean {
    return this.runAbort !== null
  }

  async run(
    client: WhatsAppClient,
    clientSignal: AbortSignal,
    options: SyncOptions,
  ): Promise<SyncOutcome> {
    if (this.runAbort) throw new Error('Já existe uma sincronização em andamento.')
    const controller = new AbortController()
    this.runAbort = controller
    const signal = controller.signal
    const propagateClientAbort = () => controller.abort()
    const releaseOnAbort = () => {
      this.paused = false
      this.releaseResumeWaiters()
    }
    signal.addEventListener('abort', releaseOnAbort, { once: true })
    if (clientSignal.aborted) controller.abort()
    else clientSignal.addEventListener('abort', propagateClientAbort, { once: true })

    try {
      await this.performSync(client, signal, options)
      return { status: 'completed' }
    } catch (error) {
      if (error instanceof SyncInterruptedError || signal.aborted) return { status: 'cancelled' }
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    } finally {
      clientSignal.removeEventListener('abort', propagateClientAbort)
      signal.removeEventListener('abort', releaseOnAbort)
      if (signal.aborted) {
        this.operationalLog.add('warn', 'sync_cancelled', 'Sincronização cancelada pelo usuário.')
      }
      this.paused = false
      this.releaseResumeWaiters()
      this.runAbort = null
      this.progress = createIdleSyncProgress()
    }
  }

  pause(): void {
    if (!this.runAbort || this.runAbort.signal.aborted || this.progress.phase !== 'running') return
    this.paused = true
    this.progress.phase = 'paused'
    this.progress.nextActionAt = null
    this.notify('Sincronização pausada. A operação atual será concluída antes da pausa.')
    this.pauseInterrupt.abort()
    this.pauseInterrupt = new AbortController()
  }

  resume(): void {
    if (!this.runAbort || this.progress.phase !== 'paused') return
    this.paused = false
    this.progress.phase = 'running'
    this.notify('Sincronização retomada.')
    this.releaseResumeWaiters()
  }

  cancel(): void {
    this.runAbort?.abort()
  }

  private async performSync(
    client: WhatsAppClient,
    signal: AbortSignal,
    options: SyncOptions,
  ): Promise<void> {
    const config = this.configStore.get()
    const profile = LOAD_PROFILES[config.sync.loadProfile]
    const cutoff = Math.floor(Date.now() / 1000) - config.sync.lookbackHours * 60 * 60
    const chatIds = shuffled(config.selectedChatIds, this.random)
    let chatsInBatch = 0
    let batchSize = sampleInteger(profile.chatsPerBatch, this.random)

    this.notify('Preparando a busca controlada de mensagens…')
    this.progress = {
      ...createIdleSyncProgress(),
      phase: 'running',
      trigger: options.trigger,
      totalChats: chatIds.length,
      messageLimitPerChat: config.sync.maxMessagesPerChat,
    }
    this.operationalLog.add('info', 'sync_started', 'Sincronização iniciada.', {
      chats: chatIds.length,
      profile: config.sync.loadProfile,
      trigger: options.trigger,
      forceRecent: options.forceRecent,
      messageLimitPerChat: config.sync.maxMessagesPerChat,
    })

    for (const [chatIndex, chatId] of chatIds.entries()) {
      this.throwIfInterrupted(signal)
      const chat = this.chatCatalog.get(chatId)
      if (!chat) {
        this.progress.skippedChats += 1
        this.operationalLog.add('warn', 'chat_missing', 'Conversa não encontrada no cache.', {
          position: chatIndex + 1,
          totalChats: chatIds.length,
        })
        continue
      }

      const priorState = this.syncStates.get(chatId)
      const inCooldown =
        priorState !== null &&
        Date.now() - Date.parse(priorState.lastAttemptAt) < profile.automaticCooldownMs
      if (!options.forceRecent && inCooldown) {
        this.progress.skippedChats += 1
        this.operationalLog.add('info', 'chat_skipped', 'Conversa ignorada por cooldown.', {
          chatName: operationalChatName(chat),
          position: chatIndex + 1,
          totalChats: chatIds.length,
        })
        continue
      }

      this.progress.currentChatId = chatId
      this.progress.currentChatName = chatDisplayName(chat)
      this.progress.currentChatPosition = chatIndex + 1
      this.progress.currentFetchedMessages = 0
      this.progress.currentEligibleMessages = 0
      this.progress.currentInsertedMessages = 0
      const chatStartedAt = Date.now()
      this.operationalLog.add('info', 'chat_started', 'Processamento da conversa iniciado.', {
        chatName: operationalChatName(chat),
        position: chatIndex + 1,
        totalChats: chatIds.length,
        messageLimit: config.sync.maxMessagesPerChat,
      })

      if (chatsInBatch >= batchSize) {
        this.notify('Pausa de carga antes de continuar a fila…')
        await this.waitForPacing(profile.periodicPauseMs, signal)
        chatsInBatch = 0
        batchSize = sampleInteger(profile.chatsPerBatch, this.random)
      }

      this.notify(`Aguardando para consultar ${this.progress.currentChatName}…`)
      await this.waitForPacing(profile.betweenChatsMs, signal)
      this.syncStates.markAttempt(chatId, new Date().toISOString())

      try {
        this.notify(`Consultando ${this.progress.currentChatName}…`)
        await this.syncChat(chat, cutoff, config.sync.maxMessagesPerChat, profile, client, signal)
        this.syncStates.markCompleted(chatId, new Date().toISOString())
        this.progress.completedChats += 1
        chatsInBatch += 1
        this.operationalLog.add('info', 'chat_completed', 'Conversa processada.', {
          chatName: operationalChatName(chat),
          fetched: this.progress.currentFetchedMessages,
          eligible: this.progress.currentEligibleMessages,
          inserted: this.progress.currentInsertedMessages,
          durationMs: Date.now() - chatStartedAt,
        })
      } catch (error) {
        if (error instanceof SyncInterruptedError) {
          this.syncStates.markCancelled(chatId)
          throw error
        }
        const failure = error instanceof Error ? error.message : String(error)
        this.syncStates.markFailed(chatId, failure)
        this.progress.failedChats += 1
        chatsInBatch += 1
        this.warn(`${chatDisplayName(chat)}: ${failure}`)
        this.operationalLog.add('error', 'chat_failed', 'Falha ao processar conversa.', {
          chatName: operationalChatName(chat),
          durationMs: Date.now() - chatStartedAt,
        })
      } finally {
        this.progress.currentChunkTarget = null
      }
    }

    this.throwIfInterrupted(signal)
    this.notify('Sincronização concluída.')
    this.operationalLog.add('info', 'sync_completed', 'Sincronização concluída.', {
      completedChats: this.progress.completedChats,
      skippedChats: this.progress.skippedChats,
      failedChats: this.progress.failedChats,
      fetched: this.progress.totalFetchedMessages,
      eligible: this.progress.totalEligibleMessages,
      inserted: this.progress.totalInsertedMessages,
    })
  }

  private async syncChat(
    chat: WhatsAppChat,
    cutoff: number,
    maximum: number,
    profile: LoadProfileSettings,
    client: WhatsAppClient,
    signal: AbortSignal,
  ): Promise<void> {
    const checkpoint = this.messages.getCheckpoint(chat.id._serialized)
    const seenMessageIds = new Set<string>()
    let target = Math.min(HISTORY_CHUNK_SIZE, maximum)

    while (true) {
      await this.waitWhilePaused(signal)
      this.throwIfInterrupted(signal)
      this.progress.currentChunkTarget = target
      const fetchStartedAt = Date.now()
      this.operationalLog.add('info', 'fetch_started', 'Busca de mensagens iniciada.', {
        chatName: operationalChatName(chat),
        target,
        messageLimit: maximum,
      })

      const messages = await this.retryingRead(
        () => chat.fetchMessages({ limit: target }),
        profile.readRetry,
        `Consultando ${operationalChatName(chat)}`,
        signal,
      )
      this.throwIfInterrupted(signal)
      let pageFetched = 0
      let pageEligible = 0
      let pageInserted = 0

      for (const item of messages) {
        this.throwIfInterrupted(signal)
        const messageId = item.id._serialized
        if (seenMessageIds.has(messageId)) continue
        seenMessageIds.add(messageId)
        pageFetched += 1
        this.progress.currentFetchedMessages += 1
        this.progress.totalFetchedMessages += 1
        if (item.timestamp < cutoff) continue
        const outcome = await this.messageCollector.persist(item, chat, client)
        if (outcome === 'ignored') continue
        pageEligible += 1
        this.progress.currentEligibleMessages += 1
        this.progress.totalEligibleMessages += 1
        if (outcome === 'inserted') {
          pageInserted += 1
          this.progress.currentInsertedMessages += 1
          this.progress.totalInsertedMessages += 1
        }
      }

      this.operationalLog.add('info', 'fetch_completed', 'Bloco de mensagens processado.', {
        chatName: operationalChatName(chat),
        target,
        returned: messages.length,
        uniqueFetched: pageFetched,
        eligible: pageEligible,
        inserted: pageInserted,
        durationMs: Date.now() - fetchStartedAt,
      })

      const decision = evaluateHistoryPage({
        messageIds: messages.map((item) => item.id._serialized),
        timestamps: messages.map((item) => item.timestamp),
        returnedCount: messages.length,
        target,
        maximum,
        cutoffTimestamp: cutoff,
        checkpoint,
      })

      if (decision.gapRisk) {
        this.warn(
          `${chatDisplayName(chat)}: pode haver uma lacuna anterior às ${maximum} mensagens recuperadas.`,
        )
      }
      if (decision.stop) return

      this.notify(`Pausa antes do próximo bloco de ${chatDisplayName(chat)}…`)
      await this.waitForPacing(profile.betweenChunksMs, signal)
      target = Math.min(target + HISTORY_CHUNK_SIZE, maximum)
    }
  }

  private waitForPacing(range: GaussianRange, signal: AbortSignal): Promise<void> {
    return this.pacedDelay(() => sampleMilliseconds(range, this.random), signal)
  }

  private retryingRead<T>(
    operation: () => Promise<T>,
    policy: BackoffPolicy,
    label: string,
    signal: AbortSignal,
  ): Promise<T> {
    return withReadRetry(operation, policy, {
      beforeAttempt: () => this.waitWhilePaused(signal),
      guard: () => this.throwIfInterrupted(signal),
      delay: (attempt) => {
        const retryNumber = attempt + 1
        const message = `${label} falhou. Nova tentativa ${retryNumber}/${policy.maxRetries} após uma pausa…`
        this.notify(message)
        return this.pacedDelay(() => {
          const delay = sampleExponentialBackoff(policy, attempt, this.random)
          this.operationalLog.add('warn', 'read_retry', message, {
            retry: retryNumber,
            maxRetries: policy.maxRetries,
            delayMs: delay,
          })
          return delay
        }, signal)
      },
    })
  }

  /**
   * Waits a sampled duration, restarting with a fresh sample whenever a pause
   * interrupts it, so a resumed sync never rushes its next action.
   */
  private async pacedDelay(sample: () => number, signal: AbortSignal): Promise<void> {
    while (true) {
      await this.waitWhilePaused(signal)
      this.throwIfInterrupted(signal)
      const duration = sample()
      this.progress.nextActionAt = new Date(Date.now() + duration).toISOString()
      const completed = await this.sleep(duration, signal)
      this.progress.nextActionAt = null
      if (completed && !this.paused) {
        this.throwIfInterrupted(signal)
        return
      }
    }
  }

  /** Resolves true after the full duration, false when a pause interrupted it. */
  private sleep(duration: number, signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const pauseSignal = this.pauseInterrupt.signal
      const cleanup = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        pauseSignal.removeEventListener('abort', onPause)
      }
      const onAbort = () => {
        cleanup()
        reject(new SyncInterruptedError())
      }
      const onPause = () => {
        cleanup()
        resolve(false)
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve(true)
      }, duration)
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      pauseSignal.addEventListener('abort', onPause, { once: true })
    })
  }

  private async waitWhilePaused(signal: AbortSignal): Promise<void> {
    while (this.paused && !signal.aborted) {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve))
    }
  }

  private releaseResumeWaiters(): void {
    const waiters = this.resumeWaiters
    this.resumeWaiters = []
    for (const waiter of waiters) waiter()
  }

  private throwIfInterrupted(signal: AbortSignal): void {
    if (signal.aborted) throw new SyncInterruptedError()
  }
}
