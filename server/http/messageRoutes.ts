import { Router } from 'express'
import { messagePreviewQuerySchema } from '../../shared/contracts.js'
import { isChatAuthorized } from '../../shared/configRules.js'
import type { AppDependencies } from './dependencies.js'

export function createMessageRouter({ configStore, database }: AppDependencies): Router {
  const router = Router()
  router.get('/messages/preview', (request, response) => {
    const { chatId } = messagePreviewQuerySchema.parse(request.query)
    if (!isChatAuthorized(configStore.get(), chatId)) {
      response.status(403).json({ error: 'Conversa não autorizada para visualização.' })
      return
    }
    response.json({ messages: database.messages.preview(chatId) })
  })
  return router
}
