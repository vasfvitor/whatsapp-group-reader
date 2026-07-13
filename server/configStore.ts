import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import {
  appConfigSchema,
  createDefaultConfig,
  type AppConfig,
  type Source,
} from '../shared/contracts.js'
import { normalizeFilterValue } from '../shared/sourceMatcher.js'

function sourceKey(source: Source): string {
  return `${source.type}:${normalizeFilterValue(source.value)}`
}

function normalizeConfig(config: AppConfig): AppConfig {
  const sourceKeys = new Set<string>()
  const sources = config.sources.filter((source) => {
    const key = sourceKey(source)
    if (sourceKeys.has(key)) return false
    sourceKeys.add(key)
    return true
  })

  const chatTags = Object.fromEntries(
    Object.entries(config.chatTags)
      .map(([chatId, tags]) => [
        chatId,
        [...new Set(tags.map(normalizeFilterValue).filter(Boolean))],
      ])
      .filter(([, tags]) => (tags as string[]).length > 0),
  )

  return {
    ...config,
    sources,
    selectedChatIds: [...new Set(config.selectedChatIds)],
    chatTags,
  }
}

export class ConfigStore {
  private current: AppConfig = createDefaultConfig()

  constructor(private readonly filePath: string) {}

  async load(): Promise<AppConfig> {
    await mkdir(path.dirname(this.filePath), { recursive: true })

    try {
      const raw = await readFile(this.filePath, 'utf8')
      this.current = normalizeConfig(appConfigSchema.parse(JSON.parse(raw)))
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
    const config = normalizeConfig(appConfigSchema.parse(input))
    await writeFileAtomic(this.filePath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
    })
    this.current = config
    return this.get()
  }
}
