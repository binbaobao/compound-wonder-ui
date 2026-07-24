import { describe, expect, it } from 'vitest'
import type { HistoricalBacktestRule, RuleRecord } from '../types/market'
import { buildMinuteTradeEvents } from './tradeEvents'

const historicalRules: HistoricalBacktestRule[] = [
  {
    id: 1,
    actionType: 1,
    ruleCode: 101,
    symbol: '600001',
    tradeDate: '2026-07-22',
    time: 92_500_000,
    price: 1_000,
    remark: '竞价买入'
  },
  {
    id: 2,
    actionType: 3,
    ruleCode: 102,
    symbol: '600001',
    tradeDate: '2026-07-22',
    time: 93_000_000,
    price: 1_001
  },
  {
    id: 3,
    actionType: 2,
    ruleCode: 201,
    symbol: '600001',
    tradeDate: '2026-07-22',
    time: 100_100_000,
    price: 1_050
  }
]

describe('buildMinuteTradeEvents', () => {
  it('uses historical buy and sell rules when no standalone replay result exists', () => {
    expect(
      buildMinuteTradeEvents({
        replayRecords: [],
        historicalRules,
        fallbackPrice: 9.8,
        timestamp: 1_753_132_800_000
      })
    ).toEqual([
      {
        time: '09:25:00.000',
        side: 'B',
        price: 10,
        reason: '竞价买入',
        timestamp: 1_753_132_800_000,
        actionType: 1
      },
      {
        time: '10:01:00.000',
        side: 'S',
        price: 10.5,
        reason: '规则 201',
        timestamp: 1_753_132_800_000,
        actionType: 2
      }
    ])
  })

  it('prefers standalone replay points and excludes cancel records', () => {
    const replayRecords: RuleRecord[] = [
      {
        actionType: 1,
        ruleCode: 301,
        time: 93_100_000,
        price: 990,
        increase: 1.25
      },
      {
        actionType: 3,
        ruleCode: 302,
        time: 93_200_000,
        price: 992
      },
      {
        actionType: 2,
        ruleCode: 303,
        time: 145_700_000,
        remark: '尾盘卖出'
      }
    ]

    expect(
      buildMinuteTradeEvents({
        replayRecords,
        historicalRules,
        fallbackPrice: 10.2,
        timestamp: 1_753_132_800_000
      })
    ).toEqual([
      {
        time: '09:31:00.000',
        side: 'B',
        price: 9.9,
        reason: '规则 301',
        profitRate: 1.25,
        timestamp: 1_753_132_800_000,
        actionType: 1
      },
      {
        time: '14:57:00.000',
        side: 'S',
        price: 10.2,
        reason: '尾盘卖出',
        profitRate: undefined,
        timestamp: 1_753_132_800_000,
        actionType: 2
      }
    ])
  })
})
