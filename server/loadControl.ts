import { randomInt } from 'node:crypto'
import type { LoadProfile } from '../shared/contracts.js'
import type { Checkpoint } from './database.js'

export interface GaussianRange {
  mean: number
  standardDeviation: number
  min: number
  max: number
}

export interface LoadProfileSettings {
  betweenChunksMs: GaussianRange
  betweenChatsMs: GaussianRange
  periodicPauseMs: GaussianRange
  chatsPerBatch: GaussianRange
  automaticCooldownMs: number
}

export interface RandomSource {
  next(): number
}

const CRYPTO_RANGE = 0x1_0000_0000

export const cryptoRandomSource: RandomSource = {
  next: () => randomInt(CRYPTO_RANGE) / CRYPTO_RANGE,
}

export const LOAD_PROFILES: Record<LoadProfile, LoadProfileSettings> = {
  balanced: {
    betweenChunksMs: { mean: 2_500, standardDeviation: 750, min: 1_000, max: 5_000 },
    betweenChatsMs: { mean: 5_000, standardDeviation: 1_500, min: 2_000, max: 9_000 },
    periodicPauseMs: { mean: 45_000, standardDeviation: 15_000, min: 20_000, max: 90_000 },
    chatsPerBatch: { mean: 18, standardDeviation: 4, min: 12, max: 26 },
    automaticCooldownMs: 30 * 60_000,
  },
  conservative: {
    betweenChunksMs: { mean: 5_000, standardDeviation: 1_500, min: 2_000, max: 9_000 },
    betweenChatsMs: { mean: 12_000, standardDeviation: 3_000, min: 6_000, max: 20_000 },
    periodicPauseMs: {
      mean: 120_000,
      standardDeviation: 30_000,
      min: 60_000,
      max: 210_000,
    },
    chatsPerBatch: { mean: 10, standardDeviation: 2, min: 6, max: 14 },
    automaticCooldownMs: 60 * 60_000,
  },
}

export function sampleTruncatedGaussian(
  range: GaussianRange,
  random: RandomSource = cryptoRandomSource,
): number {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const first = Math.max(random.next(), Number.EPSILON)
    const second = random.next()
    const standardNormal = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second)
    const sample = range.mean + range.standardDeviation * standardNormal
    if (sample >= range.min && sample <= range.max) return sample
  }
  return range.mean
}

export function sampleMilliseconds(
  range: GaussianRange,
  random: RandomSource = cryptoRandomSource,
): number {
  return Math.round(sampleTruncatedGaussian(range, random))
}

export function sampleInteger(
  range: GaussianRange,
  random: RandomSource = cryptoRandomSource,
): number {
  return Math.round(sampleTruncatedGaussian(range, random))
}

export function shuffled<T>(items: readonly T[], random: RandomSource = cryptoRandomSource): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random.next() * (index + 1))
    ;[result[index], result[other]] = [result[other]!, result[index]!]
  }
  return result
}

export interface HistoryPageDecisionInput {
  messageIds: string[]
  timestamps: number[]
  returnedCount: number
  target: number
  maximum: number
  cutoffTimestamp: number
  checkpoint: Checkpoint | null
}

export interface HistoryPageDecision {
  stop: boolean
  gapRisk: boolean
}

export function evaluateHistoryPage(input: HistoryPageDecisionInput): HistoryPageDecision {
  const oldestTimestamp = input.timestamps.length ? Math.min(...input.timestamps) : null
  const checkpointReached = Boolean(
    input.checkpoint &&
    (input.messageIds.includes(input.checkpoint.lastMessageId) ||
      (oldestTimestamp !== null && oldestTimestamp <= input.checkpoint.lastTimestampUnix)),
  )
  const cutoffReached = oldestTimestamp !== null && oldestTimestamp <= input.cutoffTimestamp
  const historyExhausted = input.returnedCount < input.target
  const maximumReached = input.target >= input.maximum
  const gapRisk =
    maximumReached &&
    !checkpointReached &&
    !cutoffReached &&
    !historyExhausted &&
    oldestTimestamp !== null

  return {
    stop: checkpointReached || cutoffReached || historyExhausted || maximumReached,
    gapRisk,
  }
}
