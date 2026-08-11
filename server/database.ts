import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from './infrastructure/sqlite/sqliteDatabase.js'
import { MessageRepository, type Checkpoint } from './messages/messageRepository.js'
import { SyncStateRepository, type ChatSyncState } from './sync/syncStateRepository.js'
import { OperationalLogRepository } from './diagnostics/operationalLogRepository.js'

export type { Checkpoint, ChatSyncState }

/** Owns the SQLite connection and hands out the domain repositories built on it. */
export class AppDatabase {
  readonly messages: MessageRepository
  readonly syncStates: SyncStateRepository
  readonly logs: OperationalLogRepository
  private readonly connection: DatabaseSync

  constructor(filePath: string) {
    this.connection = openDatabase(filePath)
    this.messages = new MessageRepository(this.connection)
    this.syncStates = new SyncStateRepository(this.connection)
    this.logs = new OperationalLogRepository(this.connection)
  }

  close(): void {
    this.connection.close()
  }
}
