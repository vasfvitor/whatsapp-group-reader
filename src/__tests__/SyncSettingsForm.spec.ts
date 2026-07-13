import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SyncSettingsForm from '../components/SyncSettingsForm.vue'

describe('SyncSettingsForm', () => {
  it('emits the selected load profile with the existing limits', async () => {
    const wrapper = mount(SyncSettingsForm, {
      props: {
        settings: {
          lookbackHours: 24,
          maxMessagesPerChat: 500,
          loadProfile: 'conservative',
        },
      },
    })

    await wrapper.get('select').setValue('balanced')

    const events = wrapper.emitted('update:settings') ?? []
    expect(events[events.length - 1]).toEqual([
      { lookbackHours: 24, maxMessagesPerChat: 500, loadProfile: 'balanced' },
    ])
  })
})
