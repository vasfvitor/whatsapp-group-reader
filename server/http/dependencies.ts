import type { ConfigStore } from '../configStore.js'
import type { MessageDatabase } from '../database.js'
import type { ExportService } from '../exportService.js'
import type { WhatsAppService } from '../whatsappService.js'

export interface AppDependencies {
  configStore: ConfigStore
  database: MessageDatabase
  exportService: ExportService
  whatsappService: WhatsAppService
  development: boolean
}
