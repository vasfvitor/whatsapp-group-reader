import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import open from 'open'
import { ConfigStore } from './configStore.js'
import { AppDatabase } from './database.js'
import { ExportService } from './exportService.js'
import { WhatsAppService } from './whatsappService.js'
import { appPaths } from './paths.js'
import { createApp } from './app.js'

const PORT = 3210
const HOST = '127.0.0.1'
const development = process.env.APP_DEV === 'true'

function appVersion(): string {
  try {
    const raw = readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    return (JSON.parse(raw) as { version?: string }).version ?? ''
  } catch {
    return ''
  }
}

async function main(): Promise<void> {
  await Promise.all([
    mkdir(appPaths.data, { recursive: true }),
    mkdir(appPaths.auth, { recursive: true }),
    mkdir(appPaths.exports, { recursive: true }),
  ])

  const configStore = new ConfigStore(appPaths.config)
  await configStore.load()

  const database = new AppDatabase(appPaths.database)
  const whatsappService = new WhatsAppService(configStore, database, appPaths.auth, appPaths.data)
  const exportService = new ExportService(database.messages, appPaths.exports, appPaths.data)
  const app = createApp({ configStore, database, exportService, whatsappService, development })

  const url = development ? 'http://127.0.0.1:5173' : `http://${HOST}:${PORT}`

  const interactive = !development && process.stdin.isTTY === true

  const server = app.listen(PORT, HOST, () => {
    const version = appVersion()
    console.log('==================================================')
    console.log(` WhatsApp Group Reader${version ? ` v${version}` : ''}`)
    console.log(` Interface: ${url}`)
    console.log(` Dados:     ${appPaths.data}`)
    console.log('==================================================')
    if (interactive) {
      console.log(' Para encerrar, pressione F nesta janela.')
      console.log(' (Fechar a janela também encerra, de forma abrupta.)')
    }
    console.log('')
    setTimeout(() => void open(url), development ? 1_500 : 200)
    whatsappService.start()
  })

  const handlePortInUse = async (): Promise<void> => {
    // Só tratar como "já em execução" se quem ocupa a porta responder como este app.
    try {
      const response = await fetch(`http://${HOST}:${PORT}/api/status`)
      const status: unknown = response.ok ? await response.json() : null
      if (status && typeof status === 'object' && 'dataDirectory' in status) {
        console.log(`O WhatsApp Group Reader já está em execução. Abrindo ${url} no navegador…`)
        await open(url).catch(() => undefined)
        process.exit(0)
      }
    } catch {
      // porta ocupada por outro programa
    }
    console.error(`A porta ${PORT} está em uso por outro programa. Feche-o e tente novamente.`)
    process.exit(1)
  }

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && !development) {
      void handlePortInUse()
      return
    }
    console.error(error.message)
    process.exit(1)
  })

  let closing = false
  const shutdown = async (): Promise<void> => {
    if (closing) return
    closing = true
    console.log('Encerrando… aguarde alguns segundos.')
    // Failsafe: nunca deixar a janela presa em um desligamento que travou.
    setTimeout(() => process.exit(0), 10_000).unref()
    await whatsappService.stop()
    database.close()
    server.close(() => process.exit(0))
    server.closeAllConnections()
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  if (interactive) {
    // Modo raw: cada tecla chega direto, sem esperar Enter. Ctrl+C vira o byte
    // 0x03 (o SIGINT automático deixa de existir), então tratamos os dois aqui.
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', (data: Buffer) => {
      const key = data.toString()
      if (key === 'f' || key === 'F' || key === '\u0003') void shutdown()
    })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
