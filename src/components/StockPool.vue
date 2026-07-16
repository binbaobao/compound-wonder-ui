<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CalendarDays, RefreshCw, Search } from 'lucide-vue-next'
import type { EmotionCalendarDay, EmotionCycleSummary, StockPoolItem, StockScope } from '../types/market'

const props = defineProps<{
  stocks: StockPoolItem[]
  scope: StockScope
  selectedCode: string
  keyword: string
  tradeDate: string
  tradingDays: EmotionCalendarDay[]
  emotionSummary?: EmotionCycleSummary | null
  reselecting?: boolean
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  'update:tradeDate': [value: string]
  'update:scope': [value: StockScope]
  reselect: []
  select: [stock: StockPoolItem]
}>()

const title = computed(() => {
  if (props.scope === 'recommend') return '推荐盯盘池'
  return props.scope === 'limit' ? '当天涨停池' : '当天炸/断板池'
})
const scopeTabs: Array<{ value: StockScope, label: string }> = [
  { value: 'recommend', label: '推荐' },
  { value: 'limit', label: '涨停' },
  { value: 'break', label: '炸/断板' }
]
const dateOpen = ref(false)
const datePicker = ref<HTMLElement | null>(null)
const dateMenu = ref<HTMLElement | null>(null)
const reversedTradingDays = computed(() => [...props.tradingDays].reverse())

/** 格式化全市场成交金额，后端单位为亿元。 */
function formatMarketTurnover(amount: number | null | undefined) {
  const value = Number(amount ?? 0)
  if (value > 10000) return `${(value / 10000).toFixed(2)}万亿`
  return `${Math.round(value)}亿`
}

const filteredStocks = computed(() => {
  const keyword = props.keyword.trim().toLowerCase()
  const rows = props.stocks.filter(stock => stock.scope === props.scope)
    .filter(stock => {
      if (!keyword) return true
      return `${stock.code} ${stock.name} ${stock.boardLabel} ${stock.theme}`.toLowerCase().includes(keyword)
  })

  return [...rows].sort((a, b) => {
    if (props.scope === 'recommend') {
      return limitUpSortValue(b, props.scope) - limitUpSortValue(a, props.scope)
        || compareDesc(a.strength, b.strength)
        || compareDesc(a.resultRate, b.resultRate)
    }
    if (props.scope === 'limit') {
      return limitUpSortValue(b, props.scope) - limitUpSortValue(a, props.scope)
        || compareDesc(a.resultRate, b.resultRate)
    }
    return limitUpSortValue(b, props.scope) - limitUpSortValue(a, props.scope)
      || compareDesc(a.resultRate, b.resultRate)
  })
})

function limitUpSortValue(stock: StockPoolItem, scope: StockScope) {
  const days = scope === 'recommend'
    ? stock.lbc ?? stock.consecutiveLimitUpDays
    : stock.consecutiveLimitUpDays
  return Math.abs(Number(days ?? 0))
}

/** 按数值倒序比较，兼容接口返回字符串或空值。 */
function compareDesc(left: number | string | null | undefined, right: number | string | null | undefined) {
  return Number(right ?? 0) - Number(left ?? 0)
}

/** 根据日 K 状态返回涨停板型标签。 */
function limitUpTypeLabel(stock: StockPoolItem) {
  const labels: Record<number, string> = {
    1: '实体板',
    2: 'T字板',
    3: '一字板',
    4: '地天板',
    5: '天地天板'
  }
  return stock.klineState != null ? labels[stock.klineState] ?? '' : ''
}

function weekdayLabel(dateText: string) {
  const labels = ['日', '一', '二', '三', '四', '五', '六']
  const day = new Date(`${dateText}T00:00:00`).getDay()
  return labels[day] ?? ''
}

function selectTradeDate(day: EmotionCalendarDay) {
  emit('update:tradeDate', day.date)
  dateOpen.value = false
}

async function toggleDateMenu() {
  dateOpen.value = !dateOpen.value
  if (dateOpen.value) {
    await nextTick()
    centerSelectedDate()
  }
}

function centerSelectedDate() {
  const menu = dateMenu.value
  const activeOption = menu?.querySelector<HTMLElement>('.date-option.active')
  if (!menu || !activeOption) return
  menu.scrollTop = activeOption.offsetTop - (menu.clientHeight - activeOption.clientHeight) / 2
}

function handleDocumentClick(event: MouseEvent) {
  if (!datePicker.value) return
  if (!datePicker.value.contains(event.target as Node)) {
    dateOpen.value = false
  }
}

