// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  evaluateHistoryPage,
  sampleExponentialBackoff,
  sampleInteger,
  sampleTruncatedGaussian,
  shuffled,
  type RandomSource,
} from '../loadControl.js'

function constantRandom(value: number): RandomSource {
  return { next: () => value }
}

describe('load control', () => {
  it('keeps gaussian samples inside the configured bounds', () => {
    const range = { mean: 100, standardDeviation: 20, min: 60, max: 140 }
    const sample = sampleTruncatedGaussian(range, constantRandom(0.5))

    expect(sample).toBeGreaterThanOrEqual(60)
    expect(sample).toBeLessThanOrEqual(140)
  })

  it('falls back to the mean after repeated out-of-range samples', () => {
    const range = { mean: 10, standardDeviation: 100, min: 9, max: 11 }

    expect(sampleInteger(range, constantRandom(Number.EPSILON))).toBe(10)
  })

  it('applies capped exponential backoff with bounded jitter', () => {
    const policy = { baseMs: 2_000, maxMs: 60_000, maxRetries: 2, jitterRatio: 0.2 }

    expect(sampleExponentialBackoff(policy, 0, constantRandom(0))).toBe(1_600)
    expect(sampleExponentialBackoff(policy, 1, constantRandom(0.5))).toBe(4_000)
    expect(sampleExponentialBackoff(policy, 2, constantRandom(1))).toBe(9_600)
    expect(sampleExponentialBackoff(policy, 20, constantRandom(1))).toBe(60_000)
  })

  it('shuffles without mutating the source list', () => {
    const source = ['a', 'b', 'c']

    expect(shuffled(source, constantRandom(0))).toEqual(['b', 'c', 'a'])
    expect(source).toEqual(['a', 'b', 'c'])
  })

  it('stops when it reaches the original checkpoint', () => {
    const decision = evaluateHistoryPage({
      messageIds: ['new', 'checkpoint'],
      timestamps: [200, 100],
      returnedCount: 2,
      target: 2,
      maximum: 500,
      cutoffTimestamp: 50,
      checkpoint: { chatId: 'chat', lastMessageId: 'checkpoint', lastTimestampUnix: 100 },
    })

    expect(decision).toEqual({ stop: true, gapRisk: false })
  })

  it('stops on cutoff, exhausted history, or maximum and flags only a possible gap', () => {
    const base = {
      messageIds: ['one'],
      timestamps: [200],
      returnedCount: 50,
      target: 50,
      maximum: 500,
      cutoffTimestamp: 100,
      checkpoint: null,
    }

    expect(evaluateHistoryPage({ ...base, timestamps: [100] }).stop).toBe(true)
    expect(evaluateHistoryPage({ ...base, returnedCount: 49 }).stop).toBe(true)
    expect(evaluateHistoryPage({ ...base, target: 500, returnedCount: 500 })).toEqual({
      stop: true,
      gapRisk: true,
    })
  })
})
