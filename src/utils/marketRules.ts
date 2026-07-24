import type { ChartBar, StockPoolItem } from '../types/market'

interface PriceLimitInput {
  stockCode: string
  tradeDate: string
  isSt: boolean
  explicitRate?: number | null
  noPriceLimit?: boolean
}

/** Resolves the display limit. Backend facts take precedence over frontend fallbacks. */
export function resolvePriceLimitRate(input: PriceLimitInput): number | null {
  if (input.noPriceLimit) return null
  if (input.explicitRate === null) return null
  if (input.explicitRate != null && Number.isFinite(input.explicitRate)) return input.explicitRate

  const code = input.stockCode.trim()
  if (/^(4|8|92)/.test(code)) return 0.3
  if (/^(30|68)/.test(code)) return 0.2
  if (/^(00|60)/.test(code) && input.isSt && input.tradeDate < '2026-07-06') return 0.05
  return 0.1
}

/** Uses daily historical metadata before current stock metadata or a name fallback. */
export function isHistoricalSt(
  stock: Pick<StockPoolItem, 'name' | 'st' | 'historySt'>,
  bar?: Pick<ChartBar, 'st' | 'historySt'>
): boolean {
  if (bar?.historySt != null) return bar.historySt === 1
  if (bar?.st != null) return bar.st === 1
  if (stock.historySt === 1 || stock.st === 1) return true
  return /^\*?ST(?:\s|[^A-Za-z]|$)/i.test(stock.name.trim())
}
