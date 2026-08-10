import type { ConfigStore } from '../configStore.js'
import type { AppDatabase } from '../database.js'
import type { ExportService } from '../exportService.js'
import type { WhatsAppService } from '../whatsappService.js'

export interface AppDependencies {
  configStore: ConfigStore
  database: AppDatabase
  exportService: ExportService
  whatsappService: WhatsAppService
  development: boolean
}
