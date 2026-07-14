// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { OperationalLogBuffer } from '../operationalLog.js'

describe('OperationalLogBuffer', () => {
  it('keeps only its configured capacity and supports incremental reads', () => {
    const log = new OperationalLogBuffer(2)
    log.add('info', 'first', 'Primeiro')
    log.add('warn', 'second', 'Segundo', { attempt: 1 })
    log.add('error', 'third', 'Terceiro')

    expect(log.read(0).entries.map((entry) => entry.event)).toEqual(['second', 'third'])
    expect(log.read(2).entries.map((entry) => entry.event)).toEqual(['third'])
  })

  it('returns the current buffer when a client cursor came from a restarted server', () => {
    const log = new OperationalLogBuffer()
    log.add('info', 'started', 'Iniciado')

    expect(log.read(999).entries).toHaveLength(1)
    expect(log.read(999).cursor).toBe(1)
  })
})
