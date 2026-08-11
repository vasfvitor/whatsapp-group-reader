import { z } from 'zod'

export const EXPORT_LIMITS = { minimumPerChat: 1, maximumPerChat: 5000 } as const

const limitMessage = `Informe um limite inteiro entre ${EXPORT_LIMITS.minimumPerChat} e ${EXPORT_LIMITS.maximumPerChat}.`

export const exportRequestSchema = z
  .strictObject({
    from: z.iso.datetime({ offset: true, error: 'Informe uma data inicial válida.' }),
    to: z.iso.datetime({ offset: true, error: 'Informe uma data final válida.' }),
    // 'jsonl': dados completos (canônico); 'text': compacto para contexto de LLM
    format: z.enum(['jsonl', 'text']).default('jsonl'),
    limitPerChat: z
      .number({ error: limitMessage })
      .int(limitMessage)
      .min(EXPORT_LIMITS.minimumPerChat, limitMessage)
      .max(EXPORT_LIMITS.maximumPerChat, limitMessage),
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
