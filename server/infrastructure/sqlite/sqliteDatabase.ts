import Database from 'better-sqlite3'

export class SqliteDatabase {
  readonly connection: Database.Database

  constructor(filePath: string) {
    this.connection = new Database(filePath)
    this.connection.pragma('journal_mode = WAL')
    this.connection.pragma('foreign_keys = ON')
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, chat_name TEXT NOT NULL,
        chat_type TEXT NOT NULL CHECK (chat_type IN ('group', 'contact')),
        author TEXT NOT NULL, timestamp_utc TEXT NOT NULL, timestamp_unix INTEGER NOT NULL,
        text TEXT NOT NULL, captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS messages_chat_timestamp ON messages (chat_id, timestamp_unix DESC);
      CREATE TABLE IF NOT EXISTS checkpoints (
        chat_id TEXT PRIMARY KEY, last_timestamp_unix INTEGER NOT NULL,
        last_message_id TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS chat_sync_state (
        chat_id TEXT PRIMARY KEY, last_attempt_at TEXT NOT NULL, last_completed_at TEXT,
        last_status TEXT NOT NULL CHECK (last_status IN ('running', 'completed', 'failed', 'cancelled')),
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS operational_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp_utc TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
        event TEXT NOT NULL, message TEXT NOT NULL, details_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS operational_logs_timestamp ON operational_logs (timestamp_utc);
    `)
  }

  close(): void {
    this.connection.close()
  }
}
