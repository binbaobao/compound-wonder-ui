<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CalendarDays } from 'lucide-vue-next'
import AShareMinuteChart from './components/AShareMinuteChart.vue'
import BacktestPanel from './components/BacktestPanel.vue'
import KLineChartBox from './components/KLineChartBox.vue'
import HistoricalBacktestPanel from './components/HistoricalBacktestPanel.vue'
import SingleModeBacktestPanel from './components/SingleModeBacktestPanel.vue'
import StockPool from './components/StockPool.vue'
import {
  fetchDailyBars,
  fetchEmotionSummary,
  fetchMinuteBars,
  fetchStockPool,
  fetchTradingDays,
  runStockSelectionBacktest
} from './api/market'
import type {
  ChartBar,
  EmotionCalendarDay,
  EmotionCycleSummary,
  HistoricalBacktestPosition,
  HistoricalBacktestRule,
  MinuteTick,
  RuleRecord,
  SingleModeBacktestSample,
  StockPoolItem,
  StockScope,
  TradeEvent
} from './types/market'
import { findHistoricalRules } from './utils/historicalRules'
import { isHistoricalSt } from './utils/marketRules'
import { isAbortError, RequestGate } from './utils/requestGate'
import { buildMinuteTradeEvents } from './utils/tradeEvents'

const tradeDate = ref('')
const detailDate = ref('')
const scope = ref<StockScope>('limit')
const keyword = ref('')
const stocks = ref<StockPoolItem[]>([])
const tradingDays = ref<EmotionCalendarDay[]>([])
const selectedStock = ref<StockPoolItem | null>(null)
const pendingHistoricalStock = ref<StockPoolItem | null>(null)
const dailyBars = ref<ChartBar[]>([])
const minuteTicks = ref<MinuteTick[]>([])
const backtestRecords = ref<RuleRecord[]>([])
const historicalRules = ref<HistoricalBacktestRule[]>([])
const emotionSummary = ref<EmotionCycleSummary | null>(null)
const loading = ref(false)
const reselecting = ref(false)
const apiMessage = ref('等待后端数据')
const errorMessage = ref('')
const detailDateOpen = ref(false)
const detailDatePicker = ref<HTMLElement | null>(null)
const detailDateMenu = ref<HTMLElement | null>(null)
const backtestWorkspaceTab = ref<'mixed' | 'single'>('single')
const tradingDaysGate = new RequestGate()
const stockPoolGate = new RequestGate()
const emotionGate = new RequestGate()
const chartGate = new RequestGate()
const reselectGate = new RequestGate()

const selectedPrice = computed(() => selectedStock.value?.price ?? 0)

const selectedCode = computed(() => selectedStock.value?.code ?? '')
const selectedHistoricalRules = computed(() =>
  findHistoricalRules(historicalRules.value, selectedCode.value, detailDate.value)
)
const detailDateOptions = computed(() => {
  const centerIndex = dailyBars.value.findIndex((bar) => dailyBarDate(bar) === tradeDate.value)
  if (centerIndex < 0) {
    return dailyBars.value.slice(-21).reverse()
  }
  const start = Math.max(0, centerIndex - 10)
  const end = Math.min(dailyBars.value.length, centerIndex + 11)
  return dailyBars.value.slice(start, end).reverse()
})
const selectedDailyBarIndex = computed(() =>
  dailyBars.value.findIndex((bar) => (bar.date ?? formatDateKey(bar.timestamp)) === detailDate.value)
)
const selectedDailyBar = computed(() => {
  const index = selectedDailyBarIndex.value
  return index >= 0 ? dailyBars.value[index] : null
})
const selectedIsSt = computed(() =>
  selectedStock.value ? isHistoricalSt(selectedStock.value, selectedDailyBar.value ?? undefined) : false
)
const previousClose = computed(
  () => selectedDailyBar.value?.prevClose ?? selectedDailyBar.value?.open ?? selectedPrice.value
)
const quoteOpen = computed(() => selectedDailyBar.value?.open ?? selectedPrice.value)
const quoteClose = computed(() => selectedDailyBar.value?.close ?? selectedPrice.value)
const quoteHigh = computed(() => selectedDailyBar.value?.high ?? selectedPrice.value)
const quoteLow = computed(() => selectedDailyBar.value?.low ?? selectedPrice.value)
const selectedBoardLabel = computed(() => {
  const days = selectedDailyBar.value?.consecutiveLimitUpDays ?? 0
  return days > 0 ? `${days}板` : (selectedStock.value?.boardLabel ?? '')
})
const backtestTradeEvents = computed<TradeEvent[]>(() => {
  const source = selectedDailyBar.value
  if (!source) return []
  return buildMinuteTradeEvents({
    replayRecords: backtestRecords.value,
    historicalRules: selectedHistoricalRules.value,
    fallbackPrice: source.close,
    timestamp: source.timestamp
  })
})
const floatMarketRatio = computed(() => {
  const floatShares = selectedDailyBar.value?.floatShares ?? 0
  const totalShares = selectedDailyBar.value?.totalShares ?? 0
  return totalShares > 0 ? (floatShares / totalShares) * 100 : 0
})
const maxTurnoverBar = computed(() => {
  const currentDate = detailDate.value
  if (!currentDate) return null
  return dailyBars.value.reduce<ChartBar | null>((max, bar) => {
    if (dailyBarDate(bar) >= currentDate || bar.turnoverRate == null) return max
    if (!max || bar.turnoverRate > (max.turnoverRate ?? 0)) return bar
    return max
  }, null)
})
const maxTurnoverDate = computed(() => {
  const bar = maxTurnoverBar.value
  if (!bar) return ''
  return bar.date ?? formatDateKey(bar.timestamp)
})

