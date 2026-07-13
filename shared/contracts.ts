import { z } from 'zod'

export const sourceTypeSchema = z.enum(['exact', 'contains', 'tag'])
export const loadProfileSchema = z.enum(['balanced', 'conservative'])

export const sourceSchema = z.object({
  type: sourceTypeSchema,
  value: z.string().trim().min(1, 'Informe um valor para o filtro.'),
})

export const syncSettingsSchema = z.object({
  lookbackHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365),
  maxMessagesPerChat: z.number().int().min(1).max(1000),
  loadProfile: loadProfileSchema.default('conservative'),
})

export const appConfigSchema = z.object({
  sources: z.array(sourceSchema).default([]),
  selectedChatIds: z.array(z.string().min(1)).default([]),
  chatTags: z.record(z.string(), z.array(z.string().trim().min(1))).default({}),
  sync: syncSettingsSchema.default({
    lookbackHours: 24,
    maxMessagesPerChat: 500,
    loadProfile: 'conservative',
  }),
})

export const syncRequestSchema = z.object({
  forceRecent: z.boolean().default(false),
})

export const exportRequestSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    limitPerChat: z.number().int().min(1).max(5000),
    chatIds: z.array(z.string().min(1)).optional(),
  })
  .refine((value) => Date.parse(value.from) <= Date.parse(value.to), {
    message: 'A data inicial deve ser anterior à data final.',
    path: ['from'],
  })

export type SourceType = z.infer<typeof sourceTypeSchema>
export type Source = z.infer<typeof sourceSchema>
export type SyncSettings = z.infer<typeof syncSettingsSchema>
export type LoadProfile = z.infer<typeof loadProfileSchema>
export type AppConfig = z.infer<typeof appConfigSchema>
export type ExportRequest = z.infer<typeof exportRequestSchema>

export type ChatType = 'group' | 'contact'

export interface ChatSummary {
  id: string
  name: string
  type: ChatType
  tags: string[]
  selected: boolean
}

export interface MessageRecord {
  chatId: string
  chatName: string
  chatType: ChatType
  messageId: string
  author: string
  timestamp: string
  text: string
}

export type ConnectionState =
  | 'starting'
  | 'awaiting_qr'
  | 'authenticated'
  | 'ready'
  | 'syncing'
  | 'reconnecting'
  | 'invalid_session'
  | 'stopped'

export type SyncPhase = 'idle' | 'running' | 'paused'
export type SyncTrigger = 'automatic' | 'manual'

export interface SyncProgress {
  phase: SyncPhase
  trigger: SyncTrigger | null
  totalChats: number
  completedChats: number
  skippedChats: number
  failedChats: number
  currentChatId: string | null
  currentChatName: string | null
  currentChunkTarget: number | null
  nextActionAt: string | null
}

export interface AppStatus {
  state: ConnectionState
  qrDataUrl: string | null
  message: string
  lastError: string | null
  lastSyncAt: string | null
  collectedMessages: number
  selectedChats: number
  dataDirectory: string
  warnings: string[]
  syncProgress: SyncProgress
}

export interface ExportResult {
  id: string
  fileName: string
  count: number
  downloadUrl: string
}

export function createDefaultConfig(): AppConfig {
  return {
    sources: [],
    selectedChatIds: [],
    chatTags: {},
    sync: {
      lookbackHours: 24,
      maxMessagesPerChat: 500,
      loadProfile: 'conservative',
    },
  }
}
