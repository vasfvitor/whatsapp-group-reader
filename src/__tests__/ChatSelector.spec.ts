import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatSelector from '../components/ChatSelector.vue'

const chats = [
  { id: 'group@g.us', name: 'Equipe', type: 'group' as const, tags: [], selected: false },
  { id: 'person@c.us', name: 'Maria', type: 'contact' as const, tags: [], selected: false },
]

describe('ChatSelector', () => {
  it('emits the canonical chat IDs when the user selects a chat', async () => {
    const wrapper = mount(ChatSelector, {
      props: { chats, selectedChatIds: [], chatTags: {} },
    })

    await wrapper.find('input[type="checkbox"]').setValue(true)

    expect(wrapper.emitted('update:selectedChatIds')?.[0]).toEqual([['group@g.us']])
  })

  it('stores comma-separated local tags for a chat', async () => {
    const wrapper = mount(ChatSelector, {
      props: { chats, selectedChatIds: [], chatTags: {} },
    })
    const tagInput = wrapper.find('input[placeholder="resumir, trabalho"]')

    await tagInput.setValue('Resumir, trabalho, Resumir')
    await tagInput.trigger('change')

    const tagEvents = wrapper.emitted('update:chatTags')
    expect(tagEvents?.[tagEvents.length - 1]).toEqual([{ 'group@g.us': ['Resumir', 'trabalho'] }])
  })

  it('disables refresh and selection while bulk reads are unavailable', () => {
    const wrapper = mount(ChatSelector, {
      props: { chats, selectedChatIds: [], chatTags: {}, disabled: true },
    })

    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
  })
})
