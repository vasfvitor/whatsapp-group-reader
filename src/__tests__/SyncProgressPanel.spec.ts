import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { SyncProgress } from '../../shared/contracts'
import SyncProgressPanel from '../components/SyncProgressPanel.vue'

function progress(overrides: Partial<SyncProgress> = {}): SyncProgress {
  return {
    phase: 'running',
    trigger: 'manual',
    totalChats: 10,
    completedChats: 3,
    skippedChats: 1,
    failedChats: 0,
    currentChatId: 'chat@g.us',
    currentChatName: 'Equipe',
    currentChatPosition: 5,
    currentChunkTarget: 50,
    messageLimitPerChat: 500,
    currentFetchedMessages: 42,
    currentEligibleMessages: 35,
    currentInsertedMessages: 18,
    totalFetchedMessages: 120,
    totalEligibleMessages: 80,
    totalInsertedMessages: 31,
    nextActionAt: null,
    ...overrides,
  }
}

describe('SyncProgressPanel', () => {
  it('shows progress and emits pause and cancel actions', async () => {
    const wrapper = mount(SyncProgressPanel, { props: { progress: progress() } })

    expect(wrapper.text()).toContain('40%')
    expect(wrapper.text()).toContain('Equipe')
    expect(wrapper.text()).toContain('conversa 5 de 10')
    expect(wrapper.text()).toContain('Analisadas 42 de até 500')
    expect(wrapper.text()).toContain('18 mensagens novas salvas')

    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('pause')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('offers resume while paused', async () => {
    const wrapper = mount(SyncProgressPanel, {
      props: { progress: progress({ phase: 'paused' }) },
    })

    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('resume')).toHaveLength(1)
  })
})
