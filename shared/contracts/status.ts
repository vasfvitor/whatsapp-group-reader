import type { SyncProgress } from './sync.js'

export type ConnectionState =
  | 'starting'
  | 'awaiting_qr'
  | 'authenticated'
  | 'ready'
  | 'syncing'
  | 'reconnecting'
  | 'invalid_session'
  | 'stopped'

export interface AppStatus {
  state: ConnectionState
  qrDataUrl: string | null
  message: string
  lastError: string | null
  lastSyncAt: string | null
  collectedMessages: number
  selectedChats: number
  dataDirectory: string
  warnings: string[]
  syncProgress: SyncProgress
}
