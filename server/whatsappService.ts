import { rm } from 'node:fs/promises'
import QRCode from 'qrcode'
import WhatsAppWeb from 'whatsapp-web.js'
import type WAWebJSTypes from 'whatsapp-web.js'
import type {
  AppStatus,
  ChatSummary,
  ChatType,
  ConnectionState,
  MessageRecord,
} from '../shared/contracts.js'
import type { ConfigStore } from './configStore.js'
import type { MessageDatabase } from './database.js'
import { normalizeMessage } from './messageNormalizer.js'

const { Client, LocalAuth } = WhatsAppWeb

type WhatsAppClient = WAWebJSTypes.Client
type WhatsAppChat = WAWebJSTypes.Chat
type WhatsAppMessage = WAWebJSTypes.Message

const RECONNECT_DELAYS = [2_000, 5_000, 10_000, 30_000, 60_000]
const CONTACT_SERVERS = new Set(['c.us', 'lid', 's.whatsapp.net'])

export class WhatsAppService {
  private client: WhatsAppClient | null = null
  private readonly chats = new Map<string, WhatsAppChat>()
  private readonly authors = new Map<string, string>()
  private state: ConnectionState = 'stopped'
  private qrDataUrl: string | null = null
  private message = 'Aplicação iniciada.'
  private lastError: string | null = null
  private lastSyncAt: string | null = null
  private collectedMessages: number
  private warnings: string[] = []
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private syncPromise: Promise<void> | null = null

  constructor(
    private readonly configStore: ConfigStore,
    private readonly database: MessageDatabase,
    private readonly authDirectory: string,
    private readonly dataDirectory: string,
  ) {
    this.collectedMessages = database.countMessages()
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
    }
  }

  async getChats(refresh = false): Promise<ChatSummary[]> {
    if (refresh) await this.refreshChats()
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
    if (this.state === 'ready') {
      void this.syncSelected().catch((error: unknown) => this.recordRecoverableError(error))
    }
  }

  async syncSelected(): Promise<void> {
    if (this.syncPromise) return this.syncPromise
    if (!this.client || (this.state !== 'ready' && this.state !== 'syncing')) {
      throw new Error('O WhatsApp ainda não está pronto para sincronizar.')
    }

    this.syncPromise = this.performSync().finally(() => {
      this.syncPromise = null
    })
    return this.syncPromise
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
  }

  private createClient(initialState: ConnectionState): void {
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
        .then(() => this.syncSelected())
        .catch((error: unknown) => this.recordRecoverableError(error))
    })

    client.on('auth_failure', (reason: string) => {
      if (this.client !== client) return
      this.qrDataUrl = null
      this.state = 'invalid_session'
      this.message = 'A sessão salva não é mais válida.'
      this.lastError = reason
    })

    client.on('disconnected', (reason: string) => {
      if (this.client !== client) return
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

  private async refreshChats(): Promise<void> {
    if (!this.client || (this.state !== 'ready' && this.state !== 'syncing')) return
    const chats = await this.client.getChats()
    this.chats.clear()
    for (const chat of chats) {
      if (this.chatType(chat)) this.chats.set(chat.id._serialized, chat)
    }
  }

  private async performSync(): Promise<void> {
    const client = this.client
    if (!client) return

    const config = this.configStore.get()
    const cutoff = Math.floor(Date.now() / 1000) - config.sync.lookbackHours * 60 * 60
    this.state = 'syncing'
    this.message = 'Buscando mensagens recentes dos chats selecionados…'
    this.warnings = []

    try {
      for (const chatId of config.selectedChatIds) {
        if (this.client !== client) return
        const chat = this.chats.get(chatId)
        if (!chat) continue

        const checkpoint = this.database.getCheckpoint(chatId)
        const messages = await chat.fetchMessages({ limit: config.sync.maxMessagesPerChat })

        if (
          checkpoint &&
          messages.length === config.sync.maxMessagesPerChat &&
          !messages.some((item) => item.id._serialized === checkpoint.lastMessageId) &&
          (messages[0]?.timestamp ?? 0) > checkpoint.lastTimestampUnix
        ) {
          this.warnings.push(
            `${chat.name}: pode haver uma lacuna anterior às ${config.sync.maxMessagesPerChat} mensagens recuperadas.`,
          )
        }

        for (const item of messages) {
          if (item.timestamp < cutoff) continue
          await this.persistMessage(item, chat)
        }
      }

      this.lastSyncAt = new Date().toISOString()
      this.message = 'Sincronização concluída.'
    } finally {
      if (this.client === client && this.state === 'syncing') this.state = 'ready'
    }
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

  private async persistMessage(message: WhatsAppMessage, chat: WhatsAppChat): Promise<void> {
    const normalized = normalizeMessage({
      id: message.id._serialized,
      body: message.body,
      type: message.type,
      hasMedia: message.hasMedia,
      timestamp: message.timestamp,
    })
    const chatType = this.chatType(chat)
    if (!normalized || !chatType) return

    const record: MessageRecord = {
      chatId: chat.id._serialized,
      chatName: chat.name || chat.id.user,
      chatType,
      messageId: normalized.messageId,
      author: await this.resolveAuthor(message),
      timestamp: normalized.timestamp,
      text: normalized.text,
    }

    if (this.database.saveMessage(record, normalized.timestampUnix)) this.collectedMessages += 1
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
    return {
      id,
      name: chat.name || chat.id.user,
      type,
      tags: chatTags[id] ?? [],
      selected: selectedChatIds.includes(id),
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.state === 'invalid_session' || this.state === 'stopped') return
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)]!
    this.reconnectAttempt += 1
    this.state = 'reconnecting'
    this.message = `Conexão perdida. Nova tentativa em ${delay / 1000}s.`
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