const visibleStatus = computed(() => {
  if (loading.value) return '加载数据库数据中'
  if (errorMessage.value) return errorMessage.value
  return apiMessage.value
})

const scopeName = computed(() => {
  if (scope.value === 'recommend') return '推荐'
  return scope.value === 'limit' ? '涨停' : '炸/断板'
})

function normalizeStock(row: StockPoolItem): StockPoolItem {
  return {
    ...row,
    theme: row.theme ?? '',
    amount: row.amount ?? '0',
    boardLabel: row.boardLabel ?? '',
    strength: row.strength ?? 0,
    price: row.price ?? 0,
    resultRate: row.resultRate ?? row.changeRate ?? 0,
    turnover: row.turnover ?? 0,
    turnoverRate: row.turnoverRate ?? 0,
    amplitude: row.amplitude ?? 0,
    volume: row.volume ?? 0,
    scope: row.scope ?? scope.value
  }
}

function selectStock(stock: StockPoolItem) {
  if (tradeDate.value && detailDate.value !== tradeDate.value) {
    detailDate.value = tradeDate.value
  }
  backtestRecords.value = []
  selectedStock.value = stock
}

/** 从历史持仓跳转到该股票的买入日分时与日 K 图。 */
function selectHistoricalPosition(position: HistoricalBacktestPosition) {
  selectHistoricalStock(position.symbol, position.symbolName, position.buyDate, position.historySt ?? position.st)
}

/** 从全量规则记录跳转到该股票对应交易日的分时与日 K 图。 */
function selectHistoricalRule(rule: HistoricalBacktestRule) {
  selectHistoricalStock(rule.symbol, rule.symbolName, rule.tradeDate, rule.historySt ?? rule.st)
}

/** 从 Model 3 独立样本跳转到买入日；未买入样本跳转到计划交易日。 */
function selectSingleModeSample(sample: SingleModeBacktestSample) {
  selectHistoricalStock(
    sample.symbol,
    sample.symbolName,
    sample.buyDate || sample.tradeDate,
    sample.historySt ?? sample.st
  )
}

/** 使用回测记录中的股票代码和交易日期统一切换图表与日期控件。 */
function selectHistoricalStock(symbol: string, symbolName: string | undefined, date: string, historySt?: number) {
  const historicalStock = normalizeStock({
    code: symbol,
    symbolId: 0,
    name: symbolName || symbol,
    boardLabel: '',
    theme: '',
    strength: 0,
    amount: '0',
    price: 0,
    resultRate: 0,
    scope: scope.value,
    historySt
  })
  selectedStock.value = historicalStock
  detailDate.value = date
  if (tradeDate.value !== date) {
    pendingHistoricalStock.value = historicalStock
    tradeDate.value = date
  }
}

