import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { MESSAGE_PREVIEW_LIMIT, type ChatType, type MessageRecord } from '../../shared/contracts.js'

interface MessageRow {
  message_id: string
  chat_id: string
  chat_name: string
  chat_type: ChatType
  author: string
  timestamp_utc: string
  text: string
}
export interface Checkpoint {
  chatId: string
  lastTimestampUnix: number
  lastMessageId: string
}
export interface MessageQuery {
  fromUnix: number
  toUnix: number
  limitPerChat: number
  chatIds: string[]
}

function toRecord(row: MessageRow): MessageRecord {
  return {
    chatId: row.chat_id,
    chatName: row.chat_name,
    chatType: row.chat_type,
    messageId: row.message_id,
    author: row.author,
    timestamp: row.timestamp_utc,
    text: row.text,
  }
}

export class MessageRepository {
  private readonly saveTransaction: (record: MessageRecord, timestampUnix: number) => boolean
  private readonly checkpointStatement: StatementSync
  private readonly countStatement: StatementSync
  private readonly previewStatement: StatementSync

  constructor(private readonly database: DatabaseSync) {
    const insert = database.prepare(`INSERT OR IGNORE INTO messages (
      message_id, chat_id, chat_name, chat_type, author, timestamp_utc, timestamp_unix, text
    ) VALUES (@messageId, @chatId, @chatName, @chatType, @author, @timestamp, @timestampUnix, @text)`)
    const checkpoint =
      database.prepare(`INSERT INTO checkpoints (chat_id, last_timestamp_unix, last_message_id)
      VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET
      last_timestamp_unix = excluded.last_timestamp_unix, last_message_id = excluded.last_message_id,
      updated_at = CURRENT_TIMESTAMP WHERE excluded.last_timestamp_unix >= checkpoints.last_timestamp_unix`)
    // node:sqlite não tem o helper transaction() do better-sqlite3
    this.saveTransaction = (record: MessageRecord, timestampUnix: number) => {
      database.exec('BEGIN')
      try {
        const result = insert.run({ ...record, timestampUnix })
        checkpoint.run(record.chatId, timestampUnix, record.messageId)
        database.exec('COMMIT')
        return result.changes === 1
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    }
    this.checkpointStatement = database.prepare(
      `SELECT chat_id, last_timestamp_unix, last_message_id FROM checkpoints WHERE chat_id = ?`,
    )
    this.countStatement = database.prepare('SELECT COUNT(*) AS count FROM messages')
    this.previewStatement = database.prepare(
      `SELECT message_id, chat_id, chat_name, chat_type, author, timestamp_utc, text
      FROM messages WHERE chat_id = ? ORDER BY timestamp_unix DESC, message_id DESC LIMIT ?`,
    )
  }

  save(record: MessageRecord, timestampUnix: number): boolean {
    return this.saveTransaction(record, timestampUnix)
  }
  getCheckpoint(chatId: string): Checkpoint | null {
    const row = this.checkpointStatement.get(chatId) as
      | { chat_id: string; last_timestamp_unix: number; last_message_id: string }
      | undefined
    return row
      ? {
          chatId: row.chat_id,
          lastTimestampUnix: row.last_timestamp_unix,
          lastMessageId: row.last_message_id,
        }
      : null
  }
  count(): number {
    return (this.countStatement.get() as { count: number }).count
  }
  query(options: MessageQuery): MessageRecord[] {
    if (options.chatIds.length === 0) return []
    const placeholders = options.chatIds.map(() => '?').join(', ')
    const rows = this.database
      .prepare(
        `WITH ranked AS (
      SELECT message_id, chat_id, chat_name, chat_type, author, timestamp_utc, timestamp_unix, text,
      ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY timestamp_unix DESC, message_id DESC) AS message_rank
      FROM messages WHERE timestamp_unix BETWEEN ? AND ? AND chat_id IN (${placeholders})
    ) SELECT message_id, chat_id, chat_name, chat_type, author, timestamp_utc, text FROM ranked
      WHERE message_rank <= ? ORDER BY timestamp_utc ASC, message_id ASC`,
      )
      .all(
        options.fromUnix,
        options.toUnix,
        ...options.chatIds,
        options.limitPerChat,
      ) as unknown as MessageRow[]
    return rows.map(toRecord)
  }
  preview(chatId: string, limit = MESSAGE_PREVIEW_LIMIT): MessageRecord[] {
    const rows = this.previewStatement.all(chatId, limit) as unknown as MessageRow[]
    return rows.map(toRecord)
  }
}
