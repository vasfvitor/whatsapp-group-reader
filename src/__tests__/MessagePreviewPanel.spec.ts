import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MessagePreviewPanel from '../components/MessagePreviewPanel.vue'

const chat = {
  id: 'team@g.us',
  name: 'Equipe',
  type: 'group' as const,
  phoneNumber: null,
  isSavedContact: false,
  isBusiness: false,
  tags: [],
  selected: true,
}

describe('MessagePreviewPanel', () => {
  it('loads a selected chat only after an explicit click', async () => {
    const wrapper = mount(MessagePreviewPanel, {
      props: { chats: [chat], messages: [], loading: false, error: null },
    })

    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(wrapper.emitted('load')).toBeUndefined()

    await wrapper.get('select').setValue(chat.id)
    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('load')).toEqual([[chat.id]])
  })

  it('shows full collected text with author and timestamp', () => {
    const wrapper = mount(MessagePreviewPanel, {
      props: {
        chats: [chat],
        loading: false,
        error: null,
        messages: [
          {
            chatId: chat.id,
            chatName: chat.name,
            chatType: 'group',
            messageId: 'one',
            author: 'Ana',
            timestamp: '2026-07-13T15:00:00.000Z',
            text: 'Texto completo\ncom segunda linha',
          },
        ],
      },
    })

    expect(wrapper.text()).toContain('Ana')
    expect(wrapper.text()).toContain('Texto completo\ncom segunda linha')
  })

  it('clears an old sample when the selected chat changes', async () => {
    const secondChat = { ...chat, id: 'other@g.us', name: 'Outra equipe' }
    const wrapper = mount(MessagePreviewPanel, {
      props: { chats: [chat, secondChat], messages: [], loading: false, error: null },
    })

    await wrapper.get('select').setValue(chat.id)
    await wrapper.get('select').setValue(secondChat.id)
    await flushPromises()

    expect(wrapper.emitted('clear')).toHaveLength(2)
  })
})
