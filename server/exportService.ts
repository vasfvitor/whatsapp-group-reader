import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import open from 'open'
import writeFileAtomic from 'write-file-atomic'
import type { ExportRequest, ExportResult } from '../shared/contracts.js'
import type { MessageDatabase } from './database.js'

export class ExportService {
  constructor(
    private readonly database: MessageDatabase,
    private readonly exportsDirectory: string,
    private readonly dataDirectory: string,
  ) {}

  async create(request: ExportRequest, defaultChatIds: string[]): Promise<ExportResult> {
    const chatIds = request.chatIds?.length ? request.chatIds : defaultChatIds
    const records = this.database.queryMessages({
      fromUnix: Math.floor(Date.parse(request.from) / 1000),
      toUnix: Math.floor(Date.parse(request.to) / 1000),
      limitPerChat: request.limitPerChat,
      chatIds,
    })

    await mkdir(this.exportsDirectory, { recursive: true })
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    const fileName = `messages-${timestamp}-${randomUUID().slice(0, 8)}.jsonl`
    const content = records.length
      ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
      : ''

    await writeFileAtomic(path.join(this.exportsDirectory, fileName), content, {
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