function rateClass(value: number) {
  return value >= 0 ? 'rate-up' : 'rate-down'
}

function quoteRate(value: number) {
  if (!previousClose.value) return 0
  return ((value - previousClose.value) / previousClose.value) * 100
}

function formatPercent(value?: number) {
  return `${(value ?? 0).toFixed(2)}%`
}

function formatVolume(value?: number) {
  const volume = value ?? 0
  return `${(volume / 1000000).toFixed(2)}万手`
}

function formatTurnover(value?: number) {
  const turnover = value ?? 0
  if (turnover >= 10000) return `${(turnover / 10000).toFixed(2)}亿`
  return `${turnover.toFixed(0)}万`
}

function formatMarketCap(value?: number) {
  const marketCap = value ?? 0
  if (marketCap >= 10000) return `${(marketCap / 10000).toFixed(2)}亿`
  return `${marketCap.toFixed(0)}万`
}

function formatDateKey(timestamp: number) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function handleBacktestRecords(records: RuleRecord[]) {
  backtestRecords.value = records
}

function handleHistoricalRules(rules: HistoricalBacktestRule[]) {
  historicalRules.value = rules
}

function dailyBarDate(bar: ChartBar) {
  return bar.date ?? formatDateKey(bar.timestamp)
}

function boardLimitLabel(bar: ChartBar) {
  const days = bar.consecutiveLimitUpDays ?? 0
  return days > 0 ? `${days}板` : '-'
}

function selectDetailDate(bar: ChartBar) {
  detailDate.value = dailyBarDate(bar)
  detailDateOpen.value = false
}

async function toggleDetailDateMenu() {
  detailDateOpen.value = !detailDateOpen.value
  if (detailDateOpen.value) {
    await nextTick()
    centerSelectedDetailDate()
  }
}

function centerSelectedDetailDate() {
  const menu = detailDateMenu.value
  const activeOption = menu?.querySelector<HTMLElement>('.date-option.active')
  if (!menu || !activeOption) return
  menu.scrollTop = activeOption.offsetTop - (menu.clientHeight - activeOption.clientHeight) / 2
}

function handleDocumentClick(event: MouseEvent) {
  if (!detailDatePicker.value) return
  if (!detailDatePicker.value.contains(event.target as Node)) {
    detailDateOpen.value = false
  }
}

async function loadTradingDays() {
  const request = tradingDaysGate.begin()
  try {
    const days = await fetchTradingDays(request.signal)
    if (!tradingDaysGate.isCurrent(request.id)) return
    tradingDays.value = days
    if (days.length) {
      tradeDate.value = days[days.length - 1].date
      detailDate.value = days[days.length - 1].date
    } else {
      errorMessage.value = '情绪周期日历为空'
    }
  } catch (error) {
    if (isAbortError(error) || !tradingDaysGate.isCurrent(request.id)) return
    errorMessage.value = error instanceof Error ? `情绪周期日历加载失败：${error.message}` : '情绪周期日历接口加载失败'
  }
}

async function loadStockPool() {
  if (!tradeDate.value) return
  const requestedDate = tradeDate.value
  const requestedScope = scope.value
  const request = stockPoolGate.begin()
  loading.value = true
  errorMessage.value = ''
  try {
    const rows = await fetchStockPool(requestedDate, requestedScope, 300, request.signal)
    if (!stockPoolGate.isCurrent(request.id)) return
    if (!applyStockPoolRows(rows, requestedDate, requestedScope)) return
    apiMessage.value = rows.length ? `数据库数据：${requestedDate}` : `数据库无${scopeName.value}股票`
  } catch (error) {
    if (
      isAbortError(error) ||
      !stockPoolGate.isCurrent(request.id) ||
      tradeDate.value !== requestedDate ||
      scope.value !== requestedScope
    )
      return
    stocks.value = []
    selectedStock.value = null
    pendingHistoricalStock.value = null
    errorMessage.value = error instanceof Error ? `股票池加载失败：${error.message}` : '股票池加载失败'
  } finally {
    if (stockPoolGate.isCurrent(request.id)) loading.value = false
  }
}

