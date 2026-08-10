import { Router } from 'express'
import { operationalLogQuerySchema } from '../../shared/contracts.js'
import { exportTimestamp, toJsonl } from '../exportService.js'
import type { AppDependencies } from './dependencies.js'

export function createDiagnosticRouter({ database, whatsappService }: AppDependencies): Router {
  const router = Router()
  router.get('/debug-log', (request, response) => {
    response.json(
      whatsappService.getOperationalLog(operationalLogQuerySchema.parse(request.query).after),
    )
  })
  router.get('/debug-log/export', (_request, response) => {
    response.attachment(`diagnostic-log-${exportTimestamp()}.jsonl`)
    response.type('application/x-ndjson').send(toJsonl(database.logs.list()))
  })
  return router
}
