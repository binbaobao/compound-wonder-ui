<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BarChart3, LoaderCircle, Play, RefreshCw, X } from 'lucide-vue-next'
import {
  fetchHistoricalBacktestDailyRecords,
  fetchHistoricalBacktestPositions,
  fetchHistoricalBacktestRules,
  fetchHistoricalBacktestRun,
  fetchHistoricalBacktestRuns,
  startHistoricalBacktest
} from '../api/market'
import type { HistoricalBacktestDailyRecord, HistoricalBacktestPosition, HistoricalBacktestRule, HistoricalBacktestRun } from '../types/market'

const props = defineProps<{ defaultEndDate: string }>()

const startDate = ref('')
const endDate = ref('')
const run = ref<HistoricalBacktestRun | null>(null)
const runs = ref<HistoricalBacktestRun[]>([])
const selectedRunId = ref<number | null>(null)
const dailyRecords = ref<HistoricalBacktestDailyRecord[]>([])
const positions = ref<HistoricalBacktestPosition[]>([])
const rules = ref<HistoricalBacktestRule[]>([])
const submitting = ref(false)
const loadingResults = ref(false)
const equityOpen = ref(false)
const errorMessage = ref('')
let pollTimer: ReturnType<typeof setTimeout> | undefined

watch(() => props.defaultEndDate, date => {
  if (!date || endDate.value) return
  endDate.value = date
  if (!startDate.value) {
    const start = new Date(`${date}T00:00:00`)
    start.setDate(start.getDate() - 30)
    startDate.value = formatLocalDate(start)
  }
}, { immediate: true })

const isRunning = computed(() => run.value?.status === 0 || run.value?.status === 1)
const statusLabel = computed(() => {
  if (!run.value) return '未启动'
  return ({ 0: '待执行', 1: '回测进行中', 2: '已完成', 3: '执行失败' } as Record<number, string>)[run.value.status] ?? '未知状态'
})
const equityChart = computed(() => {
  const records = dailyRecords.value
  const values = records.map(record => Number(record.cumulativeReturnRate ?? 0)).filter(value => Number.isFinite(value))
  if (!values.length) return null
  const rawMin = Math.min(0, ...values)
  const rawMax = Math.max(0, ...values)
  const padding = Math.max((rawMax - rawMin) * 0.12, 0.01)
  const min = rawMin - padding
  const max = rawMax + padding
  const range = max - min || 1
  const left = 14
  const right = 97
  const top = 5
  const bottom = 50
  const toY = (value: number) => bottom - (value - min) / range * (bottom - top)
  return {
    points: values.map((value, index) => {
      const x = values.length === 1 ? (left + right) / 2 : left + index / (values.length - 1) * (right - left)
      return `${x.toFixed(2)},${toY(value).toFixed(2)}`
    }).join(' '),
    min,
    max,
    zeroY: toY(0),
    left,
    right,
    top,
    bottom,
    firstDate: records[0]?.tradeDate ?? '',
    middleDate: records[Math.floor((records.length - 1) / 2)]?.tradeDate ?? '',
    lastDate: records[records.length - 1]?.tradeDate ?? ''
  }
})
const completedPositions = computed(() => positions.value.filter(position => position.status === 2))
const winRate = computed(() => {
  if (!completedPositions.value.length) return 0
  return completedPositions.value.filter(position => Number(position.returnRate ?? 0) > 0).length / completedPositions.value.length
})
const maxProfitPositionId = computed(() => positions.value
  .filter(position => Number(position.returnRate ?? 0) > 0)
  .reduce<HistoricalBacktestPosition | null>((max, position) => {
    return !max || Number(position.returnRate) > Number(max.returnRate) ? position : max
  }, null)?.id ?? null)
const maxLossPositionId = computed(() => positions.value
  .filter(position => Number(position.returnRate ?? 0) < 0)
  .reduce<HistoricalBacktestPosition | null>((min, position) => {
    return !min || Number(position.returnRate) < Number(min.returnRate) ? position : min
  }, null)?.id ?? null)
const limitUpSealRate = computed(() => {
  const positionCount = positions.value.length
  if (!positionCount) return 0
  const breakCount = Math.min(positionCount, Math.max(0, Number(run.value?.limitUpBreakCount ?? 0)))
  return (positionCount - breakCount) / positionCount
})

