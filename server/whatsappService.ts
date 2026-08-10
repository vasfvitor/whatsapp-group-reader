import { rm } from 'node:fs/promises'
import QRCode from 'qrcode'
import WhatsAppWeb from 'whatsapp-web.js'
import type WAWebJSTypes from 'whatsapp-web.js'
import type { AppStatus, ChatSummary, ConnectionState } from '../shared/contracts.js'
import { isChatAuthorized } from '../shared/configRules.js'
import type { ConfigStore } from './configStore.js'
import type { AppDatabase } from './database.js'
import {
  cryptoRandomSource,
  LOAD_PROFILES,
  RECONNECT_BACKOFF,
  sampleExponentialBackoff,
  withReadRetry,
  type BackoffPolicy,
  type RandomSource,
} from './loadControl.js'
import { OperationalLogBuffer } from './operationalLog.js'
import { ChatCatalog, type WhatsAppContact } from './chats/chatCatalog.js'
import { MessageCollector } from './messages/messageCollector.js'
import {
  abortableDelay,
  SyncEngine,
  SyncInterruptedError,
  type SyncOptions,
} from './sync/syncEngine.js'

const { Client, LocalAuth } = WhatsAppWeb

type WhatsAppClient = WAWebJSTypes.Client
type WhatsAppMessage = WAWebJSTypes.Message

export class WhatsAppService {
  private client: WhatsAppClient | null = null
  private clientAbortController: AbortController | null = null
  private readonly chatCatalog = new ChatCatalog()
  private readonly messageCollector: MessageCollector
  private readonly operationalLog: OperationalLogBuffer
  private readonly syncEngine: SyncEngine
  private state: ConnectionState = 'stopped'
  private qrDataUrl: string | null = null
  private message = 'Aplicação iniciada.'
  private lastError: string | null = null
  private lastSyncAt: string | null = null
  private warnings: string[] = []
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private refreshPromise: Promise<void> | null = null
  private pendingAutomaticSync = false

  constructor(
    private readonly configStore: ConfigStore,
    database: AppDatabase,
    private readonly authDirectory: string,
    private readonly dataDirectory: string,
    private readonly random: RandomSource = cryptoRandomSource,
  ) {
    this.messageCollector = new MessageCollector(database.messages)
    this.operationalLog = new OperationalLogBuffer(database.logs)
    this.syncEngine = new SyncEngine({
      configStore,
      messages: database.messages,
      syncStates: database.syncStates,
      chatCatalog: this.chatCatalog,
      messageCollector: this.messageCollector,
      operationalLog: this.operationalLog,
      random,
      notify: (message) => {
        this.message = message
      },
      warn: (warning) => {
        this.warnings.push(warning)
      },
    })
  }

