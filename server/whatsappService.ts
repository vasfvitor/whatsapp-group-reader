import { rm } from 'node:fs/promises'
import QRCode from 'qrcode'
import WhatsAppWeb from 'whatsapp-web.js'
import type WAWebJSTypes from 'whatsapp-web.js'
import {
  createIdleSyncProgress,
  type AppStatus,
  type ChatSummary,
  type ChatType,
  type ConnectionState,
  type MessageRecord,
  type SyncTrigger,
} from '../shared/contracts.js'
import type { ConfigStore } from './configStore.js'
import type { MessageDatabase } from './database.js'
import {
  cryptoRandomSource,
  evaluateHistoryPage,
  LOAD_PROFILES,
  RECONNECT_BACKOFF,
  sampleExponentialBackoff,
  sampleInteger,
  sampleMilliseconds,
  shuffled,
  type BackoffPolicy,
  type GaussianRange,
  type LoadProfileSettings,
  type RandomSource,
} from './loadControl.js'
import { normalizeMessage } from './messageNormalizer.js'
import { OperationalLogBuffer } from './operationalLog.js'

const { Client, LocalAuth } = WhatsAppWeb

type WhatsAppClient = WAWebJSTypes.Client
type WhatsAppChat = WAWebJSTypes.Chat
type WhatsAppContact = WAWebJSTypes.Contact
type WhatsAppMessage = WAWebJSTypes.Message
type PersistOutcome = 'ignored' | 'duplicate' | 'inserted'

interface SyncOptions {
  trigger: SyncTrigger
  forceRecent: boolean
}

interface SyncControl {
  cancelled: boolean
  paused: boolean
}

interface ContactMetadata {
  name: string
  phoneNumber: string
  isSavedContact: boolean
  isBusiness: boolean
}

class SyncInterruptedError extends Error {}

const CONTACT_SERVERS = new Set(['c.us', 'lid', 's.whatsapp.net'])
const HISTORY_CHUNK_SIZE = 50

function chatDisplayName(chat: WhatsAppChat): string {
  return chat.name || chat.id.user
}

function operationalChatName(chat: WhatsAppChat): string {
  const name = chat.name?.trim()
  const looksLikePhoneNumber = name && /^\+?[\d\s().-]{7,}$/.test(name)
  if (name && !looksLikePhoneNumber) return name
  return chat.isGroup ? 'Grupo sem nome' : 'Contato sem nome'
}

export class WhatsAppService {
  private client: WhatsAppClient | null = null
  private clientAbortController: AbortController | null = null
  private readonly chats = new Map<string, WhatsAppChat>()
  private readonly contactMetadata = new Map<string, ContactMetadata>()
  private readonly authors = new Map<string, string>()
  private readonly operationalLog: OperationalLogBuffer
  private state: ConnectionState = 'stopped'
  private qrDataUrl: string | null = null
  private message = 'Aplicação iniciada.'
  private lastError: string | null = null
  private lastSyncAt: string | null = null
  private collectedMessages: number
  private warnings: string[] = []
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private refreshPromise: Promise<void> | null = null
  private syncPromise: Promise<void> | null = null
  private syncControl: SyncControl | null = null
  private syncProgress = createIdleSyncProgress()
  private pendingAutomaticSync = false
  private delayTimer: NodeJS.Timeout | null = null
  private delayResolve: ((completed: boolean) => void) | null = null
  private pauseResolve: (() => void) | null = null

  constructor(
    private readonly configStore: ConfigStore,
    private readonly database: MessageDatabase,
    private readonly authDirectory: string,
    private readonly dataDirectory: string,
    private readonly random: RandomSource = cryptoRandomSource,
  ) {
    this.collectedMessages = database.countMessages()
    this.operationalLog = new OperationalLogBuffer(200, database)
  }

  start(): void {
    this.clearReconnectTimer()
    this.reconnectAttempt = 0
    this.createClient('starting')
  }

