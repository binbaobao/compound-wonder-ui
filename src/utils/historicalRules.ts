import type { HistoricalBacktestRule } from '../types/market'

/** Finds the current historical run's execution rules for one exact stock/date chart context. */
export function findHistoricalRules(
  rules: HistoricalBacktestRule[],
  stockCode: string,
  tradeDate: string
): HistoricalBacktestRule[] {
  const normalizedCode = stockCode.trim()
  if (!normalizedCode || !tradeDate) return []

  return rules
    .filter((rule) => rule.symbol === normalizedCode && rule.tradeDate === tradeDate)
    .sort((left, right) => {
      const timeDifference = (left.time ?? Number.MAX_SAFE_INTEGER) - (right.time ?? Number.MAX_SAFE_INTEGER)
      return timeDifference || left.id - right.id
    })
}