  start(): void {
    this.operationalLog.start()
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
      collectedMessages: this.messageCollector.count,
      selectedChats: this.configStore.get().selectedChatIds.length,
      dataDirectory: this.dataDirectory,
      warnings: [...this.warnings],
      syncProgress: { ...this.syncEngine.progress },
    }
  }

  getOperationalLog(after = 0) {
    return this.operationalLog.read(after)
  }

  async getChats(refresh = false): Promise<ChatSummary[]> {
    if (refresh && !this.syncEngine.running) await this.refreshChats()
    const config = this.configStore.get()

    return this.chatCatalog.list(config.selectedChatIds, config.chatTags)
  }

  onConfigUpdated(): void {
    if (this.state === 'ready' || this.state === 'syncing') {
      this.syncSelected({ trigger: 'automatic', forceRecent: false })
    }
  }

  syncSelected(options: SyncOptions): boolean {
    if (this.syncEngine.running) {
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
    if (!this.client || !this.clientAbortController || this.state !== 'ready') {
      throw new Error('O WhatsApp ainda não está pronto para sincronizar.')
    }

    const client = this.client
    this.state = 'syncing'
    this.lastError = null
    this.warnings = []
    void this.syncEngine
      .run(client, this.clientAbortController.signal, options)
      .then((outcome) => {
        if (outcome.status === 'completed') this.lastSyncAt = new Date().toISOString()
        if (outcome.status === 'failed') {
          this.lastError = outcome.error
          this.message = 'A sincronização foi interrompida por um erro inesperado.'
          this.operationalLog.add('error', 'sync_failed', this.message)
        }
        if (this.client === client && this.state === 'syncing') {
          this.state = 'ready'
          if (outcome.status === 'cancelled') {
            this.message = 'Sincronização cancelada. Os dados já coletados foram mantidos.'
          }
        }
        this.startPendingAutomaticSync(client)
      })
    return true
  }

  pauseSync(): void {
    this.syncEngine.pause()
  }

  resumeSync(): void {
    this.syncEngine.resume()
  }

  cancelSync(): void {
    if (!this.syncEngine.running) return
    this.pendingAutomaticSync = false
    this.syncEngine.cancel()
    this.message = 'Cancelando sincronização após a operação atual…'
  }

  async resetSession(): Promise<void> {
    this.clearReconnectTimer()
    await this.destroyClient()
    await rm(this.authDirectory, { recursive: true, force: true, maxRetries: 4 })
    this.reconnectAttempt = 0
    this.qrDataUrl = null
    this.lastError = null
    this.createClient('starting')
  }

  async stop(): Promise<void> {
    this.clearReconnectTimer()
    this.state = 'stopped'
    await this.destroyClient()
    this.operationalLog.close()
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
      this.qrDataUrl = null
      this.state = 'invalid_session'
      this.message = 'A sessão salva não é mais válida.'
      this.lastError = reason
    })

    client.on('disconnected', (reason: string) => {
      if (this.client !== client) return
      abortController.abort()
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
    if (
      !this.client ||
      !this.clientAbortController ||
      (this.state !== 'ready' && this.state !== 'syncing')
    ) {
      return Promise.resolve()
    }
    if (this.refreshPromise) return this.refreshPromise

    const client = this.client
    const signal = this.clientAbortController.signal
    const profile = LOAD_PROFILES[this.configStore.get().sync.loadProfile]
    const refresh = this.refreshRead(
      () => client.getChats(),
      profile.readRetry,
      signal,
      'Atualizando a lista de conversas',
    ).then(async (chats) => {
      let contacts: WhatsAppContact[] = []
      try {
        contacts = await this.refreshRead(
          () => client.getContacts(),
          profile.readRetry,
          signal,
          'Atualizando os nomes dos contatos',
        )
      } catch {
        if (signal.aborted) throw new SyncInterruptedError()
        this.operationalLog.add(
          'warn',
          'contact_metadata_unavailable',
          'Nomes dos contatos indisponíveis; mantendo os números da lista.',
        )
      }
      if (signal.aborted) throw new SyncInterruptedError()
      this.chatCatalog.replace(chats, contacts)
      if (this.state === 'ready') this.message = 'Lista de conversas atualizada.'
      this.operationalLog.add('info', 'chats_refreshed', 'Lista de conversas atualizada.', {
        chats: this.chatCatalog.size,
      })
    })

    this.refreshPromise = refresh.finally(() => {
      this.refreshPromise = null
      this.startPendingAutomaticSync(client)
    })
    return this.refreshPromise
  }

  private refreshRead<T>(
    operation: () => Promise<T>,
    policy: BackoffPolicy,
    signal: AbortSignal,
    label: string,
  ): Promise<T> {
    return withReadRetry(operation, policy, {
      guard: () => {
        if (signal.aborted) throw new SyncInterruptedError()
      },
      delay: (attempt) => {
        const retryNumber = attempt + 1
        this.message = `${label} falhou. Nova tentativa ${retryNumber}/${policy.maxRetries} após uma pausa…`
        const delay = sampleExponentialBackoff(policy, attempt, this.random)
        this.operationalLog.add('warn', 'read_retry', this.message, {
          retry: retryNumber,
          maxRetries: policy.maxRetries,
          delayMs: delay,
        })
        return abortableDelay(delay, signal)
      },
    })
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

  private async handleRealtimeMessage(message: WhatsAppMessage): Promise<void> {
    const chatId = message.fromMe ? message.to : message.from
    if (!isChatAuthorized(this.configStore.get(), chatId)) return

    let chat = this.chatCatalog.get(chatId)
    if (!chat) {
      chat = await message.getChat()
      if (!this.chatCatalog.set(chat)) return
    }

    await this.messageCollector.persist(message, chat, this.client)
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
