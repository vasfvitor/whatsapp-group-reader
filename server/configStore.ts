import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { appConfigSchema, createDefaultConfig, type AppConfig } from '../shared/contracts.js'
import { normalizeAppConfig } from '../shared/configRules.js'

export class ConfigStore {
  private current: AppConfig = createDefaultConfig()

  constructor(private readonly filePath: string) {}

  async load(): Promise<AppConfig> {
    await mkdir(path.dirname(this.filePath), { recursive: true })

    try {
      const raw = await readFile(this.filePath, 'utf8')
      this.current = normalizeAppConfig(appConfigSchema.parse(JSON.parse(raw)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.save(createDefaultConfig())
    }

    return this.get()
  }

  get(): AppConfig {
    return structuredClone(this.current)
  }

  async save(input: AppConfig): Promise<AppConfig> {
    const config = normalizeAppConfig(appConfigSchema.parse(input))
    await writeFileAtomic(this.filePath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
    })
    this.current = config
    return this.get()
  }
}
