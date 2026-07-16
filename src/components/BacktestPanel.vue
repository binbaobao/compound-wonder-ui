<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchOrderBookReplay } from '../api/market'
import type { BacktestSummary, RuleRecord, StockPoolItem, TradeEvent } from '../types/market'

const props = defineProps<{
  stock: StockPoolItem
  tradeDate: string
  summary: BacktestSummary
  events: TradeEvent[]
}>()

const emit = defineEmits<{
  'records-change': [records: RuleRecord[]]
}>()

const running = ref(false)
const records = ref<RuleRecord[]>([])
const errorMessage = ref('')
const expandedRemarkKeys = ref<Set<string>>(new Set())
const lastDirection = ref<1 | 2 | null>(null)
const emptyMessage = computed(() => {
  if (lastDirection.value === 1) return '无买入操作'
  if (lastDirection.value === 2) return '无卖出操作'
  return '执行回测后展示回测结果列表。'
})

async function runBacktest(direction: 1 | 2) {
  if (!props.stock.code || !props.tradeDate || running.value) return
  running.value = true
  lastDirection.value = direction
  records.value = []
  emit('records-change', [])
  errorMessage.value = ''
  expandedRemarkKeys.value = new Set()
  try {
    records.value = await fetchOrderBookReplay(props.stock.code, props.tradeDate, direction)
    emit('records-change', records.value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '回测接口执行失败'
    emit('records-change', [])
  } finally {
    running.value = false
  }
}

watch(() => [props.stock.code, props.tradeDate], () => {
  records.value = []
  lastDirection.value = null
  emit('records-change', [])
  errorMessage.value = ''
  expandedRemarkKeys.value = new Set()
})

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== ''
}

function formatInteger(value: unknown) {
  if (!hasValue(value)) return '-'
  if (typeof value !== 'number') return String(value)
  return String(Math.trunc(value))
}

function formatPrice(value?: number) {
  if (!hasValue(value)) return '-'
  return ((value ?? 0) / 100).toFixed(2)
}

function formatIncrease(value?: number) {
  if (!hasValue(value)) return '-'
  return `${(value ?? 0).toFixed(2)}%`
}

function actionTypeLabel(actionType?: number) {
  if (actionType === 1) return '买入'
  if (actionType === 2) return '卖出'
  if (actionType === 3) return '撤单'
  return '-'
}

function actionTypeClass(actionType?: number) {
  if (actionType === 1) return 'buy'
  if (actionType === 2) return 'sell'
  if (actionType === 3) return 'cancel'
  return 'unknown'
}

function formatTickTime(value?: number) {
  if (!hasValue(value)) return '-'
  const text = String(value).padStart(9, '0')
  const hour = String(Number(text.slice(0, 2)))
  const minute = text.slice(2, 4)
  const second = text.slice(4, 6)
  const millisecond = text.slice(6, 9)
  return `${hour}:${minute}:${second}:${millisecond}`
}

function tickSeconds(value?: number) {
  if (!hasValue(value)) return -1
  const text = String(value).padStart(9, '0')
  const hour = Number(text.slice(0, 2))
  const minute = Number(text.slice(2, 4))
  const second = Number(text.slice(4, 6))
  return hour * 3600 + minute * 60 + second
}

function toSecond(time: string) {
  const [hour = '0', minute = '0', second = '0'] = time.split(':')
  return Number(hour) * 3600 + Number(minute) * 60 + Number(second)
}

function auctionPhase(value?: number) {
  const second = tickSeconds(value)
  const isCallAuction =
    (second >= toSecond('09:15') && second <= toSecond('09:25')) ||
    (second >= toSecond('14:57') && second <= toSecond('15:00'))
  const isContinuousAuction =
    (second >= toSecond('09:30') && second <= toSecond('11:30')) ||
    (second >= toSecond('13:00') && second < toSecond('14:57'))
  if (isCallAuction) return 'call-auction'
  if (isContinuousAuction) return 'continuous-auction'
  return 'unknown-phase'
}

function auctionPhaseLabel(value?: number) {
  const phase = auctionPhase(value)
  if (phase === 'call-auction') return '集合竞价'
  if (phase === 'continuous-auction') return '连续竞价'
  return '非交易时段'
}

function recordKey(record: RuleRecord, index: number) {
  return `${record.time ?? index}-${record.ruleCode ?? 'rule'}-${record.actionType ?? 'action'}`
}

function isRemarkOpen(record: RuleRecord, index: number) {
  return expandedRemarkKeys.value.has(recordKey(record, index))
}

function toggleRemark(record: RuleRecord, index: number) {
  const key = recordKey(record, index)
  const next = new Set(expandedRemarkKeys.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  expandedRemarkKeys.value = next
}
</script>

<template>
  <aside class="panel right-panel">
<!--    <div class="panel-head">-->
<!--      <span>{{ stock.name }} 回测</span>-->
<!--      <small>{{ stock.code }}</small>-->
<!--    </div>-->

    <div class="side-body">
      <section class="info-section backtest-runner">
        <div class="backtest-action-row">
          <button type="button" class="primary-button backtest-run-button buy" :disabled="running" @click="runBacktest(1)">
            {{ running ? '执行中' : '买入回测' }}
          </button>
          <button type="button" class="primary-button backtest-run-button sell" :disabled="running" @click="runBacktest(2)">
            {{ running ? '执行中' : '卖出回测' }}
          </button>
        </div>
        <p v-if="errorMessage" class="backtest-output error">{{ errorMessage }}</p>
      </section>

      <section class="info-section backtest-records">
        <h3>回测记录 <small>{{ records.length }} 条</small></h3>
        <div v-if="records.length" class="rule-record-list">
          <article
            v-for="(record, index) in records"
            :key="recordKey(record, index)"
            class="rule-record-card"
            :class="auctionPhase(record.time)"
          >
            <header>
              <strong>
                {{ stock.name }}
                <em class="rule-code-tag">规则 {{ formatInteger(record.ruleCode) }}</em>
              </strong>
              <small class="rule-record-meta">
                <b :class="['rule-action-tag', actionTypeClass(record.actionType)]">{{ actionTypeLabel(record.actionType) }}</b>
                <b :class="['rule-phase-tag', auctionPhase(record.time)]">{{ auctionPhaseLabel(record.time) }}</b>
                <span>{{ record.symbol || stock.code }}</span>
              </small>
            </header>
            <div class="rule-record-summary">
              <div class="rule-summary-item">
                <span>下单时间</span>
                <b>{{ formatTickTime(record.time) }}</b>
                <small v-if="record.lastOrderTime">({{ formatTickTime(record.lastOrderTime) }})</small>
              </div>
              <div class="rule-summary-item">
                <span>下单价格</span>
                <b>{{ formatPrice(record.price) }}</b>
              </div>
              <div class="rule-summary-item">
                <span>涨幅</span>
                <b>{{ formatIncrease(record.increase) }}</b>
              </div>
            </div>
            <div v-if="record.remark" class="rule-remark-wrap">
              <button
                type="button"
                class="rule-remark-toggle"
                :class="{ open: isRemarkOpen(record, index) }"
                :aria-expanded="isRemarkOpen(record, index)"
                @click="toggleRemark(record, index)"
              >
                <span>交易说明</span>
                <i aria-hidden="true"></i>
              </button>
              <p v-if="isRemarkOpen(record, index)" class="rule-record-remark">{{ record.remark }}</p>
            </div>
          </article>
        </div>
        <p v-else class="backtest-output muted">{{ emptyMessage }}</p>
      </section>
    </div>
  </aside>
</template>