/** 仅在请求对应的日期和范围仍有效时，将股票池数据写入页面状态。 */
function applyStockPoolRows(rows: StockPoolItem[], requestedDate: string, requestedScope: StockScope) {
  if (tradeDate.value !== requestedDate || scope.value !== requestedScope) return false
  stocks.value = rows.map(normalizeStock)
  const historicalStock = pendingHistoricalStock.value
  selectedStock.value = historicalStock
    ? (stocks.value.find((stock) => stock.code === historicalStock.code) ?? historicalStock)
    : (stocks.value[0] ?? null)
  pendingHistoricalStock.value = null
  return true
}

/** 从交易日列表中查找当前盯盘日对应的前一个选股日。 */
function previousSelectionDate(tradingDate: string) {
  return tradingDays.value
    .filter((day) => day.date < tradingDate)
    .sort((left, right) => right.date.localeCompare(left.date))[0]?.date
}

/** 按前一交易日收盘数据重新选股，并刷新当前交易日的推荐盯盘池。 */
async function reselectStocks() {
  if (!tradeDate.value || reselecting.value) return
  const requestedTradeDate = tradeDate.value
  const selectionDate = previousSelectionDate(requestedTradeDate)
  if (!selectionDate) {
    errorMessage.value = `${requestedTradeDate} 没有可用的前一交易日，无法重新选股`
    return
  }
  reselecting.value = true
  errorMessage.value = ''
  const request = reselectGate.begin()
  try {
    await runStockSelectionBacktest(selectionDate, request.signal)
    const rows = await fetchStockPool(requestedTradeDate, 'recommend', 300, request.signal)
    if (!reselectGate.isCurrent(request.id)) return
    if (!applyStockPoolRows(rows, requestedTradeDate, 'recommend')) return
    apiMessage.value = `已按 ${selectionDate} 重新选股，${requestedTradeDate} 推荐池已刷新（${rows.length} 只）`
  } catch (error) {
    if (isAbortError(error) || !reselectGate.isCurrent(request.id)) return
    errorMessage.value = error instanceof Error ? `重新选股失败：${error.message}` : '重新选股接口调用失败'
  } finally {
    if (reselectGate.isCurrent(request.id)) reselecting.value = false
  }
}

async function loadEmotionSummary() {
  if (!tradeDate.value) {
    emotionGate.invalidate()
    emotionSummary.value = null
    return
  }
  const requestedDate = tradeDate.value
  const request = emotionGate.begin()
  try {
    const nextSummary = await fetchEmotionSummary(requestedDate, request.signal)
    if (emotionGate.isCurrent(request.id) && tradeDate.value === requestedDate) {
      emotionSummary.value = nextSummary
    }
  } catch (error) {
    if (!isAbortError(error) && emotionGate.isCurrent(request.id)) emotionSummary.value = null
  }
}

async function loadChartData() {
  if (!detailDate.value || !selectedStock.value) {
    chartGate.invalidate()
    dailyBars.value = []
    minuteTicks.value = []
    return
  }
  const stockCode = selectedStock.value.code
  const date = detailDate.value
  const request = chartGate.begin()
  try {
    const [barsResult, ticksResult] = await Promise.allSettled([
      fetchDailyBars(stockCode, date, 300, 100, request.signal),
      fetchMinuteBars(stockCode, date, request.signal)
    ])
    if (!chartGate.isCurrent(request.id) || selectedStock.value?.code !== stockCode || detailDate.value !== date) return
    dailyBars.value = barsResult.status === 'fulfilled' ? barsResult.value : []
    minuteTicks.value = ticksResult.status === 'fulfilled' ? ticksResult.value : []
    if (
      barsResult.status === 'rejected' &&
      ticksResult.status === 'rejected' &&
      !isAbortError(barsResult.reason) &&
      !isAbortError(ticksResult.reason)
    ) {
      errorMessage.value = `图表数据加载失败：${barsResult.reason instanceof Error ? barsResult.reason.message : '接口异常'}`
    }
  } catch (error) {
    if (isAbortError(error) || !chartGate.isCurrent(request.id)) return
    dailyBars.value = []
    minuteTicks.value = []
  }
}

