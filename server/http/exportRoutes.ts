import { access } from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import { exportRequestSchema } from '../../shared/contracts.js'
import type { AppDependencies } from './dependencies.js'

export function createExportRouter({ configStore, exportService }: AppDependencies): Router {
  const router = Router()
  router.post('/exports', async (request, response, next) => {
    try {
      const result = await exportService.create(
        exportRequestSchema.parse(request.body),
        configStore.get().selectedChatIds,
      )
      response.status(201).json(result)
    } catch (error) {
      next(error)
    }
  })
  router.get('/exports/:id', async (request, response, next) => {
    try {
      const filePath = exportService.resolveFile(request.params.id)
      if (!filePath) {
        response.status(404).json({ error: 'Exportação não encontrada.' })
        return
      }
      await access(filePath)
      response.download(filePath, path.basename(filePath))
    } catch (error) {
      next(error)
    }
  })
  router.post('/data-directory/open', async (_request, response, next) => {
    try {
      await exportService.openDataDirectory()
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })
  return router
}
