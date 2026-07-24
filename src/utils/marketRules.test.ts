import { describe, expect, it } from 'vitest'
import { isHistoricalSt, resolvePriceLimitRate } from './marketRules'

describe('resolvePriceLimitRate', () => {
  it('uses board-specific limits and the main-board ST transition date', () => {
    expect(resolvePriceLimitRate({ stockCode: '300001', tradeDate: '2025-01-02', isSt: false })).toBe(0.2)
    expect(resolvePriceLimitRate({ stockCode: '688001', tradeDate: '2025-01-02', isSt: true })).toBe(0.2)
    expect(resolvePriceLimitRate({ stockCode: '830001', tradeDate: '2025-01-02', isSt: false })).toBe(0.3)
    expect(resolvePriceLimitRate({ stockCode: '600001', tradeDate: '2026-07-05', isSt: true })).toBe(0.05)
    expect(resolvePriceLimitRate({ stockCode: '600001', tradeDate: '2026-07-06', isSt: true })).toBe(0.1)
  })

  it('prefers an explicit backend rate and represents no-limit days as null', () => {
    expect(
      resolvePriceLimitRate({
        stockCode: '600001',
        tradeDate: '2025-01-02',
        isSt: false,
        explicitRate: 0.15
      })
    ).toBe(0.15)
    expect(
      resolvePriceLimitRate({
        stockCode: '600001',
        tradeDate: '2025-01-02',
        isSt: false,
        noPriceLimit: true
      })
    ).toBeNull()
    expect(
      resolvePriceLimitRate({
        stockCode: '600001',
        tradeDate: '2025-01-02',
        isSt: false,
        explicitRate: null
      })
    ).toBeNull()
  })
})

describe('isHistoricalSt', () => {
  it('prefers daily historical data and falls back to historical stock metadata or name', () => {
    expect(isHistoricalSt({ name: '普通股份', st: 0 }, { historySt: 1 })).toBe(true)
    expect(isHistoricalSt({ name: '普通股份', historySt: 1 }, undefined)).toBe(true)
    expect(isHistoricalSt({ name: '*ST 示例', historySt: 0 }, undefined)).toBe(true)
    expect(isHistoricalSt({ name: '普通股份', st: 0 }, { historySt: 0 })).toBe(false)
  })
})
