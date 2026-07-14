import { shallowReadonly, shallowRef } from 'vue'
import type { ExportRequest, ExportResult } from '@shared/contracts'
import { requestJson } from '@/shared/api/httpClient'
import type { RunOperation } from '@/app/applicationTypes'

export function useExports(run: RunOperation) {
  const exporting = shallowRef(false)
  const lastExport = shallowRef<ExportResult | null>(null)
  async function createExport(request: ExportRequest): Promise<void> {
    exporting.value = true
    const result = await run(() =>
      requestJson<ExportResult>('/api/exports', {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    )
    exporting.value = false
    if (!result) return
    lastExport.value = result
    const link = document.createElement('a')
    link.href = result.downloadUrl
    link.download = result.fileName
    link.click()
  }
  async function openDataDirectory(): Promise<void> {
    await run(() => requestJson<void>('/api/data-directory/open', { method: 'POST' }))
  }
  return {
    exporting: shallowReadonly(exporting),
    lastExport: shallowReadonly(lastExport),
    createExport,
    openDataDirectory,
  }
}
