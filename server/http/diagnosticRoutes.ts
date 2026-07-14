import { Router } from 'express'
import { operationalLogQuerySchema } from '../../shared/contracts.js'
import type { AppDependencies } from './dependencies.js'

export function createDiagnosticRouter({ database, whatsappService }: AppDependencies): Router {
  const router = Router()
  router.get('/debug-log', (request, response, next) => {
    try {
      response.json(
        whatsappService.getOperationalLog(operationalLogQuerySchema.parse(request.query).after),
      )
    } catch (error) {
      next(error)
    }
  })
  router.get('/debug-log/export', (_request, response) => {
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    const records = database.listOperationalLogs()
    const content = records.length
      ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
      : ''
    response.attachment(`diagnostic-log-${timestamp}.jsonl`)
    response.type('application/x-ndjson').send(content)
  })
  return router
}