  getStatus(): AppStatus {
    return {
      state: this.state,
      qrDataUrl: this.qrDataUrl,
      message: this.message,
      lastError: this.lastError,
      lastSyncAt: this.lastSyncAt,
      collectedMessages: this.collectedMessages,
      selectedChats: this.configStore.get().selectedChatIds.length,
      dataDirectory: this.dataDirectory,
      warnings: [...this.warnings],
      syncProgress: { ...this.syncProgress },
    }
  }

  getOperationalLog(after = 0) {
    return this.operationalLog.read(after)
  }

  async getChats(refresh = false): Promise<ChatSummary[]> {
    if (refresh && !this.syncPromise) await this.refreshChats()
    const config = this.configStore.get()

    return [...this.chats.values()]
      .map((chat) => this.toSummary(chat, config.selectedChatIds, config.chatTags))
      .filter((chat): chat is ChatSummary => chat !== null)
      .sort((left, right) => {
        if (left.type !== right.type) return left.type === 'group' ? -1 : 1
        return left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' })
      })
  }

  onConfigUpdated(): void {
    if (this.state === 'ready' || this.state === 'syncing') {
      this.syncSelected({ trigger: 'automatic', forceRecent: false })
    }
  }

  syncSelected(options: SyncOptions): boolean {
    if (this.syncPromise) {
      if (options.trigger === 'automatic') this.pendingAutomaticSync = true
      return false
    }
    if (this.refreshPromise) {
      if (options.trigger === 'automatic') {
        this.pendingAutomaticSync = true
        return false
      }
      throw new Error('Aguarde a atualização da lista de conversas terminar.')
    }
    if (!this.client || this.state !== 'ready') {
      throw new Error('O WhatsApp ainda não está pronto para sincronizar.')
    }

    const client = this.client
    const control: SyncControl = { cancelled: false, paused: false }
    this.syncControl = control
    this.syncPromise = this.performSync(client, control, options)
      .catch((error: unknown) => {
        if (!(error instanceof SyncInterruptedError)) {
          this.lastError = this.errorMessage(error)
          this.message = 'A sincronização foi interrompida por um erro inesperado.'
          this.operationalLog.add('error', 'sync_failed', this.message)
        }
      })
      .finally(() => {
        this.finishSync(client, control)
      })
    return true
  }

  pauseSync(): void {
    if (!this.syncControl || this.syncControl.cancelled || this.syncProgress.phase !== 'running') {
      return
    }
    this.syncControl.paused = true
    this.syncProgress.phase = 'paused'
    this.syncProgress.nextActionAt = null
    this.message = 'Sincronização pausada. A operação atual será concluída antes da pausa.'
    this.interruptDelay()
  }

  resumeSync(): void {
    if (!this.syncControl || this.syncProgress.phase !== 'paused') return
    this.syncControl.paused = false
    this.syncProgress.phase = 'running'
    this.message = 'Sincronização retomada.'
    this.pauseResolve?.()
    this.pauseResolve = null
  }

  cancelSync(): void {
    if (!this.syncControl) return
    this.pendingAutomaticSync = false
    this.signalSyncCancellation()
    this.message = 'Cancelando sincronização após a operação atual…'
  }

  async resetSession(): Promise<void> {
    this.clearReconnectTimer()
    this.signalSyncCancellation()
    await this.destroyClient()
    await rm(this.authDirectory, { recursive: true, force: true, maxRetries: 4 })
    this.reconnectAttempt = 0
    this.qrDataUrl = null
    this.lastError = null
    this.createClient('starting')
  }

  async stop(): Promise<void> {
    this.clearReconnectTimer()
    this.signalSyncCancellation()
    this.state = 'stopped'
    await this.destroyClient()
  }

