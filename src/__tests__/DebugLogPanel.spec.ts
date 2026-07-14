import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DebugLogPanel from '../components/DebugLogPanel.vue'

describe('DebugLogPanel', () => {
  it('is collapsed by default and renders structured events without message content', () => {
    const wrapper = mount(DebugLogPanel, {
      props: {
        entries: [
          {
            sequence: 1,
            timestamp: '2026-07-13T20:41:27.000Z',
            level: 'warn',
            event: 'read_retry',
            message: 'Nova tentativa após uma pausa.',
            details: { retry: 1, delayMs: 5400 },
          },
        ],
      },
    })

    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(wrapper.text()).toContain('1 eventos recentes')
    expect(wrapper.text()).toContain('read_retry')
    expect(wrapper.text()).toContain('delayMs=5400')
    expect(wrapper.text()).toContain('não contém o texto das mensagens')
  })
})