/** 启动完整历史回测任务并开始轮询状态。 */
async function startRun() {
  if (!startDate.value || !endDate.value || submitting.value || isRunning.value) return
  if (startDate.value > endDate.value) {
    errorMessage.value = '开始日期不能晚于结束日期'
    return
  }
  submitting.value = true
  errorMessage.value = ''
  dailyRecords.value = []
  positions.value = []
  rules.value = []
  try {
    run.value = await startHistoricalBacktest(startDate.value, endDate.value)
    selectedRunId.value = run.value.id
    await loadRuns()
    schedulePoll()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '启动历史回测失败'
  } finally {
    submitting.value = false
  }
}

/** 查询最近任务列表，供用户选择查看历史结果。 */
async function loadRuns() {
  try {
    runs.value = await fetchHistoricalBacktestRuns()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '历史任务列表加载失败'
  }
}

/** 切换到指定回测任务并加载状态或结果。 */
async function selectRun() {
  if (!selectedRunId.value) return
  if (pollTimer) clearTimeout(pollTimer)
  errorMessage.value = ''
  dailyRecords.value = []
  positions.value = []
  rules.value = []
  try {
    run.value = await fetchHistoricalBacktestRun(selectedRunId.value)
    startDate.value = run.value.startDate
    endDate.value = run.value.endDate
    if (run.value.status === 2) {
      await loadResults(run.value.id)
    } else if (run.value.status !== 3) {
      schedulePoll()
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '历史回测任务加载失败'
  }
}

/** 轮询回测任务状态，完成或失败后停止。 */
function schedulePoll() {
  if (!run.value?.id) return
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(refreshRun, 1500)
}

/** 刷新任务状态，并在完成时加载所有结果数据。 */
async function refreshRun() {
  if (!run.value?.id) return
  try {
    run.value = await fetchHistoricalBacktestRun(run.value.id)
    if (run.value.status === 2) {
      await loadResults(run.value.id)
      return
    }
    if (run.value.status !== 3) schedulePoll()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '回测状态查询失败'
  }
}

/** 加载已完成任务的权益、持仓和实际执行规则。 */
async function loadResults(runId: number) {
  loadingResults.value = true
  try {
    const [daily, positionRows, ruleRows] = await Promise.all([
      fetchHistoricalBacktestDailyRecords(runId),
      fetchHistoricalBacktestPositions(runId),
      fetchHistoricalBacktestRules(runId)
    ])
    dailyRecords.value = daily
    positions.value = positionRows
    rules.value = ruleRows
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '回测结果加载失败'
  } finally {
    loadingResults.value = false
  }
}

function formatMoney(value?: number) {
  return Number(value ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatRate(value?: number) {
  return `${(Number(value ?? 0) * 100).toFixed(2)}%`
}

/** 持仓收益按 A 股习惯显示：不亏红色加号，亏损绿色减号。 */
function formatPositionReturnRate(value?: number) {
  const rate = Number(value ?? 0) * 100
  return `${rate >= 0 ? '+' : '-'}${Math.abs(rate).toFixed(2)}%`
}

function formatAxisRate(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

/** 使用后端每日账户收益；空仓卖出结算日仍可能产生收益。 */
function dailyChangeRate(record: HistoricalBacktestDailyRecord) {
  return Number(record.dailyReturnRate ?? 0)
}

/** 每日变动按 A 股习惯标识：赚红、亏绿、空仓灰。 */
function dailyChangeClass(record: HistoricalBacktestDailyRecord) {
  const rate = dailyChangeRate(record)
  if (rate > 0) return 'equity-gain'
  if (rate < 0) return 'equity-loss'
  return 'equity-flat'
}

/** 计算相对上一交易日的资产变动金额，首日以初始资金为基准。 */
function dailyChangeAmount(record: HistoricalBacktestDailyRecord, index: number) {
  const previousAsset = index === 0
    ? Number(run.value?.initialCapital ?? 0)
    : Number(dailyRecords.value[index - 1]?.totalAsset ?? 0)
  return Number(record.totalAsset ?? 0) - previousAsset
}

function formatSignedMoney(value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatMoney(Math.abs(value))}`
}

function dailyChangeAmountClass(value: number) {
  if (value > 0) return 'equity-gain'
  if (value < 0) return 'equity-loss'
  return 'equity-flat'
}

function formatPrice(value?: number) {
  return (Number(value ?? 0) / 100).toFixed(2)
}

function formatTime(value?: number) {
  const text = String(value ?? 0).padStart(9, '0')
  return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}.${text.slice(6, 9)}`
}

/** 将本地日期格式化为日期输入框所需的 yyyy-MM-dd。 */
function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function actionLabel(actionType: number) {
  return ({ 1: '买入', 2: '卖出', 3: '撤单' } as Record<number, string>)[actionType] ?? '执行'
}

function actionClass(actionType: number) {
  return ({ 1: 'rule-buy', 2: 'rule-sell', 3: 'rule-cancel' } as Record<number, string>)[actionType] ?? 'rule-cancel'
}

onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer)
})

