import express, { type NextFunction, type Request, type Response } from 'express'
import path from 'node:path'
import { ZodError } from 'zod'
import type { AppDependencies } from './http/dependencies.js'
import { createReaderRouter } from './http/readerRoutes.js'
import { createConfigRouter } from './http/configRoutes.js'
import { createMessageRouter } from './http/messageRoutes.js'
import { createDiagnosticRouter } from './http/diagnosticRoutes.js'
import { createExportRouter } from './http/exportRoutes.js'

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
  app.use('/api', createReaderRouter(dependencies))
  app.use('/api', createConfigRouter(dependencies))
  app.use('/api', createMessageRouter(dependencies))
  app.use('/api', createDiagnosticRouter(dependencies))
  app.use('/api', createExportRouter(dependencies))

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
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  })
  return app
}
