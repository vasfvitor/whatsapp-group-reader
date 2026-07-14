import express, { type NextFunction, type Request, type Response } from 'express'
import path from 'node:path'
import { access } from 'node:fs/promises'
import { ZodError } from 'zod'
import {
  appConfigSchema,
  exportRequestSchema,
  messagePreviewQuerySchema,
  operationalLogQuerySchema,
  syncRequestSchema,
} from '../shared/contracts.js'
import type { ConfigStore } from './configStore.js'
import type { ExportService } from './exportService.js'
import type { MessageDatabase } from './database.js'
import type { WhatsAppService } from './whatsappService.js'

interface AppDependencies {
  configStore: ConfigStore
  exportService: ExportService
  database: MessageDatabase
  whatsappService: WhatsAppService
  development: boolean
}

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
  } catch {
    return false
  }
}

export function createApp(dependencies: AppDependencies): express.Express {
  const app = express()

  app.disable('x-powered-by')
  app.use((request, response, next) => {
    const hostAllowed = ['127.0.0.1', 'localhost'].includes(request.hostname)
    const origin = request.get('origin')
    if (!hostAllowed || (origin && !isLocalOrigin(origin))) {
      response.status(403).json({ error: 'Acesso permitido somente pela aplicação local.' })
      return
    }
    next()
  })
  app.use(express.json({ limit: '64kb' }))

  app.get('/api/status', (_request, response) => {
    response.json(dependencies.whatsappService.getStatus())
  })

  app.get('/api/debug-log', (request, response, next) => {
    try {
      const { after } = operationalLogQuerySchema.parse(request.query)
      response.json(dependencies.whatsappService.getOperationalLog(after))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/debug-log/export', (_request, response) => {
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
    const records = dependencies.database.listOperationalLogs()
    const content = records.length
      ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
      : ''
    response.attachment(`diagnostic-log-${timestamp}.jsonl`)
    response.type('application/x-ndjson').send(content)
  })

  app.get('/api/config', (_request, response) => {
    response.json(dependencies.configStore.get())
  })

  app.put('/api/config', async (request, response, next) => {
    try {
      const config = appConfigSchema.parse(request.body)
      const saved = await dependencies.configStore.save(config)
      dependencies.whatsappService.onConfigUpdated()
      response.json(saved)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/chats', async (request, response, next) => {
    try {
      const refresh = request.query.refresh === 'true'
      response.json(await dependencies.whatsappService.getChats(refresh))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/messages/preview', (request, response, next) => {
    try {
      const { chatId } = messagePreviewQuerySchema.parse(request.query)
      if (!dependencies.configStore.get().selectedChatIds.includes(chatId)) {
        response.status(403).json({ error: 'Conversa não autorizada para visualização.' })
        return
      }
      response.json({ messages: dependencies.database.previewMessages(chatId, 20) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/sync', (request, response, next) => {
    try {
      const syncRequest = syncRequestSchema.parse(request.body ?? {})
      dependencies.whatsappService.syncSelected({
        trigger: 'manual',
        forceRecent: syncRequest.forceRecent,
      })
      response.status(202).json(dependencies.whatsappService.getStatus())
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/sync/pause', (_request, response) => {
    dependencies.whatsappService.pauseSync()
    response.json(dependencies.whatsappService.getStatus())
  })

  app.post('/api/sync/resume', (_request, response) => {
    dependencies.whatsappService.resumeSync()
    response.json(dependencies.whatsappService.getStatus())
  })

  app.post('/api/sync/cancel', (_request, response) => {
    dependencies.whatsappService.cancelSync()
    response.json(dependencies.whatsappService.getStatus())
  })

  app.post('/api/session/reset', async (_request, response, next) => {
    try {
      await dependencies.whatsappService.resetSession()
      response.status(202).json(dependencies.whatsappService.getStatus())
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/exports', async (request, response, next) => {
    try {
      const exportRequest = exportRequestSchema.parse(request.body)
      const result = await dependencies.exportService.create(
        exportRequest,
        dependencies.configStore.get().selectedChatIds,
      )
      response.status(201).json(result)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/exports/:id', async (request, response, next) => {
    try {
      const filePath = dependencies.exportService.resolveFile(request.params.id)
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

  app.post('/api/data-directory/open', async (_request, response, next) => {
    try {
      await dependencies.exportService.openDataDirectory()
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  if (dependencies.development) {
    app.get('/', (_request, response) => response.redirect('http://127.0.0.1:5173'))
  } else {
    const webDirectory = path.join(process.cwd(), 'dist', 'web')
    app.use(express.static(webDirectory))
    app.get(/.*/, (_request, response) => response.sendFile(path.join(webDirectory, 'index.html')))
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: 'Dados inválidos.',
        details: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      })
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    response.status(500).json({ error: message })
  })

  return app
}