onMounted(loadRuns)
</script>

<template>
  <section class="historical-backtest panel" aria-label="完整历史回测">
    <div class="historical-controls">
      <label class="historical-run-picker">历史任务
        <select v-model="selectedRunId" @change="selectRun">
          <option :value="null">选择 runId 查看</option>
          <option v-for="item in runs" :key="item.id" :value="item.id">#{{ item.id }} · {{ item.startDate }} 至 {{ item.endDate }} · {{ ({ 0: '待执行', 1: '执行中', 2: '完成', 3: '失败' } as Record<number, string>)[item.status] }}</option>
        </select>
      </label>
      <button class="historical-equity-button" type="button" :disabled="!run || loadingResults" @click="equityOpen = true">
        <BarChart3 :size="15" />
        <span>每日权益</span>
      </button>
      <div class="historical-metric"><span>初始资金</span><b>{{ formatMoney(run?.initialCapital) }}</b></div>
      <div class="historical-metric"><span>最终资产</span><b>{{ formatMoney(run?.finalAsset) }}</b></div>
      <div class="historical-metric"><span>累计收益</span><b :class="Number(run?.totalReturnRate ?? 0) >= 0 ? 'positive' : 'negative'">{{ formatRate(run?.totalReturnRate) }}</b></div>
      <div class="historical-metric"><span>封板率</span><b>{{ formatRate(limitUpSealRate) }}</b></div>
      <div class="historical-metric"><span>平仓 / 胜率</span><b>{{ completedPositions.length }} / {{ formatRate(winRate) }}</b></div>
      <label>开始日期<input v-model="startDate" type="date" :disabled="isRunning" /></label>
      <label>结束日期<input v-model="endDate" type="date" :disabled="isRunning" /></label>
      <button class="historical-start" type="button" :disabled="!startDate || !endDate || submitting || isRunning" @click="startRun">
        <LoaderCircle v-if="submitting || isRunning" :size="15" class="spinning" />
        <Play v-else :size="15" />
        <span>{{ isRunning ? '回测进行中' : '启动回测' }}</span>
      </button>
      <button v-if="run" class="historical-refresh" type="button" :disabled="isRunning || loadingResults" @click="refreshRun">
        <RefreshCw :size="15" :class="{ spinning: loadingResults }" />
      </button>
    </div>

    <div v-if="run" class="historical-status" :class="`status-${run.status}`">
      <span><b>{{ statusLabel }}</b></span>
      <span>{{ run.startDate }} 至 {{ run.endDate }}</span>
      <span v-if="run.lastCompletedDate">已处理到 {{ run.lastCompletedDate }}</span>
      <span v-if="run.finishedTime">结束于 {{ run.finishedTime }}</span>
      <span v-if="run.errorMessage" class="historical-error">{{ run.errorMessage }}</span>
    </div>
    <p v-if="errorMessage" class="historical-error historical-message">{{ errorMessage }}</p>

    <template v-if="run?.status === 2">
      <div class="historical-result-grid">
        <section>
          <div class="historical-section-head"><span>持仓生命周期</span><small>{{ positions.length }} 笔</small></div>
          <div v-if="positions.length" class="historical-list">
            <article v-for="position in positions" :key="position.id" class="historical-position">
              <strong class="historical-position-title">
                <span class="position-stock-name">{{ position.symbolName || position.symbol }}</span>
                <small>{{ position.symbol }}</small>
                <i v-if="position.id === maxProfitPositionId" class="position-max-gain">MAX赚</i>
                <i v-if="position.id === maxLossPositionId" class="position-max-loss">MAX亏</i>
              </strong>
              <div class="historical-position-return">
                <b :class="Number(position.returnRate ?? 0) >= 0 ? 'positive' : 'position-loss'">{{ formatPositionReturnRate(position.returnRate) }}</b>
                <span>{{ formatPrice(position.buyPrice) }} → {{ position.sellPrice ? formatPrice(position.sellPrice) : '-' }}，{{ position.holdingTradeDays }} 天</span>
              </div>
              <small>{{ position.buyDate }} {{ position.sellDate ? `→ ${position.sellDate}` : '持仓中' }}</small>
            </article>
          </div>
          <p v-else class="historical-empty">暂无持仓记录</p>
        </section>
        <section>
          <div class="historical-section-head"><span>实际执行规则</span><small>{{ rules.length }} 条</small></div>
          <div v-if="rules.length" class="historical-list">
            <article v-for="rule in rules" :key="rule.id" class="historical-rule">
              <div class="historical-rule-title">
                <strong :class="actionClass(rule.actionType)">{{ actionLabel(rule.actionType) }}</strong>
                <b>{{ rule.symbolName || rule.symbol }}</b>
                <em>规则 {{ rule.ruleCode }} · {{ formatTime(rule.time) }}</em>
              </div>
              <small>{{ rule.tradeDate }}<template v-if="rule.remark"> · {{ rule.remark }}</template></small>
            </article>
          </div>
          <p v-else class="historical-empty">暂无实际执行规则</p>
        </section>
      </div>
    </template>
  </section>

  <Teleport to="body">
    <div v-if="equityOpen" class="equity-modal-backdrop" @click.self="equityOpen = false">
      <section class="equity-modal" role="dialog" aria-modal="true" aria-label="每日权益">
        <header>
          <div><strong>每日权益</strong><small>{{ run?.startDate }} 至 {{ run?.endDate }} · {{ dailyRecords.length }} 个交易日</small></div>
          <button type="button" aria-label="关闭每日权益" @click="equityOpen = false"><X :size="18" /></button>
        </header>
        <div class="equity-modal-chart">
          <svg v-if="equityChart" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="每日累计收益率走势">
            <line :x1="equityChart.left" :x2="equityChart.left" :y1="equityChart.top" :y2="equityChart.bottom" class="equity-axis" />
            <line :x1="equityChart.left" :x2="equityChart.right" :y1="equityChart.bottom" :y2="equityChart.bottom" class="equity-axis" />
            <line :x1="equityChart.left" :x2="equityChart.right" :y1="equityChart.zeroY" :y2="equityChart.zeroY" class="equity-zero-axis" />
            <polyline :points="equityChart.points" fill="none" class="equity-line" stroke-width="1.4" vector-effect="non-scaling-stroke" />
            <text x="12" :y="equityChart.top + 1" text-anchor="end" class="equity-y-label">{{ formatAxisRate(equityChart.max) }}</text>
            <text x="12" :y="equityChart.zeroY + 1" text-anchor="end" class="equity-y-label">0%</text>
            <text x="12" :y="equityChart.bottom" text-anchor="end" class="equity-y-label">{{ formatAxisRate(equityChart.min) }}</text>
            <text :x="equityChart.left" y="57" text-anchor="start" class="equity-x-label">{{ equityChart.firstDate }}</text>
            <text x="55" y="57" text-anchor="middle" class="equity-x-label">{{ equityChart.middleDate }}</text>
            <text :x="equityChart.right" y="57" text-anchor="end" class="equity-x-label">{{ equityChart.lastDate }}</text>
          </svg>
          <p v-else class="historical-empty">{{ loadingResults ? '正在加载回测结果' : '暂无每日权益数据' }}</p>
        </div>
        <div v-if="dailyRecords.length" class="equity-modal-list">
          <div class="equity-modal-table-head">
            <span>日期</span><span>持仓状态</span><span>总资产</span><span>每日变动</span><span>变动金额</span><span>累计收益</span>
          </div>
          <article v-for="(record, index) in dailyRecords" :key="record.id">
            <span>{{ record.tradeDate }}</span>
            <small>{{ record.accountStatus === 1 ? `${record.symbolName || record.symbol} 持仓` : '空仓' }}</small>
            <b>{{ formatMoney(record.totalAsset) }}</b>
            <em :class="dailyChangeClass(record)">{{ formatRate(dailyChangeRate(record)) }}</em>
            <em :class="dailyChangeAmountClass(dailyChangeAmount(record, index))">{{ formatSignedMoney(dailyChangeAmount(record, index)) }}</em>
            <em :class="Number(record.cumulativeReturnRate) >= 0 ? 'positive' : 'negative'">{{ formatRate(record.cumulativeReturnRate) }}</em>
          </article>
        </div>
      </section>
    </div>
  </Teleport>
</template>
