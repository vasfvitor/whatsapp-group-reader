import Database from 'better-sqlite3'
import type { ChatType, MessageRecord } from '../shared/contracts.js'

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

export type ChatSyncStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface ChatSyncState {
  chatId: string
  lastAttemptAt: string
  lastCompletedAt: string | null
  lastStatus: ChatSyncStatus
  lastError: string | null
}

export class MessageDatabase {
  private readonly database: Database.Database
  private readonly insertMessage: Database.Statement
  private readonly upsertCheckpoint: Database.Statement
  private readonly saveTransaction: (record: MessageRecord, timestampUnix: number) => boolean

  constructor(filePath: string) {
    this.database = new Database(filePath)
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('foreign_keys = ON')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        chat_type TEXT NOT NULL CHECK (chat_type IN ('group', 'contact')),
        author TEXT NOT NULL,
        timestamp_utc TEXT NOT NULL,
        timestamp_unix INTEGER NOT NULL,
        text TEXT NOT NULL,
        captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS messages_chat_timestamp
        ON messages (chat_id, timestamp_unix DESC);

      CREATE TABLE IF NOT EXISTS checkpoints (
        chat_id TEXT PRIMARY KEY,
        last_timestamp_unix INTEGER NOT NULL,
        last_message_id TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS chat_sync_state (
        chat_id TEXT PRIMARY KEY,
        last_attempt_at TEXT NOT NULL,
        last_completed_at TEXT,
        last_status TEXT NOT NULL CHECK (
          last_status IN ('running', 'completed', 'failed', 'cancelled')
        ),
        last_error TEXT
      );
    `)

    this.insertMessage = this.database.prepare(`
      INSERT OR IGNORE INTO messages (
        message_id, chat_id, chat_name, chat_type, author,
        timestamp_utc, timestamp_unix, text
      ) VALUES (
        @messageId, @chatId, @chatName, @chatType, @author,
        @timestamp, @timestampUnix, @text
      )
    `)

    this.upsertCheckpoint = this.database.prepare(`
      INSERT INTO checkpoints (chat_id, last_timestamp_unix, last_message_id)
      VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        last_timestamp_unix = excluded.last_timestamp_unix,
        last_message_id = excluded.last_message_id,
        updated_at = CURRENT_TIMESTAMP
      WHERE excluded.last_timestamp_unix >= checkpoints.last_timestamp_unix
    `)

    this.saveTransaction = this.database.transaction(
      (record: MessageRecord, timestampUnix: number): boolean => {
        const result = this.insertMessage.run({ ...record, timestampUnix })
        this.upsertCheckpoint.run(record.chatId, timestampUnix, record.messageId)
        return result.changes === 1
      },
    )
  }

  saveMessage(record: MessageRecord, timestampUnix: number): boolean {
    return this.saveTransaction(record, timestampUnix)
  }

  getCheckpoint(chatId: string): Checkpoint | null {
    const row = this.database
      .prepare(
        `SELECT chat_id, last_timestamp_unix, last_message_id
         FROM checkpoints WHERE chat_id = ?`,
      )
      .get(chatId) as
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

  getChatSyncState(chatId: string): ChatSyncState | null {
    const row = this.database
      .prepare(
        `SELECT chat_id, last_attempt_at, last_completed_at, last_status, last_error
         FROM chat_sync_state WHERE chat_id = ?`,
      )
      .get(chatId) as
      | {
          chat_id: string
          last_attempt_at: string
          last_completed_at: string | null
          last_status: ChatSyncStatus
          last_error: string | null
        }
      | undefined

    return row
      ? {
          chatId: row.chat_id,
          lastAttemptAt: row.last_attempt_at,
          lastCompletedAt: row.last_completed_at,
          lastStatus: row.last_status,
          lastError: row.last_error,
        }
      : null
  }

  markChatSyncAttempt(chatId: string, attemptedAt: string): void {
    this.database
      .prepare(
        `INSERT INTO chat_sync_state (chat_id, last_attempt_at, last_status, last_error)
         VALUES (?, ?, 'running', NULL)
         ON CONFLICT(chat_id) DO UPDATE SET
           last_attempt_at = excluded.last_attempt_at,
           last_status = 'running',
           last_error = NULL`,
      )
      .run(chatId, attemptedAt)
  }

  markChatSyncCompleted(chatId: string, completedAt: string): void {
    this.database
      .prepare(
        `UPDATE chat_sync_state SET
           last_completed_at = ?,
           last_status = 'completed',
           last_error = NULL
         WHERE chat_id = ?`,
      )
      .run(completedAt, chatId)
  }

  markChatSyncFailed(chatId: string, error: string): void {
    this.database
      .prepare(
        `UPDATE chat_sync_state SET last_status = 'failed', last_error = ? WHERE chat_id = ?`,
      )
      .run(error, chatId)
  }

  markChatSyncCancelled(chatId: string): void {
    this.database
      .prepare(
        `UPDATE chat_sync_state SET last_status = 'cancelled', last_error = NULL WHERE chat_id = ?`,
      )
      .run(chatId)
  }

  countMessages(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM messages').get() as {
      count: number
    }
    return row.count
  }

  queryMessages(options: {
    fromUnix: number
    toUnix: number
    limitPerChat: number
    chatIds: string[]
  }): MessageRecord[] {
    if (options.chatIds.length === 0) return []

    const placeholders = options.chatIds.map(() => '?').join(', ')
    const rows = this.database
      .prepare(
        `WITH ranked AS (
          SELECT
            message_id, chat_id, chat_name, chat_type, author,
            timestamp_utc, timestamp_unix, text,
            ROW_NUMBER() OVER (
              PARTITION BY chat_id
              ORDER BY timestamp_unix DESC, message_id DESC
            ) AS message_rank
          FROM messages
          WHERE timestamp_unix BETWEEN ? AND ?
            AND chat_id IN (${placeholders})
        )
        SELECT message_id, chat_id, chat_name, chat_type, author, timestamp_utc, text
        FROM ranked
        WHERE message_rank <= ?
        ORDER BY timestamp_utc ASC, message_id ASC`,
      )
      .all(
        options.fromUnix,
        options.toUnix,
        ...options.chatIds,
        options.limitPerChat,
      ) as MessageRow[]

    return rows.map((row) => ({
      chatId: row.chat_id,
      chatName: row.chat_name,
      chatType: row.chat_type,
      messageId: row.message_id,
      author: row.author,
      timestamp: row.timestamp_utc,
      text: row.text,
    }))
  }

  close(): void {
    this.database.close()
  }
}
