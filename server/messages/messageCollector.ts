import type WAWebJSTypes from 'whatsapp-web.js'
import type { MessageRecord } from '../../shared/contracts.js'
import type { MessageRepository } from './messageRepository.js'
import { normalizeMessage } from '../messageNormalizer.js'
import { chatDisplayName, chatType, type WhatsAppChat } from '../chats/chatCatalog.js'

type WhatsAppClient = WAWebJSTypes.Client
type WhatsAppMessage = WAWebJSTypes.Message
export type PersistOutcome = 'ignored' | 'duplicate' | 'inserted'

export class MessageCollector {
  private readonly authors = new Map<string, string>()
  private total: number

  constructor(private readonly messages: MessageRepository) {
    this.total = messages.count()
  }
  get count(): number {
    return this.total
  }
  async persist(
    message: WhatsAppMessage,
    chat: WhatsAppChat,
    client: WhatsAppClient | null,
  ): Promise<PersistOutcome> {
    const normalized = normalizeMessage({
      id: message.id._serialized,
      body: message.body,
      type: message.type,
      hasMedia: message.hasMedia,
      timestamp: message.timestamp,
    })
    const type = chatType(chat)
    if (!normalized || !type) return 'ignored'
    const record: MessageRecord = {
      chatId: chat.id._serialized,
      chatName: chatDisplayName(chat),
      chatType: type,
      messageId: normalized.messageId,
      author: await this.resolveAuthor(message, client),
      timestamp: normalized.timestamp,
      text: normalized.text,
    }
    if (!this.messages.save(record, normalized.timestampUnix)) return 'duplicate'
    this.total += 1
    return 'inserted'
  }
  private async resolveAuthor(
    message: WhatsAppMessage,
    client: WhatsAppClient | null,
  ): Promise<string> {
    if (message.fromMe) return client?.info?.pushname || 'Você'
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
}
