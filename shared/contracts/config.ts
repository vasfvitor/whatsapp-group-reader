import { z } from 'zod'

export const SYNC_LIMITS = {
  minimumLookbackHours: 1,
  maximumLookbackHours: 24 * 365,
  minimumMessagesPerChat: 1,
  maximumMessagesPerChat: 1000,
} as const

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
    .min(SYNC_LIMITS.minimumLookbackHours)
    .max(SYNC_LIMITS.maximumLookbackHours),
  maxMessagesPerChat: z
    .number()
    .int()
    .min(SYNC_LIMITS.minimumMessagesPerChat)
    .max(SYNC_LIMITS.maximumMessagesPerChat),
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

export type SourceType = z.infer<typeof sourceTypeSchema>
export type Source = z.infer<typeof sourceSchema>
export type SyncSettings = z.infer<typeof syncSettingsSchema>
export type LoadProfile = z.infer<typeof loadProfileSchema>
export type AppConfig = z.infer<typeof appConfigSchema>

export function createDefaultConfig(): AppConfig {
  return {
    sources: [],
    selectedChatIds: [],
    chatTags: {},
    sync: { lookbackHours: 24, maxMessagesPerChat: 500, loadProfile: 'conservative' },
  }
}