  private createClient(initialState: ConnectionState): void {
    this.clientAbortController?.abort()
    const abortController = new AbortController()
    this.clientAbortController = abortController
    this.state = initialState
    this.message = initialState === 'reconnecting' ? 'Reconectando ao WhatsApp…' : 'Conectando…'
    this.lastError = null

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: this.authDirectory, rmMaxRetries: 4 }),
      puppeteer: { headless: true },
      qrMaxRetries: 0,
    })
    this.client = client

    client.on('qr', (qr: string) => {
      if (this.client !== client) return
      void QRCode.toDataURL(qr, { width: 320, margin: 2 }).then((dataUrl) => {
        if (this.client !== client) return
        this.qrDataUrl = dataUrl
        this.state = 'awaiting_qr'
        this.message = 'Escaneie o QR Code com o telefone que será vinculado.'
      })
    })

    client.on('authenticated', () => {
      if (this.client !== client) return
      this.qrDataUrl = null
      this.state = 'authenticated'
      this.message = 'Sessão autenticada. Carregando conversas…'
    })

    client.on('ready', () => {
      if (this.client !== client) return
      this.qrDataUrl = null
      this.state = 'ready'
      this.message = 'WhatsApp conectado.'
      this.reconnectAttempt = 0
      void this.refreshChats()
        .then(() => this.syncSelected({ trigger: 'automatic', forceRecent: false }))
        .catch((error: unknown) => {
          if (!(error instanceof SyncInterruptedError)) this.recordRecoverableError(error)
        })
    })

    client.on('auth_failure', (reason: string) => {
      if (this.client !== client) return
      abortController.abort()
      this.signalSyncCancellation()
      this.qrDataUrl = null
      this.state = 'invalid_session'
      this.message = 'A sessão salva não é mais válida.'
      this.lastError = reason
    })

    client.on('disconnected', (reason: string) => {
      if (this.client !== client) return
      abortController.abort()
      this.signalSyncCancellation()
      this.qrDataUrl = null
      if (reason === 'LOGOUT') {
        this.state = 'invalid_session'
        this.message =
          'O telefone desvinculou esta sessão. Confirme o reset para vincular novamente.'
        return
      }
      this.lastError = reason
      this.scheduleReconnect()
    })

    client.on('message_create', (incoming: WhatsAppMessage) => {
      if (this.client !== client) return
      void this.handleRealtimeMessage(incoming).catch((error: unknown) =>
        this.recordRecoverableError(error),
      )
    })

    void client.initialize().catch((error: unknown) => {
      if (this.client !== client || this.state === 'invalid_session') return
      this.lastError = this.errorMessage(error)
      this.scheduleReconnect()
    })
  }

  private refreshChats(): Promise<void> {
    if (!this.client || (this.state !== 'ready' && this.state !== 'syncing')) {
      return Promise.resolve()
    }
    if (this.refreshPromise) return this.refreshPromise

    const client = this.client
    const signal = this.clientAbortController?.signal
    const profile = LOAD_PROFILES[this.configStore.get().sync.loadProfile]
    const refresh = this.readWithRetry(
      () => client.getChats(),
      profile.readRetry,
      client,
      signal,
      null,
      'Atualizando a lista de conversas',
    ).then(async (chats) => {
      let contacts: WhatsAppContact[] = []
      try {
        contacts = await this.readWithRetry(
          () => client.getContacts(),
          profile.readRetry,
          client,
          signal,
          null,
          'Atualizando os nomes dos contatos',
        )
      } catch {
        this.assertReadActive(client, signal, null)
        this.operationalLog.add(
          'warn',
          'contact_metadata_unavailable',
          'Nomes dos contatos indisponíveis; mantendo os números da lista.',
        )
      }
      if (this.client !== client) throw new SyncInterruptedError()
      this.chats.clear()
      this.contactMetadata.clear()
      for (const contact of contacts) this.cacheContactMetadata(contact)
      for (const chat of chats) {
        if (this.chatType(chat)) this.chats.set(chat.id._serialized, chat)
      }
      if (this.state === 'ready') this.message = 'Lista de conversas atualizada.'
      this.operationalLog.add('info', 'chats_refreshed', 'Lista de conversas atualizada.', {
        chats: this.chats.size,
      })
    })

    this.refreshPromise = refresh.finally(() => {
      this.refreshPromise = null
      this.startPendingAutomaticSync(client)
    })
    return this.refreshPromise
  }

  private async performSync(
    client: WhatsAppClient,
    control: SyncControl,
    options: SyncOptions,
  ): Promise<void> {
    const config = this.configStore.get()
    const profile = LOAD_PROFILES[config.sync.loadProfile]
    const cutoff = Math.floor(Date.now() / 1000) - config.sync.lookbackHours * 60 * 60
    const chatIds = shuffled(config.selectedChatIds, this.random)
    let chatsInBatch = 0
    let batchSize = sampleInteger(profile.chatsPerBatch, this.random)

    this.state = 'syncing'
    this.message = 'Preparando a busca controlada de mensagens…'
    this.lastError = null
    this.warnings = []
    this.syncProgress = {
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
      this.assertSyncActive(client, control)
      const chat = this.chats.get(chatId)
      if (!chat) {
        this.syncProgress.skippedChats += 1
        this.operationalLog.add('warn', 'chat_missing', 'Conversa não encontrada no cache.', {
          position: chatIndex + 1,
          totalChats: chatIds.length,
        })
        continue
      }

      const priorState = this.database.getChatSyncState(chatId)
      const inCooldown =
        priorState !== null &&
        Date.now() - Date.parse(priorState.lastAttemptAt) < profile.automaticCooldownMs
      if (!options.forceRecent && inCooldown) {
        this.syncProgress.skippedChats += 1
        this.operationalLog.add('info', 'chat_skipped', 'Conversa ignorada por cooldown.', {
          chatName: operationalChatName(chat),
          position: chatIndex + 1,
          totalChats: chatIds.length,
        })
        continue
      }

      this.syncProgress.currentChatId = chatId
      this.syncProgress.currentChatName = chatDisplayName(chat)
      this.syncProgress.currentChatPosition = chatIndex + 1
      this.syncProgress.currentFetchedMessages = 0
      this.syncProgress.currentEligibleMessages = 0
      this.syncProgress.currentInsertedMessages = 0
      const chatStartedAt = Date.now()
      this.operationalLog.add('info', 'chat_started', 'Processamento da conversa iniciado.', {
        chatName: operationalChatName(chat),
        position: chatIndex + 1,
        totalChats: chatIds.length,
        messageLimit: config.sync.maxMessagesPerChat,
      })

      if (chatsInBatch >= batchSize) {
        this.message = 'Pausa de carga antes de continuar a fila…'
        await this.waitForPacing(profile.periodicPauseMs, client, control)
        chatsInBatch = 0
        batchSize = sampleInteger(profile.chatsPerBatch, this.random)
      }

      this.message = `Aguardando para consultar ${this.syncProgress.currentChatName}…`
      await this.waitForPacing(profile.betweenChatsMs, client, control)
      this.database.markChatSyncAttempt(chatId, new Date().toISOString())

      try {
        this.message = `Consultando ${this.syncProgress.currentChatName}…`
        await this.syncChat(chat, cutoff, config.sync.maxMessagesPerChat, profile, client, control)
        this.database.markChatSyncCompleted(chatId, new Date().toISOString())
        this.syncProgress.completedChats += 1
        chatsInBatch += 1
        this.operationalLog.add('info', 'chat_completed', 'Conversa processada.', {
          chatName: operationalChatName(chat),
          fetched: this.syncProgress.currentFetchedMessages,
          eligible: this.syncProgress.currentEligibleMessages,
          inserted: this.syncProgress.currentInsertedMessages,
          durationMs: Date.now() - chatStartedAt,
        })
      } catch (error) {
        if (error instanceof SyncInterruptedError) {
          this.database.markChatSyncCancelled(chatId)
          throw error
        }
        const failure = this.errorMessage(error)
        this.database.markChatSyncFailed(chatId, failure)
        this.syncProgress.failedChats += 1
        chatsInBatch += 1
        this.warnings.push(`${chatDisplayName(chat)}: ${failure}`)
        this.operationalLog.add('error', 'chat_failed', 'Falha ao processar conversa.', {
          chatName: operationalChatName(chat),
          durationMs: Date.now() - chatStartedAt,
        })
      } finally {
        this.syncProgress.currentChunkTarget = null
      }
    }

    this.assertSyncActive(client, control)
    this.lastSyncAt = new Date().toISOString()
    this.message = 'Sincronização concluída.'
    this.operationalLog.add('info', 'sync_completed', this.message, {
      completedChats: this.syncProgress.completedChats,
      skippedChats: this.syncProgress.skippedChats,
      failedChats: this.syncProgress.failedChats,
      fetched: this.syncProgress.totalFetchedMessages,
      eligible: this.syncProgress.totalEligibleMessages,
      inserted: this.syncProgress.totalInsertedMessages,
    })
  }

  private async syncChat(
    chat: WhatsAppChat,
    cutoff: number,
    maximum: number,
    profile: LoadProfileSettings,
    client: WhatsAppClient,
    control: SyncControl,
  ): Promise<void> {
    const checkpoint = this.database.getCheckpoint(chat.id._serialized)
    const seenMessageIds = new Set<string>()
    let target = Math.min(HISTORY_CHUNK_SIZE, maximum)

    while (true) {
      this.assertSyncActive(client, control)
      await this.waitUntilRunnable(control)
      this.assertSyncActive(client, control)
      this.syncProgress.currentChunkTarget = target
      const fetchStartedAt = Date.now()
      this.operationalLog.add('info', 'fetch_started', 'Busca de mensagens iniciada.', {
        chatName: operationalChatName(chat),
        target,
        messageLimit: maximum,
      })

      const messages = await this.readWithRetry(
        () => chat.fetchMessages({ limit: target }),
        profile.readRetry,
        client,
        this.clientAbortController?.signal,
        control,
        `Consultando ${operationalChatName(chat)}`,
      )
      this.assertSyncActive(client, control)
      let pageFetched = 0
      let pageEligible = 0
      let pageInserted = 0

      for (const item of messages) {
        this.assertSyncActive(client, control)
        const messageId = item.id._serialized
        if (seenMessageIds.has(messageId)) continue
        seenMessageIds.add(messageId)
        pageFetched += 1
        this.syncProgress.currentFetchedMessages += 1
        this.syncProgress.totalFetchedMessages += 1
        if (item.timestamp < cutoff) continue
        const outcome = await this.persistMessage(item, chat)
        if (outcome === 'ignored') continue
        pageEligible += 1
        this.syncProgress.currentEligibleMessages += 1
        this.syncProgress.totalEligibleMessages += 1
        if (outcome === 'inserted') {
          pageInserted += 1
          this.syncProgress.currentInsertedMessages += 1
          this.syncProgress.totalInsertedMessages += 1
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
        this.warnings.push(
          `${chatDisplayName(chat)}: pode haver uma lacuna anterior às ${maximum} mensagens recuperadas.`,
        )
      }
      if (decision.stop) return

      this.message = `Pausa antes do próximo bloco de ${chatDisplayName(chat)}…`
      await this.waitForPacing(profile.betweenChunksMs, client, control)
      target = Math.min(target + HISTORY_CHUNK_SIZE, maximum)
    }
  }

  private async waitForPacing(
    range: GaussianRange,
    client: WhatsAppClient,
    control: SyncControl,
  ): Promise<void> {
    await this.waitForControlledDelay(() => sampleMilliseconds(range, this.random), client, control)
  }

  private async readWithRetry<T>(
    operation: () => Promise<T>,
    policy: BackoffPolicy,
    client: WhatsAppClient,
    signal: AbortSignal | undefined,
    control: SyncControl | null,
    label: string,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      if (control) await this.waitUntilRunnable(control)
      this.assertReadActive(client, signal, control)

      try {
        return await operation()
      } catch (error) {
        this.assertReadActive(client, signal, control)
        if (attempt >= policy.maxRetries) throw error

        const retryNumber = attempt + 1
        this.message = `${label} falhou. Nova tentativa ${retryNumber}/${policy.maxRetries} após uma pausa…`
        const sampleDelay = () => {
          const delay = sampleExponentialBackoff(policy, attempt, this.random)
          this.operationalLog.add('warn', 'read_retry', this.message, {
            retry: retryNumber,
            maxRetries: policy.maxRetries,
            delayMs: delay,
          })
          return delay
        }
        if (control) {
          await this.waitForControlledDelay(sampleDelay, client, control)
        } else {
          await this.waitForClientDelay(sampleDelay(), client, signal)
        }
      }
    }
  }

  private async waitForControlledDelay(
    milliseconds: () => number,
    client: WhatsAppClient,
    control: SyncControl,
  ): Promise<void> {
    while (true) {
      await this.waitUntilRunnable(control)
      this.assertSyncActive(client, control)
      const duration = milliseconds()
      this.syncProgress.nextActionAt = new Date(Date.now() + duration).toISOString()

      const completed = await new Promise<boolean>((resolve) => {
        this.delayResolve = resolve
        this.delayTimer = setTimeout(() => resolve(true), duration)
      })

      this.clearDelay()
      if (completed && !control.paused) {
        this.assertSyncActive(client, control)
        return
      }
    }
  }

  private async waitForClientDelay(
    milliseconds: number,
    client: WhatsAppClient,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    this.syncProgress.nextActionAt = new Date(Date.now() + milliseconds).toISOString()
    try {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer)
          reject(new SyncInterruptedError())
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }, milliseconds)

        if (signal?.aborted) onAbort()
        else signal?.addEventListener('abort', onAbort, { once: true })
      })
    } finally {
      this.syncProgress.nextActionAt = null
    }
    this.assertReadActive(client, signal, null)
  }

  private async waitUntilRunnable(control: SyncControl): Promise<void> {
    while (control.paused && !control.cancelled) {
      await new Promise<void>((resolve) => {
        this.pauseResolve = resolve
      })
    }
  }

  private assertSyncActive(client: WhatsAppClient, control: SyncControl): void {
    if (control.cancelled || this.client !== client) throw new SyncInterruptedError()
  }

  private assertReadActive(
    client: WhatsAppClient,
    signal: AbortSignal | undefined,
    control: SyncControl | null,
  ): void {
    if (signal?.aborted || this.client !== client || control?.cancelled) {
      throw new SyncInterruptedError()
    }
  }

  private finishSync(client: WhatsAppClient, control: SyncControl): void {
    if (this.syncControl !== control) return
    const wasCancelled = control.cancelled
    if (wasCancelled) {
      this.operationalLog.add('warn', 'sync_cancelled', 'Sincronização cancelada pelo usuário.')
    }
    this.clearDelay()
    this.pauseResolve?.()
    this.pauseResolve = null
    this.syncControl = null
    this.syncPromise = null
    this.syncProgress = createIdleSyncProgress()

    if (this.client === client && this.state === 'syncing') {
      this.state = 'ready'
      if (wasCancelled)
        this.message = 'Sincronização cancelada. Os dados já coletados foram mantidos.'
    }

    this.startPendingAutomaticSync(client)
  }

  private startPendingAutomaticSync(client: WhatsAppClient): void {
    if (!this.pendingAutomaticSync || this.client !== client || this.state !== 'ready') return
    this.pendingAutomaticSync = false
    queueMicrotask(() => {
      if (this.client === client && this.state === 'ready') {
        this.syncSelected({ trigger: 'automatic', forceRecent: false })
      }
    })
  }

  private signalSyncCancellation(): void {
    if (!this.syncControl) return
    this.syncControl.cancelled = true
    this.syncControl.paused = false
    this.interruptDelay()
    this.pauseResolve?.()
    this.pauseResolve = null
  }

  private interruptDelay(): void {
    if (this.delayTimer) clearTimeout(this.delayTimer)
    this.delayTimer = null
    const resolve = this.delayResolve
    this.delayResolve = null
    resolve?.(false)
    this.syncProgress.nextActionAt = null
  }

  private clearDelay(): void {
    if (this.delayTimer) clearTimeout(this.delayTimer)
    this.delayTimer = null
    this.delayResolve = null
    this.syncProgress.nextActionAt = null
  }

  private async handleRealtimeMessage(message: WhatsAppMessage): Promise<void> {
    const chatId = message.fromMe ? message.to : message.from
    if (!this.configStore.get().selectedChatIds.includes(chatId)) return

    let chat = this.chats.get(chatId)
    if (!chat) {
      chat = await message.getChat()
      if (!this.chatType(chat)) return
      this.chats.set(chatId, chat)
    }

    await this.persistMessage(message, chat)
  }

  private async persistMessage(
    message: WhatsAppMessage,
    chat: WhatsAppChat,
  ): Promise<PersistOutcome> {
    const normalized = normalizeMessage({
      id: message.id._serialized,
      body: message.body,
      type: message.type,
      hasMedia: message.hasMedia,
      timestamp: message.timestamp,
    })
    const chatType = this.chatType(chat)
    if (!normalized || !chatType) return 'ignored'

    const record: MessageRecord = {
      chatId: chat.id._serialized,
      chatName: chatDisplayName(chat),
      chatType,
      messageId: normalized.messageId,
      author: await this.resolveAuthor(message),
      timestamp: normalized.timestamp,
      text: normalized.text,
    }

    if (!this.database.saveMessage(record, normalized.timestampUnix)) return 'duplicate'
    this.collectedMessages += 1
    return 'inserted'
  }

  private async resolveAuthor(message: WhatsAppMessage): Promise<string> {
    if (message.fromMe) return this.client?.info?.pushname || 'Você'

    const authorId = message.author || message.from
    const cached = this.authors.get(authorId)
    if (cached) return cached

    try {
      const contact = await message.getContact()
      const name = contact.name || contact.pushname || contact.number || contact.id._serialized
      this.authors.set(authorId, name)
      return name
    } catch {
      return authorId
    }
  }

  private chatType(chat: WhatsAppChat): ChatType | null {
    if (chat.isGroup) return 'group'
    if (CONTACT_SERVERS.has(chat.id.server)) return 'contact'
    return null
  }

  private toSummary(
    chat: WhatsAppChat,
    selectedChatIds: string[],
    chatTags: Record<string, string[]>,
  ): ChatSummary | null {
    const type = this.chatType(chat)
    if (!type) return null
    const id = chat.id._serialized
    const contact = type === 'contact' ? this.contactMetadata.get(id) : undefined
    return {
      id,
      name: contact?.name || chatDisplayName(chat),
      type,
      phoneNumber: contact?.phoneNumber ?? null,
      isSavedContact: contact?.isSavedContact ?? false,
      isBusiness: contact?.isBusiness ?? false,
      tags: chatTags[id] ?? [],
      selected: selectedChatIds.includes(id),
    }
  }

  private cacheContactMetadata(contact: WhatsAppContact): void {
    if (contact.isGroup || !CONTACT_SERVERS.has(contact.id.server)) return
    const name =
      contact.name ||
      contact.verifiedName ||
      contact.pushname ||
      contact.shortName ||
      contact.number
    this.contactMetadata.set(contact.id._serialized, {
      name,
      phoneNumber: contact.number,
      isSavedContact: contact.isMyContact,
      isBusiness: contact.isBusiness,
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.state === 'invalid_session' || this.state === 'stopped') return
    this.clientAbortController?.abort()
    const delay = sampleExponentialBackoff(RECONNECT_BACKOFF, this.reconnectAttempt, this.random)
    this.reconnectAttempt += 1
    this.state = 'reconnecting'
    this.message = `Conexão perdida. Nova tentativa em aproximadamente ${Math.ceil(delay / 1000)}s.`
    this.operationalLog.add('warn', 'reconnect_scheduled', this.message, {
      attempt: this.reconnectAttempt,
      delayMs: delay,
    })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.destroyClient().finally(() => this.createClient('reconnecting'))
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private async destroyClient(): Promise<void> {
    this.signalSyncCancellation()
    const client = this.client
    this.client = null
    this.clientAbortController?.abort()
    this.clientAbortController = null
    this.refreshPromise = null
    if (!client) return
    try {
      await client.destroy()
    } catch {
      // The browser may already have been closed by whatsapp-web.js.
    }
  }

  private recordRecoverableError(error: unknown): void {
    this.lastError = this.errorMessage(error)
    if (this.state === 'ready') this.message = 'Conectado, mas a última operação falhou.'
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
