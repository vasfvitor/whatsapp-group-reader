import type {
  OperationalLogDetails,
  OperationalLogEntry,
  OperationalLogLevel,
  OperationalLogResponse,
} from '../shared/contracts.js'

export class OperationalLogBuffer {
  private entries: OperationalLogEntry[] = []
  private nextSequence = 1

  constructor(private readonly capacity = 200) {}

  add(
    level: OperationalLogLevel,
    event: string,
    message: string,
    details: OperationalLogDetails = {},
  ): OperationalLogEntry {
    const entry: OperationalLogEntry = {
      sequence: this.nextSequence,
      timestamp: new Date().toISOString(),
      level,
      event,
      message,
      details,
    }
    this.nextSequence += 1
    this.entries.push(entry)
    if (this.entries.length > this.capacity) this.entries.shift()
    return entry
  }

  read(after = 0): OperationalLogResponse {
    const cursor = this.entries[this.entries.length - 1]?.sequence ?? 0
    const effectiveAfter = after > cursor ? 0 : after
    return {
      entries: this.entries.filter((entry) => entry.sequence > effectiveAfter),
      cursor,
    }
  }
}
