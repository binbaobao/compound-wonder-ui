<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CalendarDays } from 'lucide-vue-next'
import AShareMinuteChart from './components/AShareMinuteChart.vue'
import BacktestPanel from './components/BacktestPanel.vue'
import KLineChartBox from './components/KLineChartBox.vue'
import StockPool from './components/StockPool.vue'
import { fetchDailyBars, fetchEmotionSummary, fetchMinuteBars, fetchStockPool, fetchTradingDays } from './api/market'
import type { ChartBar } from './types/market'
import type { BacktestSummary, EmotionCalendarDay, EmotionCycleSummary, MinuteTick, RuleRecord, StockPoolItem, StockScope, TradeEvent } from './types/market'

const tradeDate = ref('')
const detailDate = ref('')
const scope = ref<StockScope>('limit')
const keyword = ref('')
const stocks = ref<StockPoolItem[]>([])
const tradingDays = ref<EmotionCalendarDay[]>([])
const selectedStock = ref<StockPoolItem | null>(null)
const dailyBars = ref<ChartBar[]>([])
const minuteBars = ref<ChartBar[]>([])
const minuteTicks = ref<MinuteTick[]>([])
const events = ref<TradeEvent[]>([])
const backtestRecords = ref<RuleRecord[]>([])
const emotionSummary = ref<EmotionCycleSummary | null>(null)
const loading = ref(false)
const apiMessage = ref('等待后端数据')
const errorMessage = ref('')
const detailDateOpen = ref(false)
const detailDatePicker = ref<HTMLElement | null>(null)
const detailDateMenu = ref<HTMLElement | null>(null)

const summary = computed<BacktestSummary>(() => ({
  buyCount: events.value.filter(event => event.side === 'B').length,
  sellCount: events.value.filter(event => event.side === 'S').length,
  maxProfitRate: selectedStock.value?.resultRate ?? 0,
  closeProfitRate: selectedStock.value?.resultRate ?? 0
}))

const selectedResultRate = computed(() => selectedStock.value?.resultRate ?? 0)
const selectedPrice = computed(() => selectedStock.value?.price ?? 0)

