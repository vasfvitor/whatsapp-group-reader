import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SyncSettingsForm from '../features/sync/SyncSettingsForm.vue'

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

    await wrapper.get('select[name="loadProfile"]').setValue('balanced')

    const events = wrapper.emitted('update:settings') ?? []
    expect(events[events.length - 1]).toEqual([
      { lookbackHours: 24, maxMessagesPerChat: 500, loadProfile: 'balanced' },
    ])
  })

  it('offers common time ranges and a custom hour input', async () => {
    const wrapper = mount(SyncSettingsForm, {
      props: {
        settings: {
          lookbackHours: 24,
          maxMessagesPerChat: 500,
          loadProfile: 'conservative',
        },
      },
    })

    const timeRange = wrapper.get('select[name="timeRange"]')
    expect(timeRange.text()).toContain('Últimas 24 horas')
    expect(timeRange.text()).toContain('Últimos 7 dias')
    await timeRange.setValue('168')
    const rangeEvents = wrapper.emitted('update:settings') ?? []
    expect(rangeEvents[rangeEvents.length - 1]).toEqual([
      { lookbackHours: 168, maxMessagesPerChat: 500, loadProfile: 'conservative' },
    ])

    await timeRange.setValue('custom')
    expect(wrapper.text()).toContain('Horas')
  })

  it('clamps the per-conversation limit to 1000', async () => {
    const wrapper = mount(SyncSettingsForm, {
      props: {
        settings: {
          lookbackHours: 24,
          maxMessagesPerChat: 500,
          loadProfile: 'conservative',
        },
      },
    })

    const messageLimit = wrapper.get('input[max="1000"]')
    await messageLimit.setValue('2000')

    const limitEvents = wrapper.emitted('update:settings') ?? []
    expect(limitEvents[limitEvents.length - 1]).toEqual([
      { lookbackHours: 24, maxMessagesPerChat: 1000, loadProfile: 'conservative' },
    ])
  })
})
