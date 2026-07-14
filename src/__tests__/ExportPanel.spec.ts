import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ExportPanel from '../features/exports/ExportPanel.vue'

function mountPanel() {
  return mount(ExportPanel, {
    props: {
      settings: {
        lookbackHours: 24,
        maxMessagesPerChat: 500,
        loadProfile: 'conservative',
      },
      syncing: false,
      exporting: false,
      ready: true,
      lastExport: null,
      dataDirectory: '',
    },
  })
}

describe('ExportPanel', () => {
  it('offers regular and forced synchronization as separate actions', async () => {
    const wrapper = mountPanel()
    const buttons = wrapper.findAll('button')

    await buttons.find((button) => button.text() === 'Sincronizar agora')!.trigger('click')
    await buttons.find((button) => button.text() === 'Forçar nova consulta')!.trigger('click')

    expect(wrapper.emitted('sync')).toHaveLength(1)
    expect(wrapper.emitted('forceSync')).toHaveLength(1)
  })

  it('does not export an invalid date range', async () => {
    const wrapper = mountPanel()
    const dateInputs = wrapper.findAll('input[type="datetime-local"]')

    await dateInputs[0]!.setValue('')

    expect(wrapper.get('[role="alert"]').text()).toBe('Informe uma data inicial válida.')
    expect(wrapper.findAll('button').find((button) => button.text() === 'Baixar JSONL')!.attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('export')).toBeUndefined()
  })
})
