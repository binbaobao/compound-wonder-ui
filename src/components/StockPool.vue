<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowDownAZ, CalendarDays, Search } from 'lucide-vue-next'
import type { EmotionCalendarDay, EmotionCycleSummary, StockPoolItem, StockScope } from '../types/market'

const props = defineProps<{
  stocks: StockPoolItem[]
  scope: StockScope
  selectedCode: string
  keyword: string
  sortMode: string
  tradeDate: string
  tradingDays: EmotionCalendarDay[]
  emotionSummary?: EmotionCycleSummary | null
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  'update:sortMode': [value: string]
  'update:tradeDate': [value: string]
  'update:scope': [value: StockScope]
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

const filteredStocks = computed(() => {
  const keyword = props.keyword.trim().toLowerCase()
  const rows = props.stocks.filter(stock => stock.scope === props.scope)
    .filter(stock => {
      if (!keyword) return true
      return `${stock.code} ${stock.name} ${stock.boardLabel} ${stock.theme}`.toLowerCase().includes(keyword)
  })

  return [...rows].sort((a, b) => {
    if (props.sortMode === 'limitUpDays') return limitUpSortValue(b) - limitUpSortValue(a)
    if (props.sortMode === 'amount') return parseFloat(b.amount) - parseFloat(a.amount)
    if (props.sortMode === 'result') return b.resultRate - a.resultRate
    return b.strength - a.strength
  })
})

function limitUpSortValue(stock: StockPoolItem) {
  return Math.abs(stock.consecutiveLimitUpDays ?? 0)
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
      <div class="stock-emotion-row">
        <span>涨停 <b>{{ emotionSummary.limitUpCount }}</b></span>
        <span>连板 <b>{{ emotionSummary.consecutiveLimitUpCount }}</b></span>
      </div>
      <div class="stock-emotion-row">
        <span>炸板 <b>{{ emotionSummary.explodeCount }}</b></span>
        <span>跌停 <b>{{ emotionSummary.limitDownCount ?? 0 }}</b></span>
      </div>
      <div class="stock-emotion-row compact">
        <span>连板率 <b>{{ emotionSummary.consecutiveRate.toFixed(2) }}%</b></span>
        <span>炸板率 <b>{{ emotionSummary.explodeRate.toFixed(2) }}%</b></span>
      </div>
      <div class="stock-emotion-row compact">
        <span>最高 <b>{{ emotionSummary.highestLimitUp }}板</b></span>
        <span v-if="emotionSummary.leaderCode">龙头 <b>{{ emotionSummary.leaderName || emotionSummary.leaderCode }}</b></span>
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
      <span>{{ title }}</span>
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

      <label class="select-shell">
        <ArrowDownAZ :size="16" />
        <select
          :value="sortMode"
          aria-label="排序"
          @change="emit('update:sortMode', ($event.target as HTMLSelectElement).value)"
        >
          <option value="limitUpDays">按连板次数排序</option>
          <option value="strength">按强度排序</option>
          <option value="amount">按成交额排序</option>
          <option value="result">按回测结果排序</option>
        </select>
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
          <b :class="stock.scope">{{ stock.boardLabel }}</b>
          <small>
            强度 {{ stock.strength }}
            <template v-if="stock.rz === 1"> · 融</template>
            <template v-if="stock.zz === 1"> · 债</template>
            <template v-if="stock.st === 1"> · ST</template>
          </small>
        </span>
      </button>
    </div>
  </aside>
</template>
