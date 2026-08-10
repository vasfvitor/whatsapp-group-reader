// @vitest-environment node
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultConfig,
  createIdleSyncProgress,
  type AppConfig,
  type AppStatus,
  type ChatSummary,
  type ExportRequest,
  type ExportResult,
  type MessageRecord,
  type OperationalLogEntry,
  type OperationalLogResponse,
} from '../../shared/contracts.js'
import { createApp } from '../app.js'

const status: AppStatus = {
  state: 'ready',
  qrDataUrl: null,
  message: 'WhatsApp conectado.',
  lastError: null,
  lastSyncAt: null,
  collectedMessages: 1,
  selectedChats: 1,
  dataDirectory: 'data',
  warnings: [],
  syncProgress: createIdleSyncProgress(),
}

function createHarness() {
  let config = { ...createDefaultConfig(), selectedChatIds: ['allowed@g.us'] }
  const configStore = {
    get: vi.fn<() => AppConfig>(() => structuredClone(config)),
    save: vi.fn<(next: AppConfig) => Promise<AppConfig>>(async (next) => {
      config = structuredClone(next)
      return structuredClone(config)
    }),
  }
  const database = {
    logs: {
      list: vi.fn<() => OperationalLogEntry[]>(() => [
        {
          sequence: 1,
          timestamp: '2026-07-13T12:00:00.000Z',
          level: 'info',
          event: 'started',
          message: 'Iniciado',
          details: {},
        },
      ]),
    },
    messages: {
      preview: vi.fn<() => MessageRecord[]>(() => []),
    },
  }
  const whatsappService = {
    getStatus: vi.fn<() => AppStatus>(() => status),
    getOperationalLog: vi.fn<() => OperationalLogResponse>(() => ({ entries: [], cursor: 0 })),
    getChats: vi.fn<() => Promise<ChatSummary[]>>(async () => []),
    onConfigUpdated: vi.fn<() => void>(),
    syncSelected: vi.fn<() => void>(),
    pauseSync: vi.fn<() => void>(),
    resumeSync: vi.fn<() => void>(),
    cancelSync: vi.fn<() => void>(),
    resetSession: vi.fn<() => Promise<void>>(async () => undefined),
  }
  const exportService = {
    create: vi.fn<(payload: ExportRequest, chatIds: string[]) => Promise<ExportResult>>(),
    resolveFile: vi.fn<(id: string) => string | null>(),
    openDataDirectory: vi.fn<() => Promise<void>>(async () => undefined),
  }

  const app = createApp({
    configStore: configStore as never,
    database: database as never,
    exportService: exportService as never,
    whatsappService: whatsappService as never,
    development: true,
  })

  return { app, database, exportService }
}

describe('HTTP API contracts', () => {
  it('returns the existing application status contract', async () => {
    const { app } = createHarness()
    const response = await request(app).get('/api/status').expect(200)
    expect(response.body).toEqual(status)
  })

  it('rejects non-local hosts before dispatching a route', async () => {
    const { app } = createHarness()
    const response = await request(app).get('/api/status').set('host', 'example.com').expect(403)
    expect(response.body).toEqual({ error: 'Acesso permitido somente pela aplicação local.' })
  })

  it('validates configuration payloads and preserves the error envelope', async () => {
    const { app } = createHarness()
    const response = await request(app).put('/api/config').send({ sync: {} }).expect(400)
    expect(response.body.error).toBe('Dados inválidos.')
    expect(response.body.details).toBeInstanceOf(Array)
  })

  it('only previews messages from an explicitly selected chat', async () => {
    const { app, database } = createHarness()
    await request(app).get('/api/messages/preview').query({ chatId: 'blocked@g.us' }).expect(403)
    await request(app)
      .get('/api/messages/preview')
      .query({ chatId: 'allowed@g.us' })
      .expect(200, { messages: [] })
    expect(database.messages.preview).toHaveBeenCalledWith('allowed@g.us')
  })

  it('exports scoped to the configured allowlist', async () => {
    const { app, exportService } = createHarness()
    exportService.create.mockResolvedValue({
      id: 'messages-test.jsonl',
      fileName: 'messages-test.jsonl',
      count: 0,
      downloadUrl: '/api/exports/messages-test.jsonl',
    })

    await request(app)
      .post('/api/exports')
      .send({
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-02T00:00:00.000Z',
        limitPerChat: 50,
      })
      .expect(201)

    expect(exportService.create).toHaveBeenCalledWith(
      {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-02T00:00:00.000Z',
        limitPerChat: 50,
      },
      ['allowed@g.us'],
    )
  })

  it('rejects export requests with unknown keys instead of silently ignoring them', async () => {
    const { app, exportService } = createHarness()

    await request(app)
      .post('/api/exports')
      .send({
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-02T00:00:00.000Z',
        limitPerChat: 50,
        chatIds: ['blocked@g.us'],
      })
      .expect(400)

    expect(exportService.create).not.toHaveBeenCalled()
  })

  it('exports diagnostic logs as JSONL', async () => {
    const { app } = createHarness()
    const response = await request(app).get('/api/debug-log/export').expect(200)
    expect(response.headers['content-type']).toContain('application/x-ndjson')
    expect(response.headers['content-disposition']).toContain('diagnostic-log-')
    expect(response.text).toContain('"event":"started"')
  })
})
