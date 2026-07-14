import type {
  OperationalLogDetails,
  OperationalLogEntry,
  OperationalLogLevel,
  OperationalLogResponse,
} from '../shared/contracts.js'
import type { MessageDatabase } from './database.js'

const SENSITIVE_DETAIL_KEYS = /(body|content|media|message|text)/i

export class OperationalLogBuffer {
  private entries: OperationalLogEntry[] = []
  private nextSequence = 1

  constructor(
    private readonly capacity = 200,
    private readonly database?: MessageDatabase,
  ) {}

  add(
    level: OperationalLogLevel,
    event: string,
    message: string,
    details: OperationalLogDetails = {},
  ): OperationalLogEntry {
    const safeDetails = Object.fromEntries(
      Object.entries(details).filter(([key]) => !SENSITIVE_DETAIL_KEYS.test(key)),
    )
    const pendingEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      message,
      details: safeDetails,
    }
    if (this.database) return this.database.appendOperationalLog(pendingEntry)

    const entry: OperationalLogEntry = { sequence: this.nextSequence, ...pendingEntry }
    this.nextSequence += 1
    this.entries.push(entry)
    if (this.entries.length > this.capacity) this.entries.shift()
    return entry
  }

  read(after = 0): OperationalLogResponse {
    if (this.database) return this.database.readOperationalLogs(after, this.capacity)

    const cursor = this.entries[this.entries.length - 1]?.sequence ?? 0
    const effectiveAfter = after > cursor ? 0 : after
    return {
      entries: this.entries.filter((entry) => entry.sequence > effectiveAfter),
      cursor,
    }
  }
}
