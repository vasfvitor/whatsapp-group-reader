// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ExportRequest, MessageRecord } from '../../shared/contracts.js'
import { toJsonl, toLlmText } from '../exportService.js'

const request: ExportRequest = {
  from: '2026-08-09T20:00:00.000Z',
  to: '2026-08-10T20:00:00.000Z',
  limitPerChat: 500,
  format: 'text',
}

function record(overrides: Partial<MessageRecord>): MessageRecord {
  return {
    chatId: 'dev@g.us',
    chatName: 'Equipe Projeto Alfa',
    chatType: 'group',
    messageId: 'msg-1',
    author: 'Ana',
    timestamp: '2026-08-09T20:17:30.000Z',
    text: 'Boa tarde',
    ...overrides,
  }
}

describe('toLlmText', () => {
  it('inclui contexto inicial e delimita cada conversa com marcadores de início/fim', () => {
    const text = toLlmText(
      [
        record({}),
        record({ messageId: 'msg-2', text: 'Atualizei o cronograma do projeto' }),
        record({
          chatId: 'contato@c.us',
          chatName: 'Operadora Exemplo',
          chatType: 'contact',
          messageId: 'msg-3',
          author: 'Atendimento',
          text: 'Seu boleto foi emitido',
        }),
      ],
      request,
    )

    expect(text).toContain('Mensagens exportadas do WhatsApp')
    expect(text).toContain('Conversas: 2. Mensagens: 3.')
    expect(text).toContain('===== INÍCIO GRUPO: Equipe Projeto Alfa =====')
    expect(text).toContain('===== FIM GRUPO: Equipe Projeto Alfa =====')
    expect(text).toContain('===== INÍCIO CONVERSA: Operadora Exemplo =====')
    expect(text).toContain('===== FIM CONVERSA: Operadora Exemplo =====')
    expect(text).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] Ana: Boa tarde$/m)

    const groupEnd = text.indexOf('===== FIM GRUPO')
    expect(text.indexOf('Atualizei o cronograma do projeto')).toBeLessThan(groupEnd)
    expect(text.indexOf('Seu boleto foi emitido')).toBeGreaterThan(groupEnd)
  })

  it('mantém os marcadores mesmo com uma única conversa', () => {
    const text = toLlmText([record({})], request)
    expect(text).toContain('Conversas: 1. Mensagens: 1.')
    expect(text).toContain('===== INÍCIO GRUPO: Equipe Projeto Alfa =====')
  })
})

describe('toJsonl', () => {
  it('serializa uma mensagem por linha', () => {
    const jsonl = toJsonl([record({}), record({ messageId: 'msg-2' })])
    const lines = jsonl.trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)).toMatchObject({ chatName: 'Equipe Projeto Alfa' })
  })
})
