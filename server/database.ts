import type {
  MessageRecord,
  OperationalLogEntry,
  OperationalLogResponse,
} from '../shared/contracts.js'
import { SqliteDatabase } from './infrastructure/sqlite/sqliteDatabase.js'
import { MessageRepository, type Checkpoint } from './messages/messageRepository.js'
import { SyncStateRepository, type ChatSyncState } from './sync/syncStateRepository.js'
import { OperationalLogRepository } from './diagnostics/operationalLogRepository.js'

export type { Checkpoint, ChatSyncState }
export type ChatSyncStatus = ChatSyncState['lastStatus']

/** Compatibility facade while callers migrate to domain repositories. */
export class MessageDatabase {
  private readonly sqlite: SqliteDatabase
  private readonly messages: MessageRepository
  private readonly syncStates: SyncStateRepository
  private readonly logs: OperationalLogRepository

  constructor(filePath: string) {
    this.sqlite = new SqliteDatabase(filePath)
    this.messages = new MessageRepository(this.sqlite.connection)
    this.syncStates = new SyncStateRepository(this.sqlite.connection)
    this.logs = new OperationalLogRepository(this.sqlite.connection)
  }

  saveMessage(record: MessageRecord, timestampUnix: number): boolean {
    return this.messages.save(record, timestampUnix)
  }
  getCheckpoint(chatId: string): Checkpoint | null {
    return this.messages.getCheckpoint(chatId)
  }
  countMessages(): number {
    return this.messages.count()
  }
  queryMessages(options: Parameters<MessageRepository['query']>[0]): MessageRecord[] {
    return this.messages.query(options)
  }
  previewMessages(chatId: string, limit = 20): MessageRecord[] {
    return this.messages.preview(chatId, limit)
  }
  getChatSyncState(chatId: string): ChatSyncState | null {
    return this.syncStates.get(chatId)
  }
  markChatSyncAttempt(chatId: string, attemptedAt: string): void {
    this.syncStates.markAttempt(chatId, attemptedAt)
  }
  markChatSyncCompleted(chatId: string, completedAt: string): void {
    this.syncStates.markCompleted(chatId, completedAt)
  }
  markChatSyncFailed(chatId: string, error: string): void {
    this.syncStates.markFailed(chatId, error)
  }
  markChatSyncCancelled(chatId: string): void {
    this.syncStates.markCancelled(chatId)
  }
  appendOperationalLog(entry: Omit<OperationalLogEntry, 'sequence'>): OperationalLogEntry {
    return this.logs.append(entry)
  }
  readOperationalLogs(after = 0, limit = 200): OperationalLogResponse {
    return this.logs.read(after, limit)
  }
  listOperationalLogs(): OperationalLogEntry[] {
    return this.logs.list()
  }
  pruneOperationalLogs(now = new Date()): void {
    this.logs.prune(now)
  }
  close(): void {
    this.sqlite.close()
  }
}