watch(() => props.tradeDate, async () => {
  if (!dateOpen.value) return
  await nextTick()
  centerSelectedDate()
})

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<template>
  <aside class="panel stock-panel">
    <div class="stock-date-row">
      <div ref="datePicker" class="date-picker">
        <button class="date-control light date-trigger" type="button" @click="toggleDateMenu">
          <CalendarDays :size="16" />
          <span>{{ tradeDate || '选择交易日' }}</span>
        </button>
        <div v-if="dateOpen" ref="dateMenu" class="date-menu">
          <button
            v-for="day in reversedTradingDays"
            :key="day.date"
            class="date-option"
            :class="{ active: day.date === tradeDate }"
            type="button"
            @click="selectTradeDate(day)"
          >
            <span>{{ day.date }} [{{ weekdayLabel(day.date) }}]</span>
            <small>
              <span>高:{{ day.highestLimitUp ?? 0 }}</span>
              <b class="date-limit-up">涨 {{ day.limitUpCount ?? 0 }}</b>
              <b class="date-explode">炸 {{ day.explodeCount ?? 0 }}</b>
            </small>
          </button>
          <label v-if="!tradingDays.length" class="date-control light date-fallback">
            <CalendarDays :size="16" />
            <input
              :value="tradeDate"
              type="date"
              @input="emit('update:tradeDate', ($event.target as HTMLInputElement).value)"
            >
          </label>
        </div>
      </div>
    </div>

    <div v-if="emotionSummary" class="stock-emotion">
      <div class="stock-emotion-highlight">
        <span>最高 <b>{{ emotionSummary.highestLimitUp }}板</b></span>
        <span v-if="emotionSummary.leaderCode">龙头：<b>{{ emotionSummary.leaderName || emotionSummary.leaderCode }}</b></span>
      </div>
      <div class="stock-emotion-row">
        <span>涨停 <b class="emotion-rise">{{ emotionSummary.limitUpCount }}</b></span>
        <span>连板 <b class="emotion-rise">{{ emotionSummary.consecutiveLimitUpCount }}</b></span>
      </div>
      <div class="stock-emotion-row">
        <span>炸板 <b class="emotion-fall">{{ emotionSummary.explodeCount }}</b></span>
        <span>跌停 <b class="emotion-fall">{{ emotionSummary.limitDownCount ?? 0 }}</b></span>
      </div>
      <div class="stock-emotion-row compact">
        <span>连板率 <b>{{ emotionSummary.consecutiveRate.toFixed(2) }}%</b></span>
        <span>炸板率 <b>{{ emotionSummary.explodeRate.toFixed(2) }}%</b></span>
      </div>
      <div class="stock-emotion-highlight stock-emotion-market">
        <span>涨 / 跌 <b><em class="emotion-rise">{{ emotionSummary.risingCount }}</em> / <em class="emotion-fall">{{ emotionSummary.fallingCount }}</em></b></span>
        <span>成交额 <b>{{ formatMarketTurnover(emotionSummary.allMarketTurnoverAmount) }}</b></span>
      </div>
    </div>

    <div class="stock-scope-row">
      <div class="segmented stock-segmented" aria-label="股票范围">
        <button
          v-for="tab in scopeTabs"
          :key="tab.value"
          :class="{ active: scope === tab.value }"
          type="button"
          @click="emit('update:scope', tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <div class="panel-head">
      <div class="stock-title-group">
        <button v-if="scope === 'recommend'" class="reselect-button" type="button" :disabled="reselecting" @click="emit('reselect')">
          <RefreshCw :size="13" :class="{ spinning: reselecting }" />
          <span>{{ reselecting ? '选股中' : '重新选股' }}</span>
        </button>
        <span>{{ title }}</span>
      </div>
      <small>{{ filteredStocks.length }} 只</small>
    </div>

    <div class="stock-tools">
      <label class="input-shell">
        <Search :size="16" />
        <input
          :value="keyword"
          type="search"
          placeholder="代码、名称、连板、题材"
          @input="emit('update:keyword', ($event.target as HTMLInputElement).value)"
        >
      </label>

    </div>

    <div class="stock-list">
      <button
        v-for="stock in filteredStocks"
        :key="stock.code"
        class="stock-row"
        :class="{ active: stock.code === selectedCode }"
        type="button"
        @click="emit('select', stock)"
      >
        <span class="stock-main">
          <strong>{{ stock.name }}</strong>
          <small>{{ stock.code }}</small>
        </span>
        <span class="stock-side">
          <span class="stock-board-label">
            <b :class="stock.scope">
              {{ scope === 'recommend' ? `推荐 ${stock.boardLabel}` : ((stock.consecutiveLimitUpDays ?? 0) < 0 ? `${stock.boardLabel}断` : stock.boardLabel) }}
            </b>
          </span>
          <span class="stock-meta">
            <i v-if="limitUpTypeLabel(stock)" class="status-limit-type">{{ limitUpTypeLabel(stock) }}</i>
            <span v-if="(scope === 'recommend' || scope === 'break') && (stock.klineState != null && stock.klineState >= 11 && stock.klineState <= 13 || (stock.consecutiveLimitUpDays ?? 0) < 0)" class="stock-status-tags">
              <i v-if="stock.klineState != null && stock.klineState >= 11 && stock.klineState <= 13" class="status-break">炸板</i>
              <i v-if="(stock.consecutiveLimitUpDays ?? 0) < 0" class="status-broken">断板</i>
            </span>
            <small>
              <template v-if="scope === 'recommend'"><i class="score-tag">涨停分 {{ stock.strength }}</i></template>
              <template v-if="stock.rz === 1"> · 融</template>
              <template v-if="stock.zz === 1"> · 债</template>
              <template v-if="stock.st === 1"> · ST</template>
            </small>
          </span>
        </span>
      </button>
    </div>
  </aside>
</template>
