// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import type { MessageRecord } from '../../shared/contracts.js'
import { MessageDatabase } from '../database.js'

let database: MessageDatabase | null = null

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

describe('MessageDatabase', () => {
  it('deduplicates message IDs and maintains a per-chat checkpoint', () => {
    database = new MessageDatabase(':memory:')
    const message = record('one', 'chat@g.us', '2026-07-13T12:00:00.000Z')

    expect(database.saveMessage(message, 100)).toBe(true)
    expect(database.saveMessage(message, 100)).toBe(false)
    expect(database.countMessages()).toBe(1)
    expect(database.getCheckpoint('chat@g.us')).toEqual({
      chatId: 'chat@g.us',
      lastTimestampUnix: 100,
      lastMessageId: 'one',
    })
  })

  it('exports the newest N messages per chat in chronological order', () => {
    database = new MessageDatabase(':memory:')
    const times = [100, 200, 300]
    for (const timestamp of times) {
      database.saveMessage(
        record(`a-${timestamp}`, 'a@g.us', new Date(timestamp * 1000).toISOString()),
        timestamp,
      )
      database.saveMessage(
        record(`b-${timestamp}`, 'b@g.us', new Date((timestamp + 1) * 1000).toISOString()),
        timestamp + 1,
      )
    }

    const result = database.queryMessages({
      fromUnix: 0,
      toUnix: 1000,
      limitPerChat: 2,
      chatIds: ['a@g.us', 'b@g.us'],
    })

    expect(result).toHaveLength(4)
    expect(result.map((message) => message.messageId)).toEqual(['a-200', 'b-200', 'a-300', 'b-300'])
  })

  it('persists sync attempts, completion, failures and cancellation per chat', () => {
    database = new MessageDatabase(':memory:')
    const attemptedAt = '2026-07-13T12:00:00.000Z'
    const completedAt = '2026-07-13T12:01:00.000Z'

    database.markChatSyncAttempt('chat@g.us', attemptedAt)
    expect(database.getChatSyncState('chat@g.us')).toEqual({
      chatId: 'chat@g.us',
      lastAttemptAt: attemptedAt,
      lastCompletedAt: null,
      lastStatus: 'running',
      lastError: null,
    })

    database.markChatSyncCompleted('chat@g.us', completedAt)
    expect(database.getChatSyncState('chat@g.us')?.lastStatus).toBe('completed')
    expect(database.getChatSyncState('chat@g.us')?.lastCompletedAt).toBe(completedAt)

    database.markChatSyncAttempt('chat@g.us', '2026-07-13T12:02:00.000Z')
    database.markChatSyncFailed('chat@g.us', 'falhou')
    expect(database.getChatSyncState('chat@g.us')?.lastError).toBe('falhou')

    database.markChatSyncAttempt('chat@g.us', '2026-07-13T12:03:00.000Z')
    database.markChatSyncCancelled('chat@g.us')
    expect(database.getChatSyncState('chat@g.us')?.lastStatus).toBe('cancelled')
  })

  it('returns the 20 newest messages for a single-chat preview', () => {
    database = new MessageDatabase(':memory:')
    for (let timestamp = 1; timestamp <= 25; timestamp += 1) {
      database.saveMessage(
        record(`message-${timestamp}`, 'preview@g.us', new Date(timestamp * 1000).toISOString()),
        timestamp,
      )
    }

    const result = database.previewMessages('preview@g.us')

    expect(result).toHaveLength(20)
    expect(result[0]?.messageId).toBe('message-25')
    expect(result[result.length - 1]?.messageId).toBe('message-6')
  })

  it('removes operational logs older than seven days', () => {
    database = new MessageDatabase(':memory:')
    database.appendOperationalLog({
      timestamp: '2026-07-01T12:00:00.000Z',
      level: 'info',
      event: 'old',
      message: 'Antigo',
      details: {},
    })
    database.appendOperationalLog({
      timestamp: '2026-07-13T12:00:00.000Z',
      level: 'info',
      event: 'recent',
      message: 'Recente',
      details: {},
    })

    database.pruneOperationalLogs(new Date('2026-07-13T13:00:00.000Z'))

    expect(database.listOperationalLogs().map((entry) => entry.event)).toEqual(['recent'])
  })

  it('keeps at most ten thousand operational logs', () => {
    database = new MessageDatabase(':memory:')
    for (let sequence = 1; sequence <= 10_001; sequence += 1) {
      database.appendOperationalLog({
        timestamp: '2026-07-13T12:00:00.000Z',
        level: 'info',
        event: `event-${sequence}`,
        message: 'Evento',
        details: {},
      })
    }

    const logs = database.listOperationalLogs()
    expect(logs).toHaveLength(10_000)
    expect(logs[0]?.event).toBe('event-2')
    expect(logs[logs.length - 1]?.event).toBe('event-10001')
  })
})
