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
import type {
  HistoricalBacktestDailyRecord,
  HistoricalBacktestPosition,
  HistoricalBacktestRule,
  HistoricalBacktestRun
} from '../types/market'
import { isAbortError, RequestGate } from '../utils/requestGate'
import { ResilientPoller } from '../utils/resilientPoller'
import EquityCurveChart from './EquityCurveChart.vue'

const props = defineProps<{ defaultEndDate: string }>()
const emit = defineEmits<{
  selectPosition: [position: HistoricalBacktestPosition]
  selectRule: [rule: HistoricalBacktestRule]
  rulesChange: [rules: HistoricalBacktestRule[]]
}>()

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
const macNotificationRunId = ref<number | null>(null)
let macCompletionAudioContext: AudioContext | undefined
const runListGate = new RequestGate()
const runDetailGate = new RequestGate()
const resultsGate = new RequestGate()
const poller = new ResilientPoller(pollRun, {
  onError: (error) => {
    if (!isAbortError(error)) {
      errorMessage.value =
        error instanceof Error ? `回测状态查询失败，正在重试：${error.message}` : '回测状态查询失败，正在重试'
    }
  }
})

watch(
  () => props.defaultEndDate,
  (date) => {
    if (!date || endDate.value) return
    endDate.value = date
    if (!startDate.value) {
      const start = new Date(`${date}T00:00:00`)
      start.setDate(start.getDate() - 30)
      startDate.value = formatLocalDate(start)
    }
  },
  { immediate: true }
)

const isRunning = computed(() => run.value?.status === 0 || run.value?.status === 1)
const statusLabel = computed(() => {
  if (!run.value) return '未启动'
  return (
    ({ 0: '待执行', 1: '回测进行中', 2: '已完成', 3: '执行失败' } as Record<number, string>)[run.value.status] ??
    '未知状态'
  )
})
const runDuration = computed(() => formatRunDuration(run.value?.startedTime, run.value?.finishedTime))
const completedPositions = computed(() => positions.value.filter((position) => position.status === 2))
const winRate = computed(() => {
  if (!completedPositions.value.length) return 0
  return (
    completedPositions.value.filter((position) => Number(position.returnRate ?? 0) > 0).length /
    completedPositions.value.length
  )
})
const maxProfitPositionId = computed(
  () =>
    positions.value
      .filter((position) => Number(position.returnRate ?? 0) > 0)
      .reduce<HistoricalBacktestPosition | null>((max, position) => {
        return !max || Number(position.returnRate) > Number(max.returnRate) ? position : max
      }, null)?.id ?? null
)
const maxLossPositionId = computed(
  () =>
    positions.value
      .filter((position) => Number(position.returnRate ?? 0) < 0)
      .reduce<HistoricalBacktestPosition | null>((min, position) => {
        return !min || Number(position.returnRate) < Number(min.returnRate) ? position : min
      }, null)?.id ?? null
)
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
  macNotificationRunId.value = null
  poller.stop()
  runDetailGate.invalidate()
  resultsGate.invalidate()
  prepareMacCompletionSound()
  await requestMacNotificationPermission()
  submitting.value = true
  errorMessage.value = ''
  try {
    const nextRun = await startHistoricalBacktest(startDate.value, endDate.value)
    dailyRecords.value = []
    positions.value = []
    rules.value = []
    emit('rulesChange', [])
    run.value = nextRun
    selectedRunId.value = nextRun.id
    macNotificationRunId.value = nextRun.id
    await loadRuns()
    startPolling()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '启动历史回测失败'
  } finally {
    submitting.value = false
  }
}

/** 查询最近任务列表，供用户选择查看历史结果。 */
async function loadRuns() {
  const request = runListGate.begin()
  try {
    const rows = await fetchHistoricalBacktestRuns(20, request.signal)
    if (runListGate.isCurrent(request.id)) runs.value = rows
  } catch (error) {
    if (isAbortError(error) || !runListGate.isCurrent(request.id)) return
    errorMessage.value = error instanceof Error ? error.message : '历史任务列表加载失败'
  }
}

