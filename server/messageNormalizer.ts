export interface ReadableMessage {
  id: string
  body: string
  type: string
  hasMedia: boolean
  timestamp: number
}

export interface NormalizedMessage {
  messageId: string
  text: string
  timestamp: string
  timestampUnix: number
}

export function normalizeMessage(message: ReadableMessage): NormalizedMessage | null {
  const text = message.body.trim()
  const isText = message.type === 'chat'
  const isMediaCaption = message.hasMedia && text.length > 0

  if (!message.id || !Number.isFinite(message.timestamp) || text.length === 0) return null
  if (!isText && !isMediaCaption) return null

  return {
    messageId: message.id,
    text,
    timestamp: new Date(message.timestamp * 1000).toISOString(),
    timestampUnix: message.timestamp,
  }
}
