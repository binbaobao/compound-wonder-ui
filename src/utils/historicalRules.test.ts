import { describe, expect, it } from 'vitest'
import type { HistoricalBacktestRule } from '../types/market'
import { findHistoricalRules } from './historicalRules'

const rules: HistoricalBacktestRule[] = [
  {
    id: 3,
    actionType: 2,
    ruleCode: 201,
    symbol: '600001',
    tradeDate: '2026-07-22',
    time: 100_100_000,
    price: 1_010
  },
  {
    id: 2,
    actionType: 1,
    ruleCode: 101,
    symbol: '600001',
    tradeDate: '2026-07-22',
    time: 92_500_000,
    price: 1_000
  },
  {
    id: 1,
    actionType: 1,
    ruleCode: 101,
    symbol: '600001',
    tradeDate: '2026-07-21',
    time: 93_100_000,
    price: 980
  },
  {
    id: 4,
    actionType: 1,
    ruleCode: 102,
    symbol: '000001',
    tradeDate: '2026-07-22',
    time: 93_000_000,
    price: 1_200
  }
]

describe('findHistoricalRules', () => {
  it('matches both stock code and trade date and sorts by intraday time', () => {
    expect(findHistoricalRules(rules, '600001', '2026-07-22').map((rule) => rule.id)).toEqual([2, 3])
  })

  it('returns no stale rules when code or date is missing', () => {
    expect(findHistoricalRules(rules, '', '2026-07-22')).toEqual([])
    expect(findHistoricalRules(rules, '600001', '')).toEqual([])
  })
})