/** 切换到指定回测任务并加载状态或结果。 */
async function selectRun() {
  if (!selectedRunId.value) return
  poller.stop()
  resultsGate.invalidate()
  const request = runDetailGate.begin()
  const runId = selectedRunId.value
  errorMessage.value = ''
  dailyRecords.value = []
  positions.value = []
  rules.value = []
  emit('rulesChange', [])
  try {
    const nextRun = await fetchHistoricalBacktestRun(runId, request.signal)
    if (!runDetailGate.isCurrent(request.id) || selectedRunId.value !== runId) return
    run.value = nextRun
    startDate.value = nextRun.startDate
    endDate.value = nextRun.endDate
    if (nextRun.status === 2) {
      await loadResults(nextRun.id)
    } else if (nextRun.status !== 3) {
      startPolling()
    }
  } catch (error) {
    if (isAbortError(error) || !runDetailGate.isCurrent(request.id)) return
    errorMessage.value = error instanceof Error ? error.message : '历史回测任务加载失败'
  }
}

/** 轮询回测任务状态，完成或失败后停止。 */
function startPolling() {
  if (!run.value?.id) return
  poller.start()
}

/** Polls once and returns whether polling should continue. */
async function pollRun(): Promise<boolean> {
  const runId = run.value?.id
  if (!runId) return false
  const request = runDetailGate.begin()
  const nextRun = await fetchHistoricalBacktestRun(runId, request.signal)
  if (!runDetailGate.isCurrent(request.id) || selectedRunId.value !== runId) return false
  run.value = nextRun
  errorMessage.value = ''
  if (nextRun.status === 2) {
    await loadResults(runId)
    notifyMacBacktestCompletion(nextRun)
    await loadRuns()
    return false
  }
  if (nextRun.status === 3) {
    if (macNotificationRunId.value === runId) macNotificationRunId.value = null
    return false
  }
  return true
}

/** Manually refreshes once and resumes resilient polling for a running task. */
async function refreshRun() {
  poller.stop()
  try {
    if (await pollRun()) startPolling()
  } catch (error) {
    if (isAbortError(error)) return
    errorMessage.value = error instanceof Error ? error.message : '回测状态查询失败'
    if (isRunning.value) startPolling()
  }
}

/** 加载已完成任务的权益、持仓和实际执行规则。 */
async function loadResults(runId: number) {
  const request = resultsGate.begin()
  loadingResults.value = true
  try {
    const [daily, positionRows, ruleRows] = await Promise.all([
      fetchHistoricalBacktestDailyRecords(runId, request.signal),
      fetchHistoricalBacktestPositions(runId, request.signal),
      fetchHistoricalBacktestRules(runId, request.signal)
    ])
    if (!resultsGate.isCurrent(request.id) || selectedRunId.value !== runId) return
    dailyRecords.value = daily
    positions.value = positionRows
    rules.value = ruleRows
    emit('rulesChange', ruleRows)
  } catch (error) {
    if (isAbortError(error) || !resultsGate.isCurrent(request.id)) return
    errorMessage.value = error instanceof Error ? error.message : '回测结果加载失败'
  } finally {
    if (resultsGate.isCurrent(request.id)) loadingResults.value = false
  }
}

