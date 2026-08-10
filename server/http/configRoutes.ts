import { Router } from 'express'
import { appConfigSchema } from '../../shared/contracts.js'
import type { AppDependencies } from './dependencies.js'

export function createConfigRouter({ configStore, whatsappService }: AppDependencies): Router {
  const router = Router()
  router.get('/config', (_request, response) => response.json(configStore.get()))
  router.put('/config', async (request, response) => {
    const saved = await configStore.save(appConfigSchema.parse(request.body))
    whatsappService.onConfigUpdated()
    response.json(saved)
  })
  return router
}
