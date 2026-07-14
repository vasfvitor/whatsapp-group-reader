import { z } from 'zod'

export const syncRequestSchema = z.object({ forceRecent: z.boolean().default(false) })

export type SyncPhase = 'idle' | 'running' | 'paused'
export type SyncTrigger = 'automatic' | 'manual'

export interface SyncProgress {
  phase: SyncPhase
  trigger: SyncTrigger | null
  totalChats: number
  completedChats: number
  skippedChats: number
  failedChats: number
  currentChatId: string | null
  currentChatName: string | null
  currentChatPosition: number | null
  currentChunkTarget: number | null
  messageLimitPerChat: number
  currentFetchedMessages: number
  currentEligibleMessages: number
  currentInsertedMessages: number
  totalFetchedMessages: number
  totalEligibleMessages: number
  totalInsertedMessages: number
  nextActionAt: string | null
}

export function createIdleSyncProgress(): SyncProgress {
  return {
    phase: 'idle',
    trigger: null,
    totalChats: 0,
    completedChats: 0,
    skippedChats: 0,
    failedChats: 0,
    currentChatId: null,
    currentChatName: null,
    currentChatPosition: null,
    currentChunkTarget: null,
    messageLimitPerChat: 0,
    currentFetchedMessages: 0,
    currentEligibleMessages: 0,
    currentInsertedMessages: 0,
    totalFetchedMessages: 0,
    totalEligibleMessages: 0,
    totalInsertedMessages: 0,
    nextActionAt: null,
  }
}
