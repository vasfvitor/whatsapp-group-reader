import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatSelector from '../features/chat-selection/ChatSelector.vue'

const chats = [
  {
    id: 'group@g.us',
    name: 'Equipe',
    type: 'group' as const,
    phoneNumber: null,
    isSavedContact: false,
    isBusiness: false,
    tags: [],
    selected: false,
  },
  {
    id: 'person@c.us',
    name: 'Maria',
    type: 'contact' as const,
    phoneNumber: '5511999999999',
    isSavedContact: true,
    isBusiness: true,
    tags: [],
    selected: false,
  },
]

describe('ChatSelector', () => {
  it('emits the canonical chat IDs when the user selects a chat', async () => {
    const wrapper = mount(ChatSelector, {
      props: { chats, selectedChatIds: [] },
    })

    await wrapper.find('input[type="checkbox"]').setValue(true)

    expect(wrapper.emitted('update:selectedChatIds')?.[0]).toEqual([['group@g.us']])
  })

  it('disables refresh and selection while bulk reads are unavailable', () => {
    const wrapper = mount(ChatSelector, {
      props: { chats, selectedChatIds: [], disabled: true },
    })

    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
  })

  it('shows each conversation as a compact name and type', () => {
    const wrapper = mount(ChatSelector, {
      props: { chats, selectedChatIds: [] },
    })

    expect(wrapper.get('[aria-label="Equipe — Grupo"]').attributes('aria-label')).toBe(
      'Equipe — Grupo',
    )
    expect(wrapper.get('[aria-label="Maria — Contato"]').attributes('aria-label')).toBe(
      'Maria — Contato',
    )
    expect(wrapper.text()).not.toContain('Tags locais')
  })
})
