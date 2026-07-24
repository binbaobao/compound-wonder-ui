import type {
  ChartBar,
  EmotionCalendarDay,
  EmotionCycleSummary,
  HistoricalBacktestDailyRecord,
  HistoricalBacktestPosition,
  HistoricalBacktestRule,
  HistoricalBacktestRun,
  MinuteTick,
  RuleRecord,
  SingleModeBacktestRun,
  SingleModeBacktestSummary,
  SingleModeBoardStat,
  SingleModeSamplePage,
  SingleModeTradeMode,
  StockPoolItem,
  StockScope
} from '../types/market'

interface ApiResult<T> {
  code: number
  msg: string
  data: T
}

const API_BASE = (import.meta.env.VITE_API_BASE?.trim() || '/cw/backtest').replace(/\/+$/, '')

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json', ...init?.headers },
    ...init
  })
  if (!response.ok) {
    throw new Error(`接口请求失败（HTTP ${response.status}）`)
  }
  let body: ApiResult<T>
  try {
    body = (await response.json()) as ApiResult<T>
  } catch {
    throw new Error('接口响应不是有效 JSON')
  }
  if (body.code !== 0) {
    throw new Error(body.msg || '接口返回失败')
  }
  return body.data
}

export function fetchTradingDays(signal?: AbortSignal): Promise<EmotionCalendarDay[]> {
  return request<EmotionCalendarDay[]>(`${API_BASE}/trading-days`, { signal })
}

export function fetchStockPool(
  date: string,
  scope: StockScope,
  limit = 200,
  signal?: AbortSignal
): Promise<StockPoolItem[]> {
  const params = new URLSearchParams({ date, scope, limit: String(limit) })
  return request<StockPoolItem[]>(`${API_BASE}/stocks?${params}`, { signal })
}

export function runStockSelectionBacktest(date: string, signal?: AbortSignal): Promise<string> {
  const params = new URLSearchParams({ date })
  return request<string>(`${API_BASE}/stock-selection-backtest?${params}`, { signal })
}

export function fetchDailyBars(
  stockCode: string,
  date: string,
  beforeLimit = 300,
  afterLimit = 100,
  signal?: AbortSignal
): Promise<ChartBar[]> {
  const params = new URLSearchParams({
    stockCode,
    date,
    beforeLimit: String(beforeLimit),
    afterLimit: String(afterLimit)
  })
  return request<ChartBar[]>(`${API_BASE}/daily-bars?${params}`, { signal })
}

export function fetchMinuteBars(stockCode: string, date: string, signal?: AbortSignal): Promise<MinuteTick[]> {
  const params = new URLSearchParams({ stockCode, date })
  return request<MinuteTick[]>(`${API_BASE}/minute-bars?${params}`, { signal })
}

export function fetchEmotionSummary(date: string, signal?: AbortSignal): Promise<EmotionCycleSummary> {
  const params = new URLSearchParams({ date })
  return request<EmotionCycleSummary>(`${API_BASE}/emotion-summary?${params}`, { signal })
}

export function fetchOrderBookReplay(
  stockCode: string,
  date: string,
  direction: 1 | 2,
  signal?: AbortSignal
): Promise<RuleRecord[]> {
  const params = new URLSearchParams({ stockCode, date, direction: String(direction) })
  return request<RuleRecord[]>(`${API_BASE}/order-book/replay?${params}`, { signal })
}

export function startHistoricalBacktest(startDate: string, endDate: string): Promise<HistoricalBacktestRun> {
  const params = new URLSearchParams({ startDate, endDate })
  return request<HistoricalBacktestRun>(`${API_BASE}/trade-runs?${params}`, { method: 'POST' })
}

export function fetchHistoricalBacktestRun(runId: number, signal?: AbortSignal): Promise<HistoricalBacktestRun> {
  return request<HistoricalBacktestRun>(`${API_BASE}/trade-runs/${runId}`, { signal })
}

export function fetchHistoricalBacktestRuns(limit = 20, signal?: AbortSignal): Promise<HistoricalBacktestRun[]> {
  return request<HistoricalBacktestRun[]>(`${API_BASE}/trade-runs?limit=${limit}`, { signal })
}

export function fetchHistoricalBacktestDailyRecords(
  runId: number,
  signal?: AbortSignal
): Promise<HistoricalBacktestDailyRecord[]> {
  return request<HistoricalBacktestDailyRecord[]>(`${API_BASE}/trade-runs/${runId}/daily-records`, { signal })
}

export function fetchHistoricalBacktestPositions(
  runId: number,
  signal?: AbortSignal
): Promise<HistoricalBacktestPosition[]> {
  return request<HistoricalBacktestPosition[]>(`${API_BASE}/trade-runs/${runId}/positions`, { signal })
}

export function fetchHistoricalBacktestRules(runId: number, signal?: AbortSignal): Promise<HistoricalBacktestRule[]> {
  return request<HistoricalBacktestRule[]>(`${API_BASE}/trade-runs/${runId}/rules`, { signal })
}

export function startSingleModeBacktest(
  startDate: string,
  endDate: string,
  tradeMode: SingleModeTradeMode
): Promise<SingleModeBacktestRun> {
  const params = new URLSearchParams({ startDate, endDate, tradeMode: String(tradeMode) })
  return request<SingleModeBacktestRun>(`${API_BASE}/single-mode-runs?${params}`, { method: 'POST' })
}

export function fetchSingleModeBacktestRuns(
  tradeMode: SingleModeTradeMode,
  limit = 20,
  signal?: AbortSignal
): Promise<SingleModeBacktestRun[]> {
  const params = new URLSearchParams({ tradeMode: String(tradeMode), limit: String(limit) })
  return request<SingleModeBacktestRun[]>(`${API_BASE}/single-mode-runs?${params}`, { signal })
}

export function fetchSingleModeBacktestRun(runId: number, signal?: AbortSignal): Promise<SingleModeBacktestRun> {
  return request<SingleModeBacktestRun>(`${API_BASE}/single-mode-runs/${runId}`, { signal })
}

export function fetchSingleModeBacktestSummary(
  runId: number,
  signal?: AbortSignal
): Promise<SingleModeBacktestSummary> {
  return request<SingleModeBacktestSummary>(`${API_BASE}/single-mode-runs/${runId}/summary`, { signal })
}

export function fetchSingleModeBoardStats(runId: number, signal?: AbortSignal): Promise<SingleModeBoardStat[]> {
  return request<SingleModeBoardStat[]>(`${API_BASE}/single-mode-runs/${runId}/board-stats`, { signal })
}

export function fetchSingleModeSamples(
  runId: number,
  page = 1,
  pageSize = 50,
  positionType?: 1 | 2,
  signal?: AbortSignal
): Promise<SingleModeSamplePage> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (positionType != null) params.set('positionType', String(positionType))
  return request<SingleModeSamplePage>(`${API_BASE}/single-mode-runs/${runId}/samples?${params}`, { signal })
}

/** Replays sell execution against the source run's fixed historical buy facts. */
export function replaySingleModeBacktest(sourceRunId: number): Promise<SingleModeBacktestRun> {
  return request<SingleModeBacktestRun>(`${API_BASE}/single-mode-runs/${sourceRunId}/replays`, { method: 'POST' })
}

/** Replays both sides against the source run's fixed candidate set. */
export function replaySingleModeCandidates(sourceRunId: number): Promise<SingleModeBacktestRun> {
  return request<SingleModeBacktestRun>(`${API_BASE}/single-mode-runs/${sourceRunId}/candidate-replays`, {
    method: 'POST'
  })
}
