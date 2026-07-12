import type { ChartBar, EmotionCalendarDay, EmotionCycleSummary, MinuteTick, RuleRecord, StockPoolItem, StockScope } from '../types/market'

interface ApiResult<T> {
  code: number
  msg: string
  data: T
}

const API_BASE = '/cw/backtest'

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const body = await response.json() as ApiResult<T>
  if (body.code !== 0) {
    throw new Error(body.msg || '接口返回失败')
  }
  return body.data
}

export function fetchTradingDays(): Promise<EmotionCalendarDay[]> {
  return request<EmotionCalendarDay[]>(`${API_BASE}/trading-days`)
}

export function fetchStockPool(date: string, scope: StockScope, limit = 200): Promise<StockPoolItem[]> {
  const params = new URLSearchParams({ date, scope, limit: String(limit) })
  return request<StockPoolItem[]>(`${API_BASE}/stocks?${params}`)
}

export function fetchDailyBars(stockCode: string, date: string, beforeLimit = 300, afterLimit = 100): Promise<ChartBar[]> {
  const params = new URLSearchParams({
    stockCode,
    date,
    beforeLimit: String(beforeLimit),
    afterLimit: String(afterLimit)
  })
  return request<ChartBar[]>(`${API_BASE}/daily-bars?${params}`)
}

export function fetchMinuteBars(stockCode: string, date: string): Promise<MinuteTick[]> {
  const params = new URLSearchParams({ stockCode, date })
  return request<MinuteTick[]>(`${API_BASE}/minute-bars?${params}`)
}

export function fetchEmotionSummary(date: string): Promise<EmotionCycleSummary> {
  const params = new URLSearchParams({ date })
  return request<EmotionCycleSummary>(`${API_BASE}/emotion-summary?${params}`)
}

export function fetchHistoricalBacktest(stockCode: string, date: string, direction: 1 | 2): Promise<RuleRecord[]> {
  const params = new URLSearchParams({ stockCode, date, direction: String(direction) })
  return request<RuleRecord[]>(`${API_BASE}/historical/backtest?${params}`)
}
