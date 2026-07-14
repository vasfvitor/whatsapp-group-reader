import type Database from 'better-sqlite3'
import type {
  OperationalLogDetails,
  OperationalLogEntry,
  OperationalLogLevel,
  OperationalLogResponse,
} from '../../shared/contracts.js'

interface LogRow {
  id: number
  timestamp_utc: string
  level: OperationalLogLevel
  event: string
  message: string
  details_json: string
}
function toEntry(row: LogRow): OperationalLogEntry {
  let details: OperationalLogDetails = {}
  try {
    details = JSON.parse(row.details_json) as OperationalLogDetails
  } catch {
    details = { invalidDetails: true }
  }
  return {
    sequence: row.id,
    timestamp: row.timestamp_utc,
    level: row.level,
    event: row.event,
    message: row.message,
    details,
  }
}

export class OperationalLogRepository {
  constructor(private readonly database: Database.Database) {}
  append(entry: Omit<OperationalLogEntry, 'sequence'>): OperationalLogEntry {
    const result = this.database
      .prepare(
        `INSERT INTO operational_logs
      (timestamp_utc, level, event, message, details_json) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(entry.timestamp, entry.level, entry.event, entry.message, JSON.stringify(entry.details))
    const saved = { sequence: Number(result.lastInsertRowid), ...entry }
    this.pruneToCapacity()
    return saved
  }
  read(after = 0, limit = 200): OperationalLogResponse {
    const cursor = (
      this.database
        .prepare('SELECT COALESCE(MAX(id), 0) AS cursor FROM operational_logs')
        .get() as { cursor: number }
    ).cursor
    const effectiveAfter = after > cursor ? 0 : after
    const rows = this.database
      .prepare(
        `SELECT id, timestamp_utc, level, event, message, details_json
      FROM operational_logs WHERE id > ? ORDER BY id DESC LIMIT ?`,
      )
      .all(effectiveAfter, limit) as LogRow[]
    return { entries: rows.reverse().map(toEntry), cursor }
  }
  list(): OperationalLogEntry[] {
    return (
      this.database
        .prepare(
          `SELECT id, timestamp_utc, level, event, message, details_json
      FROM operational_logs ORDER BY id ASC`,
        )
        .all() as LogRow[]
    ).map(toEntry)
  }
  prune(now = new Date()): void {
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    this.database.prepare('DELETE FROM operational_logs WHERE timestamp_utc < ?').run(cutoff)
    this.pruneToCapacity()
  }
  private pruneToCapacity(): void {
    const count = (
      this.database.prepare('SELECT COUNT(*) AS count FROM operational_logs').get() as {
        count: number
      }
    ).count
    if (count > 10_000)
      this.database
        .prepare(
          `DELETE FROM operational_logs WHERE id IN (
      SELECT id FROM operational_logs ORDER BY id ASC LIMIT ?)`,
        )
        .run(count - 10_000)
  }
}
