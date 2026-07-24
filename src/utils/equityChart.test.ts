import { describe, expect, it } from 'vitest'
import type { HistoricalBacktestDailyRecord } from '../types/market'
import { buildEquityChartModel, nearestEquityPointIndex, panEquityRange, zoomEquityRange } from './equityChart'

const records: HistoricalBacktestDailyRecord[] = [
  {
    id: 1,
    tradeDate: '2026-07-20',
    accountStatus: 0,
    totalAsset: 102_000,
    dailyReturnRate: 0.02,
    cumulativeReturnRate: 0.02
  },
  {
    id: 2,
    tradeDate: '2026-07-21',
    accountStatus: 1,
    symbol: '600001',
    symbolName: '示例股份',
    totalAsset: 99_000,
    dailyReturnRate: -0.029_412,
    cumulativeReturnRate: -0.01
  },
  {
    id: 3,
    tradeDate: '2026-07-22',
    accountStatus: 1,
    symbol: '600001',
    symbolName: '示例股份',
    totalAsset: 105_000,
    dailyReturnRate: 0.060_606,
    cumulativeReturnRate: 0.05
  }
]

describe('buildEquityChartModel', () => {
  it('builds a padded zero-inclusive curve with record details on every point', () => {
    const model = buildEquityChartModel(records)
    if (!model) throw new Error('expected an equity chart model')

    expect(model.min).toBeCloseTo(-0.02)
    expect(model.max).toBeCloseTo(0.06)
    expect(model.zeroY).toBeGreaterThan(model.top)
    expect(model.zeroY).toBeLessThan(model.bottom)
    expect(model.points).toHaveLength(3)
    expect(model.points[1]).toMatchObject({
      index: 1,
      tradeDate: '2026-07-21',
      cumulativeReturnRate: -0.01,
      dailyReturnRate: -0.029_412,
      totalAsset: 99_000,
      accountStatus: 1,
      symbolName: '示例股份'
    })
    expect(model.linePath).toMatch(/^M /)
    expect(model.areaPath).toMatch(/ Z$/)
    expect(model.xTicks.map((tick) => tick.label)).toEqual(['2026-07-20', '2026-07-21', '2026-07-22'])
  })
})

describe('nearestEquityPointIndex', () => {
  it('clamps to chart edges and selects the closest trading day', () => {
    const model = buildEquityChartModel(records)
    if (!model) throw new Error('expected an equity chart model')
    const points = model.points

    expect(nearestEquityPointIndex(points, 0)).toBe(0)
    expect(nearestEquityPointIndex(points, 560)).toBe(1)
    expect(nearestEquityPointIndex(points, 2_000)).toBe(2)
  })

  it('returns no index for an empty series', () => {
    expect(nearestEquityPointIndex([], 500)).toBeNull()
  })
})

describe('zoomEquityRange', () => {
  it('zooms in without moving the focused point within the visible area', () => {
    const current = { start: 0, end: 100 }
    const next = zoomEquityRange(current, 100, 20, 'in')

    expect(next).toEqual({ start: 4, end: 84 })
    expect((20 - next.start) / (next.end - next.start - 1)).toBeCloseTo(20 / 99, 2)
  })

  it('zooms out around the focused point and restores the complete range', () => {
    expect(zoomEquityRange({ start: 20, end: 60 }, 100, 30, 'out')).toEqual({
      start: 17,
      end: 67
    })
    expect(zoomEquityRange({ start: 10, end: 90 }, 100, 50, 'out')).toEqual({
      start: 0,
      end: 100
    })
  })

  it('clamps the focus and never zooms below the minimum visible point count', () => {
    expect(zoomEquityRange({ start: 0, end: 12 }, 100, -10, 'in', 10)).toEqual({
      start: 0,
      end: 10
    })
    expect(zoomEquityRange({ start: 0, end: 10 }, 100, 200, 'in', 10)).toEqual({
      start: 0,
      end: 10
    })
  })
})

describe('panEquityRange', () => {
  it('moves the visible window earlier or later without changing its size', () => {
    expect(panEquityRange({ start: 20, end: 60 }, 100, -15)).toEqual({
      start: 5,
      end: 45
    })
    expect(panEquityRange({ start: 20, end: 60 }, 100, 10)).toEqual({
      start: 30,
      end: 70
    })
  })

  it('clamps the visible window at both data boundaries', () => {
    expect(panEquityRange({ start: 20, end: 60 }, 100, -100)).toEqual({
      start: 0,
      end: 40
    })
    expect(panEquityRange({ start: 20, end: 60 }, 100, 100)).toEqual({
      start: 60,
      end: 100
    })
  })

  it('does not move a complete range', () => {
    expect(panEquityRange({ start: 0, end: 100 }, 100, 20)).toEqual({
      start: 0,
      end: 100
    })
  })
})
