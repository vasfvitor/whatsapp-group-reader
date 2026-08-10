import { defineComponent } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { createAppQueryClient } from '@/shared/api/queryClient'

const requestJson = vi.hoisted(() =>
  vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(),
)

vi.mock('@/shared/api/httpClient', () => ({ requestJson }))

import { useMessagePreview } from '../features/messages/useMessagePreview'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

let preview: ReturnType<typeof useMessagePreview>
let wrapper: VueWrapper

const Harness = defineComponent({
  setup() {
    preview = useMessagePreview()
    return () => null
  },
})

function mountPreview(): void {
  wrapper = mount(Harness, {
    global: {
      plugins: [[VueQueryPlugin, { queryClient: createAppQueryClient() }]],
    },
  })
}

afterEach(() => {
  wrapper.unmount()
  vi.clearAllMocks()
})

describe('useMessagePreview', () => {
  it('ignores a response that completes after the preview is cleared', async () => {
    const response = deferred<{ messages: [] }>()
    requestJson.mockReturnValueOnce(response.promise)
    mountPreview()

    preview.load('old@g.us')
    await flushPromises()
    preview.clear()
    response.resolve({ messages: [] })
    await flushPromises()

    expect(preview.messages.value).toEqual([])
    expect(preview.loading.value).toBe(false)
    expect(preview.error.value).toBeNull()
  })

  it('loads the newest selection even when requests overlap', async () => {
    const first = deferred<{ messages: { messageId: string }[] }>()
    const second = deferred<{ messages: { messageId: string }[] }>()
    requestJson.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mountPreview()

    preview.load('first@g.us')
    await flushPromises()
    preview.load('second@g.us')
    await flushPromises()
    second.resolve({ messages: [{ messageId: 'novo' }] })
    first.resolve({ messages: [{ messageId: 'velho' }] })
    await flushPromises()

    expect(preview.messages.value).toEqual([{ messageId: 'novo' }])
  })
})
