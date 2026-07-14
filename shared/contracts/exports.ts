import { z } from 'zod'

export const EXPORT_LIMITS = { minimumPerChat: 1, maximumPerChat: 5000 } as const

export const exportRequestSchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    limitPerChat: z
      .number()
      .int()
      .min(EXPORT_LIMITS.minimumPerChat)
      .max(EXPORT_LIMITS.maximumPerChat),
    chatIds: z.array(z.string().min(1)).optional(),
  })
  .refine((value) => Date.parse(value.from) <= Date.parse(value.to), {
    message: 'A data inicial deve ser anterior à data final.',
    path: ['from'],
  })

export type ExportRequest = z.infer<typeof exportRequestSchema>

export interface ExportResult {
  id: string
  fileName: string
  count: number
  downloadUrl: string
}
