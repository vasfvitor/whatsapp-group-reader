import { mkdir } from 'node:fs/promises'
import open from 'open'
import { ConfigStore } from './configStore.js'
import { MessageDatabase } from './database.js'
import { ExportService } from './exportService.js'
import { WhatsAppService } from './whatsappService.js'
import { appPaths } from './paths.js'
import { createApp } from './app.js'

const PORT = 3210
const HOST = '127.0.0.1'
const development = process.env.APP_DEV === 'true'

async function main(): Promise<void> {
  await Promise.all([
    mkdir(appPaths.data, { recursive: true }),
    mkdir(appPaths.auth, { recursive: true }),
    mkdir(appPaths.exports, { recursive: true }),
  ])

  const configStore = new ConfigStore(appPaths.config)
  await configStore.load()

  const database = new MessageDatabase(appPaths.database)
  const whatsappService = new WhatsAppService(configStore, database, appPaths.auth, appPaths.data)
  const exportService = new ExportService(database, appPaths.exports, appPaths.data)
  const app = createApp({ configStore, exportService, whatsappService, development })

  const server = app.listen(PORT, HOST, () => {
    const url = development ? 'http://127.0.0.1:5173' : `http://${HOST}:${PORT}`
    console.log(`WhatsApp Group Reader disponível em ${url}`)
    setTimeout(() => void open(url), development ? 1_500 : 200)
    whatsappService.start()
  })

  let closing = false
  const shutdown = async (): Promise<void> => {
    if (closing) return
    closing = true
    await whatsappService.stop()
    database.close()
    server.close(() => process.exit(0))
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