function formatMoney(value?: number) {
  return Number(value ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatRate(value?: number) {
  return `${(Number(value ?? 0) * 100).toFixed(2)}%`
}

function formatTime(value?: number) {
  const text = String(value ?? 0).padStart(9, '0')
  return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}.${text.slice(6, 9)}`
}

function actionLabel(actionType: number) {
  return ({ 1: '买入', 2: '卖出', 3: '撤单' } as Record<number, string>)[actionType] ?? `动作${actionType}`
}

function actionClass(actionType: number) {
  if (actionType === 1) return 'rule-buy'
  if (actionType === 2) return 'rule-sell'
  if (actionType === 3) return 'rule-cancel'
  return ''
}

function compactTimeToMillis(value: number) {
  const text = String(value ?? 0).padStart(9, '0')
  const hours = Number(text.slice(0, 2))
  const minutes = Number(text.slice(2, 4))
  const seconds = Number(text.slice(4, 6))
  const millis = Number(text.slice(6, 9))
  return ((hours * 60 + minutes) * 60 + seconds) * 1_000 + millis
}

function isUnfilledBuy(rule: HistoricalBacktestRule) {
  if (rule.actionType !== 1) return false
  if (rule.lastOrderTime == null || rule.lastOrderTime === 0) return true
  const delayMillis = rule.symbol.startsWith('6') ? 500 : 100
  return compactTimeToMillis(rule.lastOrderTime) - compactTimeToMillis(rule.time) <= delayMillis
}

/** 判断当前浏览器是否运行在 macOS 桌面系统。 */
function isMacOS() {
  return navigator.userAgent.includes('Macintosh')
}

/** 在启动回测的用户操作中预热音频，避免任务完成时被浏览器自动播放策略拦截。 */
function prepareMacCompletionSound() {
  if (!isMacOS() || !('AudioContext' in window)) return
  macCompletionAudioContext ??= new AudioContext()
  void macCompletionAudioContext.resume().catch(() => {
    // 音频被浏览器策略拦截时，系统横幅通知仍会正常发送。
  })
}

/** 回测完成后主动播放两声短提示，补足 macOS 系统通知可能静音的情况。 */
function playMacCompletionSound() {
  const context = macCompletionAudioContext
  if (!isMacOS() || !context || context.state !== 'running') return

  const now = context.currentTime
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(880, now)
  oscillator.frequency.setValueAtTime(1_176, now + 0.2)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14)
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.21)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
  oscillator.connect(gain).connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.36)
}

/** 在用户启动回测时请求 macOS 系统通知权限，不阻塞回测任务。 */
async function requestMacNotificationPermission() {
  if (!isMacOS() || !('Notification' in window) || Notification.permission !== 'default') return
  try {
    await Notification.requestPermission()
  } catch {
    // 通知权限被浏览器策略拦截时，回测仍照常执行。
  }
}

/** 对当前页面启动且已完成的回测任务发送 macOS 系统通知。 */
function notifyMacBacktestCompletion(completedRun: HistoricalBacktestRun) {
  if (!isMacOS() || macNotificationRunId.value !== completedRun.id) return
  macNotificationRunId.value = null
  playMacCompletionSound()
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  const duration = formatRunDuration(completedRun.startedTime, completedRun.finishedTime)
  const body = [
    `${completedRun.startDate} 至 ${completedRun.endDate}`,
    `累计收益 ${formatRate(completedRun.totalReturnRate)} · 最终资产 ${formatMoney(completedRun.finalAsset)}`,
    duration ? `耗时 ${duration}` : ''
  ]
    .filter(Boolean)
    .join('\n')
  new Notification('擒龙捉妖 · 回测完成', {
    body,
    tag: `historical-backtest-${completedRun.id}`,
    silent: false
  })
}

/** 将后端 ISO 本地时间显示为空格分隔格式。 */
function formatRunDateTime(value?: string) {
  return value?.replace('T', ' ') ?? ''
}

/** 使用任务开始、结束时间计算完整回测耗时。 */
function formatRunDuration(startedTime?: string, finishedTime?: string) {
  if (!startedTime || !finishedTime) return ''
  const elapsedMilliseconds = new Date(finishedTime).getTime() - new Date(startedTime).getTime()
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) return ''

  const totalSeconds = Math.floor(elapsedMilliseconds / 1000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (days) parts.push(`${days}天`)
  if (hours || days) parts.push(`${hours}小时`)
  if (minutes || hours || days) parts.push(`${minutes}分`)
  parts.push(`${seconds}秒`)
  return parts.join('')
}

/** 持仓收益按 A 股习惯显示：不亏红色加号，亏损绿色减号。 */
function formatPositionReturnRate(value?: number) {
  const rate = Number(value ?? 0) * 100
  return `${rate >= 0 ? '+' : '-'}${Math.abs(rate).toFixed(2)}%`
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
  const previousAsset =
    index === 0 ? Number(run.value?.initialCapital ?? 0) : Number(dailyRecords.value[index - 1]?.totalAsset ?? 0)
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

/** 将本地日期格式化为日期输入框所需的 yyyy-MM-dd。 */
function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function historicalRunStatusLabel(status: number) {
  return ({ 0: '待执行', 1: '执行中', 2: '完成', 3: '失败' } as Record<number, string>)[status] ?? '未知'
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') equityOpen.value = false
}

onBeforeUnmount(() => {
  poller.stop()
  runListGate.invalidate()
  runDetailGate.invalidate()
  resultsGate.invalidate()
  emit('rulesChange', [])
  window.removeEventListener('keydown', handleWindowKeydown)
  if (macCompletionAudioContext) {
    void macCompletionAudioContext.close().catch(() => undefined)
    macCompletionAudioContext = undefined
  }
})

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown)
  void loadRuns()
})
</script>

<template>
  <section class="historical-backtest panel" aria-label="完整历史回测">
    <div class="historical-controls">
      <label class="historical-run-picker">
        历史任务
        <select v-model="selectedRunId" @change="selectRun">
          <option :value="null">选择 runId 查看</option>
          <option v-for="item in runs" :key="item.id" :value="item.id">
            #{{ item.id }} · {{ item.startDate }} 至 {{ item.endDate }} · {{ historicalRunStatusLabel(item.status) }}
          </option>
        </select>
      </label>
      <button
        class="historical-equity-button"
        type="button"
        :disabled="!run || loadingResults"
        @click="equityOpen = true"
      >
        <BarChart3 :size="15" />
        <span>每日权益</span>
      </button>
      <div class="historical-metric">
        <span>初始资金</span>
        <b>{{ formatMoney(run?.initialCapital) }}</b>
      </div>
      <div class="historical-metric">
        <span>最终资产</span>
        <b>{{ formatMoney(run?.finalAsset) }}</b>
      </div>
      <div class="historical-metric">
        <span>累计收益</span>
        <b :class="Number(run?.totalReturnRate ?? 0) >= 0 ? 'positive' : 'negative'">
          {{ formatRate(run?.totalReturnRate) }}
        </b>
      </div>
      <div class="historical-metric">
        <span>封板率</span>
        <b>{{ formatRate(limitUpSealRate) }}</b>
      </div>
      <div class="historical-metric">
        <span>平仓 / 胜率</span>
        <b>{{ completedPositions.length }} / {{ formatRate(winRate) }}</b>
      </div>
      <label>
        开始日期
        <input v-model="startDate" type="date" :disabled="isRunning" />
      </label>
      <label>
        结束日期
        <input v-model="endDate" type="date" :disabled="isRunning" />
      </label>
      <button
        class="historical-start"
        type="button"
        :disabled="!startDate || !endDate || submitting || isRunning"
        @click="startRun"
      >
        <LoaderCircle v-if="submitting || isRunning" :size="15" class="spinning" />
        <Play v-else :size="15" />
        <span>{{ isRunning ? '回测进行中' : '启动回测' }}</span>
      </button>
      <button
        v-if="run"
        class="historical-refresh"
        type="button"
        :disabled="isRunning || loadingResults"
        @click="refreshRun"
      >
        <RefreshCw :size="15" :class="{ spinning: loadingResults }" />
      </button>
    </div>

    <div v-if="run" class="historical-status" :class="`status-${run.status}`">
      <span>
        <b>{{ statusLabel }}</b>
      </span>
      <span>{{ run.startDate }} 至 {{ run.endDate }}</span>
      <span v-if="run.lastCompletedDate && run.status !== 2">已处理到 {{ run.lastCompletedDate }}</span>
      <span v-if="run.startedTime">开始于 {{ formatRunDateTime(run.startedTime) }}</span>
      <span v-if="run.finishedTime">结束于 {{ formatRunDateTime(run.finishedTime) }}</span>
      <span v-if="runDuration">回测用时 {{ runDuration }}</span>
      <span v-if="run.errorMessage" class="historical-error">{{ run.errorMessage }}</span>
    </div>
    <p v-if="errorMessage" class="historical-error historical-message">{{ errorMessage }}</p>

    <template v-if="run?.status === 2">
      <div class="historical-result-grid">
        <section>
          <div class="historical-section-head">
            <span>持仓生命周期</span>
            <small>{{ positions.length }} 笔</small>
          </div>
          <div v-if="positions.length" class="historical-list">
            <article v-for="position in positions" :key="position.id" class="historical-position">
              <strong class="historical-position-title">
                <button class="position-stock-name" type="button" @click="emit('selectPosition', position)">
                  {{ position.symbolName || position.symbol }}
                </button>
                <small>{{ position.symbol }}</small>
                <i v-if="position.id === maxProfitPositionId" class="position-max-gain">MAX赚</i>
                <i v-if="position.id === maxLossPositionId" class="position-max-loss">MAX亏</i>
              </strong>
              <div class="historical-position-return">
                <b :class="Number(position.returnRate ?? 0) >= 0 ? 'positive' : 'position-loss'">
                  {{ formatPositionReturnRate(position.returnRate) }}
                </b>
                <span>
                  {{ formatPrice(position.buyPrice) }} →
                  {{ position.sellPrice ? formatPrice(position.sellPrice) : '-' }}，{{ position.holdingTradeDays }} 天
                </span>
              </div>
              <small>{{ position.buyDate }} {{ position.sellDate ? `→ ${position.sellDate}` : '持仓中' }}</small>
            </article>
          </div>
          <p v-else class="historical-empty">暂无持仓记录</p>
        </section>
        <section>
          <div class="historical-section-head">
            <span>实际执行规则</span>
            <small>{{ rules.length }} 条</small>
          </div>
          <div v-if="rules.length" class="historical-list">
            <article v-for="rule in rules" :key="rule.id" class="historical-rule">
              <div class="historical-rule-title">
                <strong :class="actionClass(rule.actionType)">{{ actionLabel(rule.actionType) }}</strong>
                <button class="rule-stock-name" type="button" @click="emit('selectRule', rule)">
                  {{ rule.symbolName || rule.symbol }}
                </button>
                <em>规则 {{ rule.ruleCode }} · {{ formatTime(rule.time) }}</em>
                <i v-if="isUnfilledBuy(rule)" class="rule-unfilled">未成交</i>
              </div>
              <small>
                {{ rule.tradeDate }}
                <template v-if="rule.remark">· {{ rule.remark }}</template>
              </small>
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
          <div>
            <strong>每日权益</strong>
            <small>{{ run?.startDate }} 至 {{ run?.endDate }} · {{ dailyRecords.length }} 个交易日</small>
          </div>
          <button type="button" aria-label="关闭每日权益" @click="equityOpen = false"><X :size="18" /></button>
        </header>
        <div class="equity-modal-chart">
          <EquityCurveChart :records="dailyRecords" :loading="loadingResults" />
        </div>
        <div v-if="dailyRecords.length" class="equity-modal-list">
          <div class="equity-modal-table-head">
            <span>日期</span>
            <span>持仓状态</span>
            <span>总资产</span>
            <span>每日变动</span>
            <span>变动金额</span>
            <span>累计收益</span>
          </div>
          <article v-for="(record, index) in dailyRecords" :key="record.id">
            <span>{{ record.tradeDate }}</span>
            <small>{{ record.accountStatus === 1 ? `${record.symbolName || record.symbol} 持仓` : '空仓' }}</small>
            <b>{{ formatMoney(record.totalAsset) }}</b>
            <em :class="dailyChangeClass(record)">{{ formatRate(dailyChangeRate(record)) }}</em>
            <em :class="dailyChangeAmountClass(dailyChangeAmount(record, index))">
              {{ formatSignedMoney(dailyChangeAmount(record, index)) }}
            </em>
            <em :class="Number(record.cumulativeReturnRate) >= 0 ? 'positive' : 'negative'">
              {{ formatRate(record.cumulativeReturnRate) }}
            </em>
          </article>
        </div>
      </section>
    </div>
  </Teleport>
</template>
