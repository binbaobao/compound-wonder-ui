import type { HistoricalBacktestRule, RuleRecord, TradeEvent } from '../types/market'

interface MinuteTradeEventInput {
  replayRecords: RuleRecord[]
  historicalRules: HistoricalBacktestRule[]
  fallbackPrice: number
  timestamp: number
}

/** Builds the buy/sell events shown on the minute chart without mixing two backtest result sources. */
export function buildMinuteTradeEvents({
  replayRecords,
  historicalRules,
  fallbackPrice,
  timestamp
}: MinuteTradeEventInput): TradeEvent[] {
  if (replayRecords.length) {
    return replayRecords.flatMap((record, index) => {
      const side = tradeSide(record.actionType)
      if (!side) return []
      return [
        {
          time: formatCompactTime(record.time),
          side,
          price: positivePrice(record.price, fallbackPrice),
          reason: record.remark?.trim() || `规则 ${record.ruleCode ?? index + 1}`,
          profitRate: record.increase,
          timestamp,
          actionType: record.actionType
        }
      ]
    })
  }

  return historicalRules.flatMap((rule) => {
    const side = tradeSide(rule.actionType)
    if (!side) return []
    return [
      {
        time: formatCompactTime(rule.time),
        side,
        price: positivePrice(rule.price, fallbackPrice),
        reason: rule.remark?.trim() || `规则 ${rule.ruleCode}`,
        timestamp,
        actionType: rule.actionType
      }
    ]
  })
}

function tradeSide(actionType?: number) {
  if (actionType === 1) return 'B' as const
  if (actionType === 2) return 'S' as const
  return null
}

function positivePrice(priceInCents: number | undefined, fallbackPrice: number) {
  return priceInCents != null && priceInCents > 0 ? priceInCents / 100 : fallbackPrice
}

function formatCompactTime(value?: number) {
  const text = String(value ?? 0).padStart(9, '0')
  return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}.${text.slice(6, 9)}`
}
