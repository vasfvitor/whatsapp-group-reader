import type { DatabaseSync, StatementSync } from 'node:sqlite'
import {
  OPERATIONAL_LOG_WINDOW,
  type OperationalLogDetails,
  type OperationalLogEntry,
  type OperationalLogLevel,
  type OperationalLogResponse,
} from '../../shared/contracts.js'

const MAX_ROWS = 10_000
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

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
  private readonly insertStatement: StatementSync
  private readonly cursorStatement: StatementSync
  private readonly pageStatement: StatementSync
  private readonly listStatement: StatementSync
  private readonly deleteExpiredStatement: StatementSync
  private readonly trimStatement: StatementSync

  constructor(database: DatabaseSync) {
    this.insertStatement = database.prepare(
      `INSERT INTO operational_logs
      (timestamp_utc, level, event, message, details_json) VALUES (?, ?, ?, ?, ?)`,
    )
    this.cursorStatement = database.prepare(
      'SELECT COALESCE(MAX(id), 0) AS cursor FROM operational_logs',
    )
    this.pageStatement = database.prepare(
      `SELECT id, timestamp_utc, level, event, message, details_json
      FROM operational_logs WHERE id > ? ORDER BY id DESC LIMIT ?`,
    )
    this.listStatement = database.prepare(
      `SELECT id, timestamp_utc, level, event, message, details_json
      FROM operational_logs ORDER BY id ASC`,
    )
    this.deleteExpiredStatement = database.prepare(
      'DELETE FROM operational_logs WHERE timestamp_utc < ?',
    )
    // Ids are AUTOINCREMENT (monotonic, never reused), so keeping ids above
    // max - MAX_ROWS caps the table without counting rows.
    this.trimStatement = database.prepare('DELETE FROM operational_logs WHERE id <= ?')
  }
  append(entry: Omit<OperationalLogEntry, 'sequence'>): OperationalLogEntry {
    const result = this.insertStatement.run(
      entry.timestamp,
      entry.level,
      entry.event,
      entry.message,
      JSON.stringify(entry.details),
    )
    const sequence = Number(result.lastInsertRowid)
    this.trimStatement.run(sequence - MAX_ROWS)
    return { sequence, ...entry }
  }
  read(after = 0, limit = OPERATIONAL_LOG_WINDOW): OperationalLogResponse {
    const cursor = (this.cursorStatement.get() as { cursor: number }).cursor
    const effectiveAfter = after > cursor ? 0 : after
    const rows = this.pageStatement.all(effectiveAfter, limit) as unknown as LogRow[]
    return { entries: rows.reverse().map(toEntry), cursor }
  }
  list(): OperationalLogEntry[] {
    return (this.listStatement.all() as unknown as LogRow[]).map(toEntry)
  }
  prune(now = new Date()): void {
    const cutoff = new Date(now.getTime() - RETENTION_MS).toISOString()
    this.deleteExpiredStatement.run(cutoff)
    const cursor = (this.cursorStatement.get() as { cursor: number }).cursor
    this.trimStatement.run(cursor - MAX_ROWS)
  }
}
