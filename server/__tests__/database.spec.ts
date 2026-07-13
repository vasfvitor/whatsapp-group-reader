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
})
