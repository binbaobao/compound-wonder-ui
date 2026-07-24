<script setup lang="ts">
import type { HistoricalBacktestRule } from '../types/market'

defineProps<{
  rules: HistoricalBacktestRule[]
  stockCode: string
  stockName: string
  tradeDate: string
}>()

function formatPrice(value?: number) {
  return value == null ? '-' : (value / 100).toFixed(2)
}

function formatMoney(value?: number) {
  if (value == null) return '-'
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatTime(value?: number) {
  if (value == null) return '-'
  const text = String(value).padStart(9, '0')
  return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}.${text.slice(6, 9)}`
}

function actionLabel(actionType: number) {
  return ({ 1: '买入', 2: '卖出', 3: '撤单' } as Record<number, string>)[actionType] ?? '执行'
}

function actionClass(actionType: number) {
  return ({ 1: 'buy', 2: 'sell', 3: 'cancel' } as Record<number, string>)[actionType] ?? 'unknown'
}

function compactTimeToMillis(value: number) {
  const text = String(value).padStart(9, '0')
  const hour = Number(text.slice(0, 2))
  const minute = Number(text.slice(2, 4))
  const second = Number(text.slice(4, 6))
  const millisecond = Number(text.slice(6, 9))
  return ((hour * 60 + minute) * 60 + second) * 1_000 + millisecond
}

/** Marks a buy rule that did not satisfy the exchange-specific minimum fill delay. */
function isUnfilledBuy(rule: HistoricalBacktestRule) {
  if (rule.actionType !== 1) return false
  if (rule.lastOrderTime == null || rule.lastOrderTime === 0) return true
  const delayMillis = rule.symbol.startsWith('6') ? 500 : 100
  return compactTimeToMillis(rule.lastOrderTime) - compactTimeToMillis(rule.time) <= delayMillis
}
</script>

<template>
  <section class="historical-execution-records" aria-live="polite">
    <header class="historical-execution-head">
      <div>
        <h3>
          实际执行规则
          <small>{{ rules.length }} 条</small>
        </h3>
        <p v-if="stockCode">{{ stockName || stockCode }} · {{ stockCode }} · {{ tradeDate }}</p>
        <p v-else>点击持仓生命周期中的股票后按代码和日期查找</p>
      </div>
    </header>

    <div v-if="rules.length" class="historical-execution-list">
      <article v-for="rule in rules" :key="rule.id" class="historical-execution-card">
        <header>
          <strong>
            <b :class="['rule-action-tag', actionClass(rule.actionType)]">{{ actionLabel(rule.actionType) }}</b>
            规则 {{ rule.ruleCode }}
          </strong>
          <span>{{ formatTime(rule.time) }}</span>
        </header>

        <div class="historical-execution-summary">
          <span>
            <small>价格</small>
            <b>{{ formatPrice(rule.price) }}</b>
          </span>
          <span>
            <small>数量</small>
            <b>{{ rule.quantity?.toLocaleString('zh-CN') ?? '-' }}</b>
          </span>
          <span>
            <small>成交额</small>
            <b>{{ formatMoney(rule.tradeAmount) }}</b>
          </span>
        </div>

        <div class="historical-execution-meta">
          <span v-if="rule.lastOrderTime">最后委托 {{ formatTime(rule.lastOrderTime) }}</span>
          <i v-if="isUnfilledBuy(rule)">未成交</i>
        </div>
        <p v-if="rule.remark">{{ rule.remark }}</p>
      </article>
    </div>

    <div v-else class="historical-execution-empty">
      <strong>{{ stockCode ? '当前代码和日期没有实际执行规则' : '等待选择历史持仓' }}</strong>
      <span v-if="stockCode">{{ stockCode }} · {{ tradeDate }}</span>
      <span v-else>规则不会占用上方单股回测结果区域</span>
    </div>
  </section>
</template>

<style scoped>
.historical-execution-records {
  box-sizing: border-box;
  height: 552px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--panel-soft);
  overflow: hidden;
}

.historical-execution-head {
  flex: 0 0 auto;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--line-soft);
}

.historical-execution-head h3 {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  font-size: 14px;
}

.historical-execution-head h3 small,
.historical-execution-head p {
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
}

.historical-execution-head p {
  margin: 4px 0 0;
  line-height: 1.4;
}

.historical-execution-list {
  flex: 1;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 8px;
  overflow-y: auto;
  padding-right: 2px;
}

.historical-execution-card {
  padding: 9px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: #fff;
}

.historical-execution-card > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.historical-execution-card > header strong {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
  font-size: 12px;
}

.historical-execution-card > header span,
.historical-execution-meta {
  color: var(--muted);
  font-size: 11px;
}

.historical-execution-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.historical-execution-summary span {
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 6px 7px;
  border: 1px solid var(--line-soft);
  border-radius: 5px;
}

.historical-execution-summary small {
  color: var(--muted);
  font-size: 10px;
}

.historical-execution-summary b {
  overflow: hidden;
  color: var(--text);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.historical-execution-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 7px;
}

.historical-execution-meta i {
  padding: 1px 5px;
  border-radius: 4px;
  color: #b42318;
  background: #fee4e2;
  font-style: normal;
  font-weight: 700;
}

.historical-execution-card > p {
  margin: 7px 0 0;
  padding-top: 7px;
  border-top: 1px dashed var(--line-soft);
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
}

.historical-execution-empty {
  flex: 1;
  display: grid;
  place-content: center;
  gap: 5px;
  color: var(--muted);
  text-align: center;
  font-size: 11px;
}

.historical-execution-empty strong {
  color: var(--text);
  font-size: 12px;
}
</style>
