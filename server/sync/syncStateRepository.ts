import type { DatabaseSync } from 'node:sqlite'

export type ChatSyncStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export interface ChatSyncState {
  chatId: string
  lastAttemptAt: string
  lastCompletedAt: string | null
  lastStatus: ChatSyncStatus
  lastError: string | null
}

export class SyncStateRepository {
  constructor(private readonly database: DatabaseSync) {}
  get(chatId: string): ChatSyncState | null {
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
  markAttempt(chatId: string, at: string): void {
    this.database
      .prepare(
        `INSERT INTO chat_sync_state (chat_id, last_attempt_at, last_status, last_error)
      VALUES (?, ?, 'running', NULL) ON CONFLICT(chat_id) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at, last_status = 'running', last_error = NULL`,
      )
      .run(chatId, at)
  }
  markCompleted(chatId: string, at: string): void {
    this.database
      .prepare(
        `UPDATE chat_sync_state SET last_completed_at = ?, last_status = 'completed',
      last_error = NULL WHERE chat_id = ?`,
      )
      .run(at, chatId)
  }
  markFailed(chatId: string, error: string): void {
    this.database
      .prepare(
        `UPDATE chat_sync_state SET last_status = 'failed', last_error = ? WHERE chat_id = ?`,
      )
      .run(error, chatId)
  }
  markCancelled(chatId: string): void {
    this.database
      .prepare(
        `UPDATE chat_sync_state SET last_status = 'cancelled', last_error = NULL WHERE chat_id = ?`,
      )
      .run(chatId)
  }
}
