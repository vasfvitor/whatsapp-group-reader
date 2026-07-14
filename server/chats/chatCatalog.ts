import type WAWebJSTypes from 'whatsapp-web.js'
import type { ChatSummary, ChatType } from '../../shared/contracts.js'

export type WhatsAppChat = WAWebJSTypes.Chat
export type WhatsAppContact = WAWebJSTypes.Contact

interface ContactMetadata {
  name: string
  phoneNumber: string
  isSavedContact: boolean
  isBusiness: boolean
}

const CONTACT_SERVERS = new Set(['c.us', 'lid', 's.whatsapp.net'])

export function chatType(chat: WhatsAppChat): ChatType | null {
  if (chat.isGroup) return 'group'
  return CONTACT_SERVERS.has(chat.id.server) ? 'contact' : null
}
export function chatDisplayName(chat: WhatsAppChat): string {
  return chat.name || chat.id.user
}
export function operationalChatName(chat: WhatsAppChat): string {
  const name = chat.name?.trim()
  const looksLikePhoneNumber = name && /^\+?[\d\s().-]{7,}$/.test(name)
  if (name && !looksLikePhoneNumber) return name
  return chat.isGroup ? 'Grupo sem nome' : 'Contato sem nome'
}

export class ChatCatalog {
  private readonly chats = new Map<string, WhatsAppChat>()
  private readonly contacts = new Map<string, ContactMetadata>()

  get size(): number {
    return this.chats.size
  }
  get(chatId: string): WhatsAppChat | undefined {
    return this.chats.get(chatId)
  }
  set(chat: WhatsAppChat): void {
    if (chatType(chat)) this.chats.set(chat.id._serialized, chat)
  }
  replace(chats: WhatsAppChat[], contacts: WhatsAppContact[]): void {
    this.chats.clear()
    this.contacts.clear()
    for (const contact of contacts) this.cacheContact(contact)
    for (const chat of chats) this.set(chat)
  }
  list(selectedChatIds: string[], chatTags: Record<string, string[]>): ChatSummary[] {
    return [...this.chats.values()]
      .map((chat) => this.toSummary(chat, selectedChatIds, chatTags))
      .filter((chat): chat is ChatSummary => chat !== null)
      .sort((left, right) =>
        left.type !== right.type
          ? left.type === 'group'
            ? -1
            : 1
          : left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' }),
      )
  }
  private toSummary(
    chat: WhatsAppChat,
    selected: string[],
    tags: Record<string, string[]>,
  ): ChatSummary | null {
    const type = chatType(chat)
    if (!type) return null
    const id = chat.id._serialized
    const contact = type === 'contact' ? this.contacts.get(id) : undefined
    return {
      id,
      name: contact?.name || chatDisplayName(chat),
      type,
      phoneNumber: contact?.phoneNumber ?? null,
      isSavedContact: contact?.isSavedContact ?? false,
      isBusiness: contact?.isBusiness ?? false,
      tags: tags[id] ?? [],
      selected: selected.includes(id),
    }
  }
  private cacheContact(contact: WhatsAppContact): void {
    if (contact.isGroup || !CONTACT_SERVERS.has(contact.id.server)) return
    this.contacts.set(contact.id._serialized, {
      name:
        contact.name ||
        contact.verifiedName ||
        contact.pushname ||
        contact.shortName ||
        contact.number,
      phoneNumber: contact.number,
      isSavedContact: contact.isMyContact,
      isBusiness: contact.isBusiness,
    })
  }
}