watch([tradeDate, scope], async ([date], previous) => {
  if (!date) return
  const previousDate = previous?.[0]
  const previousScope = previous?.[1]
  if (!pendingHistoricalStock.value && (date !== previousDate || scope.value !== previousScope)) {
    selectedStock.value = null
    dailyBars.value = []
    minuteTicks.value = []
    backtestRecords.value = []
  }
  if (!pendingHistoricalStock.value && detailDate.value !== date) {
    detailDate.value = date
  }
  await Promise.all([loadEmotionSummary(), loadStockPool()])
})
watch([() => selectedStock.value?.code, detailDate], async () => {
  backtestRecords.value = []
  await loadChartData()
})
watch(detailDate, async () => {
  if (detailDateOpen.value) {
    await nextTick()
    centerSelectedDetailDate()
  }
})

onMounted(async () => {
  document.addEventListener('click', handleDocumentClick)
  await loadTradingDays()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  tradingDaysGate.invalidate()
  stockPoolGate.invalidate()
  emotionGate.invalidate()
  chartGate.invalidate()
  reselectGate.invalidate()
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">CW</span>
        <div>
          <strong>擒龙捉妖</strong>
          <small>Level 2 打板买入/炸板、断板卖出</small>
        </div>
      </div>
    </header>

    <main class="workspace">
      <StockPool
        v-model:keyword="keyword"
        v-model:trade-date="tradeDate"
        v-model:scope="scope"
        :stocks="stocks"
        :selected-code="selectedCode"
        :trading-days="tradingDays"
        :emotion-summary="emotionSummary"
        :reselecting="reselecting"
        @select="selectStock"
        @reselect="reselectStocks"
      />

      <section class="center-panel">
        <AShareMinuteChart
          title="Level2 分时"
          legend="集合竞价 / 连续竞价 / 收盘竞价"
          :ticks="minuteTicks"
          :events="backtestTradeEvents"
          :previous-close="previousClose"
          :stock-code="selectedStock?.code ?? ''"
          :trade-date="detailDate"
          :is-st="selectedIsSt"
          :price-limit-rate="selectedDailyBar?.priceLimitRate"
          :no-price-limit="selectedDailyBar?.noPriceLimit"
          :float-shares="selectedDailyBar?.floatShares ?? 0"
          :height="430"
          :empty-text="selectedStock ? '暂无分时数据' : '请选择左侧股票'"
        >
          <template v-if="selectedStock" #head>
            <div class="quote-main minute-quote-main">
              <div ref="detailDatePicker" class="date-picker quote-date-picker">
                <button
                  class="date-control light date-trigger quote-date-trigger"
                  type="button"
                  @click="toggleDetailDateMenu"
                >
                  <CalendarDays :size="15" />
                  <span>{{ detailDate || '选择交易日' }}</span>
                </button>
                <div v-if="detailDateOpen" ref="detailDateMenu" class="date-menu quote-date-menu">
                  <button
                    v-for="bar in detailDateOptions"
                    :key="bar.timestamp"
                    class="date-option"
                    :class="{ active: dailyBarDate(bar) === detailDate }"
                    type="button"
                    @click="selectDetailDate(bar)"
                  >
                    <span>{{ dailyBarDate(bar) }}</span>
                    <small>
                      <b class="date-limit-up">{{ boardLimitLabel(bar) }}</b>
                    </small>
                  </button>
                </div>
              </div>
              <div class="quote-badges" aria-label="融资与转债状态">
                <span :class="{ empty: selectedStock.rz !== 1 }">{{ selectedStock.rz === 1 ? '融' : '' }}</span>
                <span :class="{ empty: selectedStock.zz !== 1 }">{{ selectedStock.zz === 1 ? '债' : '' }}</span>
              </div>
              <span class="quote-board-tag">{{ selectedBoardLabel }}</span>
              <div class="quote-name">
                <strong>{{ selectedStock.name }}</strong>
                <span>{{ selectedStock.code }}</span>
              </div>
              <div class="quote-ohlc">
                <div class="quote-ohlc-col">
                  <span>
                    开
                    <b>{{ quoteOpen.toFixed(2) }}</b>
                    <small :class="rateClass(quoteRate(quoteOpen))">({{ quoteRate(quoteOpen).toFixed(2) }}%)</small>
                  </span>
                  <span>
                    收
                    <b>{{ quoteClose.toFixed(2) }}</b>
                    <small :class="rateClass(quoteRate(quoteClose))">({{ quoteRate(quoteClose).toFixed(2) }}%)</small>
                  </span>
                </div>
                <div class="quote-ohlc-col">
                  <span>
                    高
                    <b>{{ quoteHigh.toFixed(2) }}</b>
                    <small :class="rateClass(quoteRate(quoteHigh))">({{ quoteRate(quoteHigh).toFixed(2) }}%)</small>
                  </span>
                  <span>
                    低
                    <b>{{ quoteLow.toFixed(2) }}</b>
                    <small :class="rateClass(quoteRate(quoteLow))">({{ quoteRate(quoteLow).toFixed(2) }}%)</small>
                  </span>
                </div>
              </div>
              <div class="quote-extra-metrics">
                <div>
                  <span>
                    换手
                    <b>{{ formatPercent(selectedDailyBar?.turnoverRate) }}</b>
                  </span>
                  <span>
                    成交量
                    <b>{{ formatVolume(selectedDailyBar?.volume) }}</b>
                  </span>
                </div>
                <div>
                  <span>
                    振幅
                    <b>{{ formatPercent(selectedDailyBar?.amplitude) }}</b>
                  </span>
                  <span>
                    成交额
                    <b>{{ formatTurnover(selectedDailyBar?.turnover) }}</b>
                  </span>
                </div>
              </div>
              <div class="quote-metrics">
                <span v-if="selectedIsSt">ST</span>
              </div>
              <div class="quote-extra-metrics quote-market-metrics">
                <div>
                  <span>
                    总市值
                    <b>{{ formatMarketCap(selectedDailyBar?.totalMarketCap) }}</b>
                  </span>
                  <span>
                    流通市值
                    <b>{{ formatMarketCap(selectedDailyBar?.floatMarketCap) }}</b>
                  </span>
                </div>
                <div>
                  <span>
                    流通比例
                    <b>{{ formatPercent(floatMarketRatio) }}</b>
                  </span>
                  <span>
                    最大换手
                    <b>{{ formatPercent(maxTurnoverBar?.turnoverRate) }}</b>
                    <small>{{ maxTurnoverDate }}</small>
                  </span>
                </div>
              </div>
            </div>
          </template>
        </AShareMinuteChart>

        <KLineChartBox
          title="日 K 线"
          legend="数据库最新 300 个交易日 / 成交量"
          :bars="dailyBars"
          :height="510"
          :marker-timestamp="selectedDailyBar?.timestamp"
          :empty-text="selectedStock ? '数据库暂无日 K 数据' : '请选择左侧股票'"
          show-volume
        />

        <section class="backtest-workspace">
          <nav class="backtest-workspace-tabs" aria-label="回测类型">
            <button
              type="button"
              :class="{ active: backtestWorkspaceTab === 'single' }"
              @click="backtestWorkspaceTab = 'single'"
            >
              单模式全量
            </button>
            <button
              type="button"
              :class="{ active: backtestWorkspaceTab === 'mixed' }"
              @click="backtestWorkspaceTab = 'mixed'"
            >
              多模式混合收益
            </button>
          </nav>
          <div v-show="backtestWorkspaceTab === 'single'" class="backtest-workspace-panel">
            <SingleModeBacktestPanel
              :default-end-date="detailDate || tradeDate"
              @select-sample="selectSingleModeSample"
            />
          </div>
          <div v-show="backtestWorkspaceTab === 'mixed'" class="backtest-workspace-panel">
            <HistoricalBacktestPanel
              :default-end-date="detailDate || tradeDate"
              @select-position="selectHistoricalPosition"
              @select-rule="selectHistoricalRule"
              @rules-change="handleHistoricalRules"
            />
          </div>
        </section>
      </section>

      <BacktestPanel
        v-if="selectedStock"
        :stock="selectedStock"
        :trade-date="detailDate"
        :historical-rules="selectedHistoricalRules"
        @records-change="handleBacktestRecords"
      />
      <aside v-else class="panel right-panel">
        <div class="panel-head">
          <span>回测执行</span>
          <small>等待选择</small>
        </div>
        <div class="side-body">
          <section class="info-section">
            <h3>数据状态</h3>
            <p>{{ visibleStatus }}</p>
          </section>
        </div>
      </aside>
    </main>
  </div>
</template>
