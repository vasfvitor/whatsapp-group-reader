// @vitest-environment node
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultConfig,
  createIdleSyncProgress,
  type AppStatus,
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
    get: vi.fn(() => structuredClone(config)),
    save: vi.fn(async (next) => {
      config = structuredClone(next)
      return structuredClone(config)
    }),
  }
  const database = {
    listOperationalLogs: vi.fn(() => [
      {
        sequence: 1,
        timestamp: '2026-07-13T12:00:00.000Z',
        level: 'info',
        event: 'started',
        message: 'Iniciado',
        details: {},
      },
    ]),
    previewMessages: vi.fn(() => []),
  }
  const whatsappService = {
    getStatus: vi.fn(() => status),
    getOperationalLog: vi.fn(() => ({ entries: [], cursor: 0 })),
    getChats: vi.fn(async () => []),
    onConfigUpdated: vi.fn(),
    syncSelected: vi.fn(),
    pauseSync: vi.fn(),
    resumeSync: vi.fn(),
    cancelSync: vi.fn(),
    resetSession: vi.fn(async () => undefined),
  }
  const exportService = {
    create: vi.fn(),
    resolveFile: vi.fn(),
    openDataDirectory: vi.fn(async () => undefined),
  }

  const app = createApp({
    configStore: configStore as never,
    database: database as never,
    exportService: exportService as never,
    whatsappService: whatsappService as never,
    development: true,
  })

  return { app, database }
}

describe('HTTP API contracts', () => {
  it('returns the existing application status contract', async () => {
    const { app } = createHarness()
    const response = await request(app).get('/api/status').expect(200)
    expect(response.body).toEqual(status)
  })

  it('rejects non-local hosts before dispatching a route', async () => {
    const { app } = createHarness()
    await request(app).get('/api/status').set('host', 'example.com').expect(403, {
      error: 'Acesso permitido somente pela aplicação local.',
    })
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
    expect(database.previewMessages).toHaveBeenCalledWith('allowed@g.us', 20)
  })

  it('exports diagnostic logs as JSONL', async () => {
    const { app } = createHarness()
    const response = await request(app).get('/api/debug-log/export').expect(200)
    expect(response.headers['content-type']).toContain('application/x-ndjson')
    expect(response.headers['content-disposition']).toContain('diagnostic-log-')
    expect(response.text).toContain('"event":"started"')
  })
})
