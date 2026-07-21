import { describe, expect, it, vi } from 'vitest'

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

describe('useMessagePreview', () => {
  it('ignores a response that completes after the preview is cleared', async () => {
    const response = deferred<{ messages: [] }>()
    requestJson.mockReturnValueOnce(response.promise)
    const preview = useMessagePreview()

    const loading = preview.load('old@g.us')
    preview.clear()
    response.resolve({ messages: [] })
    await loading

    expect(preview.messages.value).toEqual([])
    expect(preview.loading.value).toBe(false)
    expect(preview.error.value).toBeNull()
  })
})
