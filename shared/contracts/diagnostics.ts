import { z } from 'zod'

export const operationalLogQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
})

export type OperationalLogLevel = 'info' | 'warn' | 'error'
export type OperationalLogDetails = Record<string, string | number | boolean>

export interface OperationalLogEntry {
  sequence: number
  timestamp: string
  level: OperationalLogLevel
  event: string
  message: string
  details: OperationalLogDetails
}

export interface OperationalLogResponse {
  entries: OperationalLogEntry[]
  cursor: number
}
