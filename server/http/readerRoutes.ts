import { Router } from 'express'
import { syncRequestSchema } from '../../shared/contracts.js'
import type { AppDependencies } from './dependencies.js'

export function createReaderRouter({ whatsappService }: AppDependencies): Router {
  const router = Router()
  router.get('/status', (_request, response) => response.json(whatsappService.getStatus()))
  router.get('/chats', async (request, response) => {
    response.json(await whatsappService.getChats(request.query.refresh === 'true'))
  })
  router.post('/sync', (request, response) => {
    const syncRequest = syncRequestSchema.parse(request.body ?? {})
    whatsappService.syncSelected({ trigger: 'manual', forceRecent: syncRequest.forceRecent })
    response.status(202).json(whatsappService.getStatus())
  })
  router.post('/sync/pause', (_request, response) => {
    whatsappService.pauseSync()
    response.json(whatsappService.getStatus())
  })
  router.post('/sync/resume', (_request, response) => {
    whatsappService.resumeSync()
    response.json(whatsappService.getStatus())
  })
  router.post('/sync/cancel', (_request, response) => {
    whatsappService.cancelSync()
    response.json(whatsappService.getStatus())
  })
  router.post('/session/reconnect', async (_request, response) => {
    await whatsappService.reconnect()
    response.status(202).json(whatsappService.getStatus())
  })
  router.post('/session/reset', async (_request, response) => {
    await whatsappService.resetSession()
    response.status(202).json(whatsappService.getStatus())
  })
  return router
}
