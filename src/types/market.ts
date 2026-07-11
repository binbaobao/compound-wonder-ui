export type StockScope = 'recommend' | 'limit' | 'break'
export type TradeSide = 'B' | 'S' | 'C'

export interface EmotionCalendarDay {
  date: string
  limitUpCount: number
  explodeCount: number
  highestLimitUp: number
}

export interface StockPoolItem {
  code: string
  symbolId: number
  name: string
  historyName?: string
  boardLabel: string
  theme: string
  strength: number
  amount: string
  price: number
  resultRate: number
  scope: StockScope
  turnover?: number
  turnoverRate?: number
  changeRate?: number
  amplitude?: number
  volume?: number
  klineState?: number
  consecutiveLimitUpDays?: number
  lbc?: number
  zz?: number
  rz?: number
  st?: number
  historySt?: number
  province?: string
  safetyScore?: number
  blacklist?: number
}

export interface ChartBar {
  date?: string
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  prevClose?: number
  volume: number
  turnover?: number
  turnoverRate?: number
  amplitude?: number
  changeRate?: number
  floatMarketCap?: number
  totalMarketCap?: number
  floatShares?: number
  totalShares?: number
  klineState?: number
  consecutiveLimitUpDays?: number
}

export interface MinuteTick {
  timestamp: number
  tickTime: string
  dataType?: number
  rawTime?: unknown
  rawPrice?: number
  sellPrice?: number
  price: number
  amount: number
  quantity: number
  buyerOrderId: number
  sellerOrderId: number
  symbolId?: unknown
  handlerIndex?: unknown
  rawFields?: Record<string, unknown>
}

export interface TradeEvent {
  time: string
  side: TradeSide
  price: number
  reason: string
  positionPct?: number
  timestamp?: number
  profitRate?: number
  actionType?: number
}

export interface BacktestSummary {
  buyCount: number
  sellCount: number
  maxProfitRate: number
  closeProfitRate: number
}

export interface RuleRecord {
  actionType?: number
  ruleCode?: number
  symbol?: string
  time?: number
  lastOrderTime?: number
  price?: number
  increase?: number
  remark?: string
}

export interface StockBacktestPayload {
  minuteBars: ChartBar[]
  dailyBars: ChartBar[]
  events: TradeEvent[]
  summary: BacktestSummary
}

export interface EmotionCycleSummary {
  date: string
  limitUpCount: number
  yesterdayLimitUpCount: number
  consecutiveLimitUpCount: number
  explodeCount: number
  limitDownCount: number
  highestLimitUp: number
  consecutiveRate: number
  explodeRate: number
  leaderCode?: string
  leaderName?: string
}
