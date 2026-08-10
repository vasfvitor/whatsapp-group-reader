// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import type { MessageRecord } from '../../shared/contracts.js'
import { AppDatabase } from '../database.js'

let database: AppDatabase | null = null

function record(messageId: string, chatId: string, timestamp: string): MessageRecord {
  return {
    chatId,
    chatName: chatId,
    chatType: 'group',
    messageId,
    author: 'Pessoa',
    timestamp,
    text: `Texto ${messageId}`,
  }
}

afterEach(() => {
  database?.close()
  database = null
})

describe('AppDatabase', () => {
  it('deduplicates message IDs and maintains a per-chat checkpoint', () => {
    database = new AppDatabase(':memory:')
    const message = record('one', 'chat@g.us', '2026-07-13T12:00:00.000Z')

    expect(database.messages.save(message, 100)).toBe(true)
    expect(database.messages.save(message, 100)).toBe(false)
    expect(database.messages.count()).toBe(1)
    expect(database.messages.getCheckpoint('chat@g.us')).toEqual({
      chatId: 'chat@g.us',
      lastTimestampUnix: 100,
      lastMessageId: 'one',
    })
  })

  it('exports the newest N messages per chat in chronological order', () => {
    database = new AppDatabase(':memory:')
    const times = [100, 200, 300]
    for (const timestamp of times) {
      database.messages.save(
        record(`a-${timestamp}`, 'a@g.us', new Date(timestamp * 1000).toISOString()),
        timestamp,
      )
      database.messages.save(
        record(`b-${timestamp}`, 'b@g.us', new Date((timestamp + 1) * 1000).toISOString()),
        timestamp + 1,
      )
    }

    const result = database.messages.query({
      fromUnix: 0,
      toUnix: 1000,
      limitPerChat: 2,
      chatIds: ['a@g.us', 'b@g.us'],
    })

    expect(result).toHaveLength(4)
    expect(result.map((message) => message.messageId)).toEqual(['a-200', 'b-200', 'a-300', 'b-300'])
  })

  it('persists sync attempts, completion, failures and cancellation per chat', () => {
    database = new AppDatabase(':memory:')
    const attemptedAt = '2026-07-13T12:00:00.000Z'
    const completedAt = '2026-07-13T12:01:00.000Z'

    database.syncStates.markAttempt('chat@g.us', attemptedAt)
    expect(database.syncStates.get('chat@g.us')).toEqual({
      chatId: 'chat@g.us',
      lastAttemptAt: attemptedAt,
      lastCompletedAt: null,
      lastStatus: 'running',
      lastError: null,
    })

    database.syncStates.markCompleted('chat@g.us', completedAt)
    expect(database.syncStates.get('chat@g.us')?.lastStatus).toBe('completed')
    expect(database.syncStates.get('chat@g.us')?.lastCompletedAt).toBe(completedAt)

    database.syncStates.markAttempt('chat@g.us', '2026-07-13T12:02:00.000Z')
    database.syncStates.markFailed('chat@g.us', 'falhou')
    expect(database.syncStates.get('chat@g.us')?.lastError).toBe('falhou')

    database.syncStates.markAttempt('chat@g.us', '2026-07-13T12:03:00.000Z')
    database.syncStates.markCancelled('chat@g.us')
    expect(database.syncStates.get('chat@g.us')?.lastStatus).toBe('cancelled')
  })

  it('returns the 20 newest messages for a single-chat preview', () => {
    database = new AppDatabase(':memory:')
    for (let timestamp = 1; timestamp <= 25; timestamp += 1) {
      database.messages.save(
        record(`message-${timestamp}`, 'preview@g.us', new Date(timestamp * 1000).toISOString()),
        timestamp,
      )
    }

    const result = database.messages.preview('preview@g.us')

    expect(result).toHaveLength(20)
    expect(result[0]?.messageId).toBe('message-25')
    expect(result[result.length - 1]?.messageId).toBe('message-6')
  })

  it('removes operational logs older than seven days', () => {
    database = new AppDatabase(':memory:')
    database.logs.append({
      timestamp: '2026-07-01T12:00:00.000Z',
      level: 'info',
      event: 'old',
      message: 'Antigo',
      details: {},
    })
    database.logs.append({
      timestamp: '2026-07-13T12:00:00.000Z',
      level: 'info',
      event: 'recent',
      message: 'Recente',
      details: {},
    })

    database.logs.prune(new Date('2026-07-13T13:00:00.000Z'))

    expect(database.logs.list().map((entry) => entry.event)).toEqual(['recent'])
  })

  it('keeps at most ten thousand operational logs', () => {
    database = new AppDatabase(':memory:')
    for (let sequence = 1; sequence <= 10_001; sequence += 1) {
      database.logs.append({
        timestamp: '2026-07-13T12:00:00.000Z',
        level: 'info',
        event: `event-${sequence}`,
        message: 'Evento',
        details: {},
      })
    }

    const logs = database.logs.list()
    expect(logs).toHaveLength(10_000)
    expect(logs[0]?.event).toBe('event-2')
    expect(logs[logs.length - 1]?.event).toBe('event-10001')
  })
})
