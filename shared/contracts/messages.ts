import { z } from 'zod'
import type { ChatType } from './chats.js'

export const messagePreviewQuerySchema = z.object({ chatId: z.string().min(1) })

export const MESSAGE_PREVIEW_LIMIT = 20

export interface MessageRecord {
  chatId: string
  chatName: string
  chatType: ChatType
  messageId: string
  author: string
  timestamp: string
  text: string
}

export interface MessagePreviewResponse {
  messages: MessageRecord[]
}