const selectedCode = computed(() => selectedStock.value?.code ?? '')
const detailDateOptions = computed(() => {
  const centerIndex = dailyBars.value.findIndex(bar => dailyBarDate(bar) === tradeDate.value)
  if (centerIndex < 0) {
    return dailyBars.value.slice(-21).reverse()
  }
  const start = Math.max(0, centerIndex - 10)
  const end = Math.min(dailyBars.value.length, centerIndex + 11)
  return dailyBars.value.slice(start, end).reverse()
})
const selectedDailyBarIndex = computed(() => dailyBars.value.findIndex(bar => (bar.date ?? formatDateKey(bar.timestamp)) === detailDate.value))
const selectedDailyBar = computed(() => {
  const index = selectedDailyBarIndex.value
  return index >= 0 ? dailyBars.value[index] : null
})
const previousClose = computed(() => selectedDailyBar.value?.prevClose ?? selectedDailyBar.value?.open ?? selectedPrice.value)
const quoteOpen = computed(() => selectedDailyBar.value?.open ?? selectedPrice.value)
const quoteClose = computed(() => selectedDailyBar.value?.close ?? selectedPrice.value)
const quoteHigh = computed(() => selectedDailyBar.value?.high ?? selectedPrice.value)
const quoteLow = computed(() => selectedDailyBar.value?.low ?? selectedPrice.value)
const selectedBoardLabel = computed(() => {
  const days = selectedDailyBar.value?.consecutiveLimitUpDays ?? 0
  return days > 0 ? `${days}板` : selectedStock.value?.boardLabel ?? ''
})
const backtestTradeEvents = computed<TradeEvent[]>(() => {
  const source = selectedDailyBar.value
  if (!source) return []
  return backtestRecords.value
    .filter(record => record.actionType === 1 || record.actionType === 2 || record.actionType === 3)
    .map((record, index) => ({
      time: formatRecordTime(record.time),
      side: record.actionType === 1 ? 'B' : record.actionType === 2 ? 'S' : 'C',
      price: record.price ? record.price / 100 : source.close,
      reason: record.remark ?? `规则 ${record.ruleCode ?? index + 1}`,
      profitRate: record.increase,
      timestamp: source.timestamp,
      actionType: record.actionType
    }))
})
const floatMarketRatio = computed(() => {
  const floatShares = selectedDailyBar.value?.floatShares ?? 0
  const totalShares = selectedDailyBar.value?.totalShares ?? 0
  return totalShares > 0 ? floatShares / totalShares * 100 : 0
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

const canLoad = computed(() => Boolean(tradeDate.value))

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

function rateClass(value: number) {
  return value >= 0 ? 'rate-up' : 'rate-down'
}

function quoteRate(value: number) {
  if (!previousClose.value) return 0
  return (value - previousClose.value) / previousClose.value * 100
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

function formatRecordTime(value?: number) {
  if (value == null) return ''
  const text = String(value).padStart(9, '0')
  return `${Number(text.slice(0, 2))}:${text.slice(2, 4)}:${text.slice(4, 6)}:${text.slice(6, 9)}`
}

function handleBacktestRecords(records: RuleRecord[]) {
  backtestRecords.value = records
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
  try {
    const days = await fetchTradingDays()
    tradingDays.value = days
    if (days.length) {
      tradeDate.value = days[days.length - 1].date
      detailDate.value = days[days.length - 1].date
    } else {
      errorMessage.value = '情绪周期日历为空'
    }
  } catch (error) {
    errorMessage.value = `情绪周期日历接口加载失败`
  }
}

async function loadStockPool() {
  if (!tradeDate.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const rows = await fetchStockPool(tradeDate.value, scope.value, 300)
    stocks.value = rows.map(normalizeStock)
    selectedStock.value = stocks.value[0] ?? null
    apiMessage.value = rows.length ? `数据库数据：${tradeDate.value}` : `数据库无${scopeName.value}股票`
  } catch (error) {
    stocks.value = []
    selectedStock.value = null
    errorMessage.value = `后端接口加载失败`
  } finally {
    loading.value = false
  }
}

async function loadEmotionSummary() {
  if (!tradeDate.value) {
    emotionSummary.value = null
    return
  }
  try {
    emotionSummary.value = await fetchEmotionSummary(tradeDate.value)
  } catch (error) {
    emotionSummary.value = null
  }
}

async function loadDailyBars() {
  if (!detailDate.value || !selectedStock.value) {
    dailyBars.value = []
    return
  }
  try {
    dailyBars.value = await fetchDailyBars(selectedStock.value.code, detailDate.value, 300, 100)
  } catch (error) {
    dailyBars.value = []
  }
}

async function loadMinuteBars() {
  if (!detailDate.value || !selectedStock.value) {
    minuteBars.value = []
    minuteTicks.value = []
    return
  }
  try {
    const ticks = await fetchMinuteBars(selectedStock.value.code, detailDate.value)
    minuteTicks.value = ticks
    minuteBars.value = ticks.map(tick => ({
      timestamp: tick.timestamp,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: tick.sellerOrderId
    }))
  } catch (error) {
    minuteBars.value = []
    minuteTicks.value = []
  }
}

async function reloadAll() {
  if (!canLoad.value) return
  await loadEmotionSummary()
  await loadStockPool()
  await loadMinuteBars()
  await loadDailyBars()
}

watch([tradeDate, scope], async ([date]) => {
  if (date && detailDate.value !== date) {
    detailDate.value = date
  }
  await reloadAll()
})
watch(scope, () => {
  selectedStock.value = null
  dailyBars.value = []
  minuteBars.value = []
  minuteTicks.value = []
  events.value = []
  backtestRecords.value = []
})
watch(() => selectedStock.value?.code, async () => {
  backtestRecords.value = []
  await loadMinuteBars()
  await loadDailyBars()
})
watch(detailDate, async () => {
  backtestRecords.value = []
  if (detailDateOpen.value) {
    await nextTick()
    centerSelectedDetailDate()
  }
  await loadDailyBars()
  await loadMinuteBars()
})

onMounted(async () => {
  document.addEventListener('click', handleDocumentClick)
  await loadTradingDays()
  await reloadAll()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
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
        @select="selectStock"
      />

      <section v-if="selectedStock" class="center-panel">
        <AShareMinuteChart
          title="Level2 分时"
          legend="集合竞价 / 连续竞价 / 收盘竞价"
          :ticks="minuteTicks"
          :events="backtestTradeEvents"
          :previous-close="previousClose"
          :stock-code="selectedStock.code"
          :trade-date="detailDate"
          :is-st="selectedStock.st === 1 || selectedStock.historySt === 1"
          :float-shares="selectedDailyBar?.floatShares ?? 0"
          :height="430"
          empty-text="暂无分时数据"
        >
          <template #head>
            <div class="quote-main minute-quote-main">
              <div ref="detailDatePicker" class="date-picker quote-date-picker">
                <button class="date-control light date-trigger quote-date-trigger" type="button" @click="toggleDetailDateMenu">
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
                    开 <b>{{ quoteOpen.toFixed(2) }}</b>
                    <small :class="rateClass(quoteRate(quoteOpen))">({{ quoteRate(quoteOpen).toFixed(2) }}%)</small>
                  </span>
                  <span>
                    收 <b>{{ quoteClose.toFixed(2) }}</b>
                    <small :class="rateClass(quoteRate(quoteClose))">({{ quoteRate(quoteClose).toFixed(2) }}%)</small>
                  </span>
                </div>
                <div class="quote-ohlc-col">
                  <span>
                    高 <b>{{ quoteHigh.toFixed(2) }}</b>
                    <small :class="rateClass(quoteRate(quoteHigh))">({{ quoteRate(quoteHigh).toFixed(2) }}%)</small>
                  </span>
                  <span>
                    低 <b>{{ quoteLow.toFixed(2) }}</b>
                    <small :class="rateClass(quoteRate(quoteLow))">({{ quoteRate(quoteLow).toFixed(2) }}%)</small>
                  </span>
                </div>
              </div>
              <div class="quote-extra-metrics">
                <div>
                  <span>换手 <b>{{ formatPercent(selectedDailyBar?.turnoverRate) }}</b></span>
                  <span>成交量 <b>{{ formatVolume(selectedDailyBar?.volume) }}</b></span>
                </div>
                <div>
                  <span>振幅 <b>{{ formatPercent(selectedDailyBar?.amplitude) }}</b></span>
                  <span>成交额 <b>{{ formatTurnover(selectedDailyBar?.turnover) }}</b></span>
                </div>
              </div>
              <div class="quote-metrics">
                <span v-if="selectedStock.st === 1">ST</span>
              </div>
              <div class="quote-extra-metrics quote-market-metrics">
                <div>
                  <span>总市值 <b>{{ formatMarketCap(selectedDailyBar?.totalMarketCap) }}</b></span>
                  <span>流通市值 <b>{{ formatMarketCap(selectedDailyBar?.floatMarketCap) }}</b></span>
                </div>
                <div>
                  <span>流通比例 <b>{{ formatPercent(floatMarketRatio) }}</b></span>
                  <span>最大换手 <b>{{ formatPercent(maxTurnoverBar?.turnoverRate) }}</b><small>{{ maxTurnoverDate }}</small></span>
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
          empty-text="数据库暂无日 K 数据"
          show-volume
        />
      </section>

      <section v-else class="center-panel empty-workspace">
        <div class="empty-state">
          <strong>{{ loading ? '正在加载数据库数据' : '暂无可展示股票' }}</strong>
          <span>{{ visibleStatus }}</span>
        </div>
      </section>

      <BacktestPanel
        v-if="selectedStock"
        :stock="selectedStock"
        :trade-date="detailDate"
        :summary="summary"
        :events="events"
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
