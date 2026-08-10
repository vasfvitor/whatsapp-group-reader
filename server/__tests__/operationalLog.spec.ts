// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppDatabase } from '../database.js'
import { OperationalLogBuffer } from '../operationalLog.js'

describe('OperationalLogBuffer', () => {
  it('supports incremental reads', () => {
    const database = new AppDatabase(':memory:')
    const log = new OperationalLogBuffer(database.logs)
    log.add('info', 'first', 'Primeiro')
    log.add('warn', 'second', 'Segundo', { attempt: 1 })
    log.add('error', 'third', 'Terceiro')

    expect(log.read(0).entries.map((entry) => entry.event)).toEqual(['first', 'second', 'third'])
    expect(log.read(2).entries.map((entry) => entry.event)).toEqual(['third'])

    database.close()
  })

  it('returns the current buffer when a client cursor came from a restarted server', () => {
    const database = new AppDatabase(':memory:')
    const log = new OperationalLogBuffer(database.logs)
    log.add('info', 'started', 'Iniciado')

    expect(log.read(999).entries).toHaveLength(1)
    expect(log.read(999).cursor).toBe(1)

    database.close()
  })

  it('persists entries and their cursor in SQLite', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'whatsapp-reader-log-'))
    const databasePath = path.join(directory, 'messages.sqlite')
    try {
      const firstDatabase = new AppDatabase(databasePath)
      const firstLog = new OperationalLogBuffer(firstDatabase.logs)
      firstLog.add('info', 'started', 'Iniciado', { attempt: 1 })
      firstDatabase.close()

      const reopenedDatabase = new AppDatabase(databasePath)
      const reopenedLog = new OperationalLogBuffer(reopenedDatabase.logs)
      expect(reopenedLog.read(0)).toMatchObject({
        cursor: 1,
        entries: [{ sequence: 1, event: 'started', details: { attempt: 1 } }],
      })
      reopenedDatabase.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('removes message-content fields before persistence', () => {
    const database = new AppDatabase(':memory:')
    const log = new OperationalLogBuffer(database.logs)
    log.add('warn', 'safe', 'Evento operacional', {
      chatName: 'Equipe',
      messageText: 'conteúdo privado',
      media: true,
    })

    expect(log.read(0).entries[0]?.details).toEqual({ chatName: 'Equipe' })

    log.close()
    database.close()
  })
})
