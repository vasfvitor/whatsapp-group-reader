import type {
  OperationalLogDetails,
  OperationalLogEntry,
  OperationalLogLevel,
  OperationalLogResponse,
} from '../shared/contracts.js'
import type { MessageDatabase } from './database.js'

const SENSITIVE_DETAIL_KEYS = /(body|content|media|message|text)/i
const LOG_RETENTION_INTERVAL_MS = 60 * 60 * 1000

export class OperationalLogBuffer {
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor(private readonly database: MessageDatabase) {}

  start(): void {
    if (this.cleanupTimer) return
    this.database.pruneOperationalLogs()
    this.cleanupTimer = setInterval(
      () => this.database.pruneOperationalLogs(),
      LOG_RETENTION_INTERVAL_MS,
    )
    this.cleanupTimer.unref()
  }

  add(
    level: OperationalLogLevel,
    event: string,
    message: string,
    details: OperationalLogDetails = {},
  ): OperationalLogEntry {
    const safeDetails = Object.fromEntries(
      Object.entries(details).filter(([key]) => !SENSITIVE_DETAIL_KEYS.test(key)),
    )
    return this.database.appendOperationalLog({
      timestamp: new Date().toISOString(),
      level,
      event,
      message,
      details: safeDetails,
    })
  }

  read(after = 0): OperationalLogResponse {
    return this.database.readOperationalLogs(after)
  }

  close(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.cleanupTimer = null
  }
}
