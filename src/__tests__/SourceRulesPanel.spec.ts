import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SourceRulesPanel from '../features/chat-selection/SourceRulesPanel.vue'

describe('SourceRulesPanel', () => {
  it('adds a rule and asks the parent to apply confirmed candidates', async () => {
    const wrapper = mount(SourceRulesPanel, { props: { sources: [], chats: [] } })

    await wrapper.find('input').setValue('Diretoria')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('update:sources')?.[0]).toEqual([
      [{ type: 'exact', value: 'Diretoria' }],
    ])
  })
})
