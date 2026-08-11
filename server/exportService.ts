import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import open from 'open'
import writeFileAtomic from 'write-file-atomic'
import type { ExportRequest, ExportResult, MessageRecord } from '../shared/contracts.js'
import type { MessageRepository } from './messages/messageRepository.js'

/** Filesystem-safe timestamp used in export file names. */
export function exportTimestamp(): string {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

export function toJsonl(records: unknown[]): string {
  return records.length ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n` : ''
}

function formatLocalTimestamp(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Formato compacto para contexto de LLM: cabeçalho com as contagens e cada
 * conversa entre marcadores explícitos de início/fim, para o modelo nunca
 * misturar a origem das mensagens.
 */
export function toLlmText(records: MessageRecord[]): string {
  const byChat = new Map<string, MessageRecord[]>()
  for (const record of records) {
    const group = byChat.get(record.chatId)
    if (group) group.push(record)
    else byChat.set(record.chatId, [record])
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offsetMinutes = -new Date().getTimezoneOffset()
  const offsetSign = offsetMinutes < 0 ? '-' : '+'
  const pad = (value: number) => String(Math.abs(value)).padStart(2, '0')
  const utcOffset = `UTC${offsetSign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`

  const lines: string[] = [
    `Conversas: ${byChat.size}. Mensagens: ${records.length}.`,
    `Datas no formato AAAA-MM-DD HH:mm, fuso horário ${timeZone} (${utcOffset}).`,
    'Cada conversa está delimitada por marcadores de INÍCIO/FIM.',
  ]

  for (const chatRecords of byChat.values()) {
    const first = chatRecords[0]!
    const kind = first.chatType === 'group' ? 'GRUPO' : 'CONVERSA'
    const marker = `${kind}: ${first.chatName} [id: ${first.chatId}]`
    lines.push('', `===== INÍCIO ${marker} =====`)
    for (const record of chatRecords) {
      lines.push(`[${formatLocalTimestamp(record.timestamp)}] ${record.author}: ${record.text}`)
    }
    lines.push(`===== FIM ${marker} =====`)
  }

  return `${lines.join('\n')}\n`
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
    const extension = request.format === 'text' ? 'txt' : 'jsonl'
    const fileName = `messages-${exportTimestamp()}-${randomUUID().slice(0, 8)}.${extension}`
    const content = request.format === 'text' ? toLlmText(records) : toJsonl(records)

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
    if (!/^messages-[a-zA-Z0-9._-]+\.(jsonl|txt)$/.test(id)) return null
    return path.join(this.exportsDirectory, id)
  }

  async openDataDirectory(): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true })
    await open(this.dataDirectory)
  }
}
