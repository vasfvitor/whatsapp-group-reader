import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import open from 'open'
import writeFileAtomic from 'write-file-atomic'
import type { ExportRequest, ExportResult } from '../shared/contracts.js'
import type { MessageRepository } from './messages/messageRepository.js'

/** Filesystem-safe timestamp used in export file names. */
export function exportTimestamp(): string {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

export function toJsonl(records: unknown[]): string {
  return records.length ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n` : ''
}

export class ExportService {
  constructor(
    private readonly messages: MessageRepository,
    private readonly exportsDirectory: string,
    private readonly dataDirectory: string,
  ) {}

  async create(request: ExportRequest, authorizedChatIds: string[]): Promise<ExportResult> {
    const records = this.messages.query({
      fromUnix: Math.floor(Date.parse(request.from) / 1000),
      toUnix: Math.floor(Date.parse(request.to) / 1000),
      limitPerChat: request.limitPerChat,
      chatIds: authorizedChatIds,
    })

    await mkdir(this.exportsDirectory, { recursive: true })
    const fileName = `messages-${exportTimestamp()}-${randomUUID().slice(0, 8)}.jsonl`

    await writeFileAtomic(path.join(this.exportsDirectory, fileName), toJsonl(records), {
      encoding: 'utf8',
    })

    return {
      id: fileName,
      fileName,
      count: records.length,
      downloadUrl: `/api/exports/${encodeURIComponent(fileName)}`,
    }
  }

  resolveFile(id: string): string | null {
    if (!/^messages-[a-zA-Z0-9._-]+\.jsonl$/.test(id)) return null
    return path.join(this.exportsDirectory, id)
  }

  async openDataDirectory(): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true })
    await open(this.dataDirectory)
  }
}
