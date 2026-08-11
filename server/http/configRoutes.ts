import { Router } from 'express'
import { appConfigSchema } from '../../shared/contracts.js'
import type { AppDependencies } from './dependencies.js'

export function createConfigRouter({ configStore }: AppDependencies): Router {
  const router = Router()
  router.get('/config', (_request, response) => response.json(configStore.get()))
  router.put('/config', async (request, response) => {
    // Salvar não dispara sincronização — a coleta é iniciada explicitamente
    // pelo usuário em "Sincronizar agora".
    const saved = await configStore.save(appConfigSchema.parse(request.body))
    response.json(saved)
  })
  return router
}
