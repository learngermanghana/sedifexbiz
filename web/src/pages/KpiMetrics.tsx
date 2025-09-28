import React from 'react'

import Sparkline from '../components/Sparkline'
import { useStoreMetrics } from '../hooks/useStoreMetrics'

function formatPercent(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export default function KpiMetrics() {
  const {
    rangePresets,
    resolvedRangeId,
    customRange,
    handleRangePresetChange,
    handleCustomDateChange,
    rangeSummary,
    rangeDaysLabel,
    showCustomHint,
    metrics,
    goals,
    goalMonthLabel,
    selectedGoalMonth,
    handleGoalMonthChange,
    goalFormValues,
    handleGoalInputChange,
    handleGoalSubmit,
    isSavingGoals,
    inventoryAlerts,
    teamCallouts,
  } = useStoreMetrics()

  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h2 style={{ color: '#4338CA', marginBottom: 8 }}>KPI &amp; Metrics</h2>
        <p style={{ color: '#475569', margin: 0 }}>
          Track the health of your store with real-time revenue, traffic, and inventory insights. Adjust the
          range to compare performance trends and keep goals on target.
        </p>
      </header>

      <section
        aria-label="Time range controls"
        style={{
          background: '#FFFFFF',
          borderRadius: 20,
          border: '1px solid #E2E8F0',
          padding: '20px 22px',
          display: 'grid',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0F172A' }}>Analyse a window</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
              Choose a preset or set specific dates. All KPIs and charts refresh instantly.
            </p>
          </div>
          <div role="group" aria-label="Quick ranges" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {rangePresets.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleRangePresetChange(option.id)}
                aria-pressed={resolvedRangeId === option.id}
                style={{
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: resolvedRangeId === option.id ? '1px solid #4338CA' : '1px solid #E2E8F0',
                  background: resolvedRangeId === option.id ? '#4338CA' : '#F8FAFC',
                  color: resolvedRangeId === option.id ? '#FFFFFF' : '#1E293B',
                  fontSize: 13,
                  fontWeight: 600,
                  boxShadow: resolvedRangeId === option.id ? '0 4px 12px rgba(67, 56, 202, 0.25)' : 'none',
                  cursor: 'pointer',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            alignItems: 'center',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569' }}>
            <span>From</span>
            <input
              type="date"
              value={customRange.start}
              onChange={event => handleCustomDateChange('start', event.target.value)}
              style={{
                borderRadius: 8,
                border: '1px solid #CBD5F5',
                padding: '6px 10px',
                fontSize: 13,
              }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569' }}>
            <span>To</span>
            <input
              type="date"
              value={customRange.end}
              onChange={event => handleCustomDateChange('end', event.target.value)}
              style={{
                borderRadius: 8,
                border: '1px solid #CBD5F5',
                padding: '6px 10px',
                fontSize: 13,
              }}
            />
          </label>
          <span style={{ fontSize: 13, color: '#1E293B', fontWeight: 600 }}>
            Showing {rangeSummary} ({rangeDaysLabel})
          </span>
        </div>

        {showCustomHint && (
          <p style={{ margin: 0, fontSize: 12, color: '#DC2626' }}>
            Select both start and end dates to apply your custom range. We’re showing today’s data until then.
          </p>
        )}
      </section>

      <section
        aria-label="Key performance indicators"
        style={{ display: 'grid', gap: 20, marginBottom: 32 }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {metrics.map(metric => {
            const change = metric.changePercent
            const color = change === null ? '#475569' : change < 0 ? '#DC2626' : '#16A34A'
            const icon = change === null ? '▬' : change < 0 ? '▼' : '▲'
            const changeText = change !== null ? formatPercent(change) : '—'
            return (
              <article
                key={metric.id}
                style={{
                  background: '#FFFFFF',
                  borderRadius: 18,
                  padding: '20px 22px',
                  border: '1px solid #E2E8F0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                      {metric.title}
                    </div>
                    <div style={{ fontSize: 32, fontWeight: 700, color: '#0F172A', lineHeight: 1.1 }}>
                      {metric.value}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 4, justifyItems: 'end' }}>
                    <span style={{ fontSize: 13, color: '#64748B' }}>{metric.subtitle}</span>
                    <span style={{ fontSize: 12, color: '#64748B' }}>{metric.changeDescription}</span>
                  </div>
                </div>
                <div style={{ height: 72 }} aria-hidden="true">
                  {metric.sparkline && metric.sparkline.length ? (
                    <Sparkline data={metric.sparkline} comparisonData={metric.comparisonSparkline ?? undefined} />
                  ) : (
                    <div
                      style={{
                        fontSize: 12,
                        color: '#94A3B8',
                        display: 'flex',
                        alignItems: 'center',
                        height: '100%',
                      }}
                    >
                      Snapshot metric
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 28,
                      height: 28,
                      borderRadius: '999px',
                      background: '#EEF2FF',
                      color,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                    aria-hidden="true"
                  >
                    {icon}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color }}>{changeText}</span>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section
        aria-label="Goal progress"
        style={{
          background: '#F1F5F9',
          borderRadius: 20,
          border: '1px solid #E2E8F0',
          padding: 24,
          display: 'grid',
          gap: 20,
          marginBottom: 32,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0F172A' }}>Monthly goals</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
              Review how close the team is to this month’s revenue and customer targets.
            </p>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#475569' }}>
            <span style={{ fontWeight: 600 }}>Month</span>
            <input
              type="month"
              value={selectedGoalMonth}
              onChange={event => handleGoalMonthChange(event.target.value)}
              style={{
                borderRadius: 8,
                border: '1px solid #CBD5F5',
                padding: '6px 10px',
                fontSize: 13,
                background: '#FFFFFF',
              }}
            />
          </label>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          {goals.map(goal => (
            <article
              key={goal.title}
              style={{
                background: '#FFFFFF',
                borderRadius: 16,
                padding: '18px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                border: '1px solid #E2E8F0',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {goal.title}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>{goal.value}</div>
              <div style={{ fontSize: 13, color: '#475569' }}>{goal.target}</div>
              <div
                role="progressbar"
                aria-valuenow={Math.round(goal.progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{
                  position: 'relative',
                  height: 8,
                  borderRadius: 999,
                  background: '#E2E8F0',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${Math.round(goal.progress * 100)}%`,
                    background: '#4338CA',
                  }}
                />
              </div>
            </article>
          ))}
        </div>

        <form
          onSubmit={handleGoalSubmit}
          style={{ display: 'grid', gap: 12 }}
        >
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#475569' }} htmlFor="kpi-goal-revenue">
              <span style={{ fontWeight: 600 }}>Revenue goal (GHS)</span>
              <input
                id="kpi-goal-revenue"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={goalFormValues.revenueTarget}
                onChange={event => handleGoalInputChange('revenueTarget', event.target.value)}
                style={{
                  borderRadius: 8,
                  border: '1px solid #CBD5F5',
                  padding: '8px 10px',
                  fontSize: 14,
                  background: '#FFFFFF',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#475569' }} htmlFor="kpi-goal-customers">
              <span style={{ fontWeight: 600 }}>New customers goal</span>
              <input
                id="kpi-goal-customers"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={goalFormValues.customerTarget}
                onChange={event => handleGoalInputChange('customerTarget', event.target.value)}
                style={{
                  borderRadius: 8,
                  border: '1px solid #CBD5F5',
                  padding: '8px 10px',
                  fontSize: 14,
                  background: '#FFFFFF',
                }}
              />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="submit"
              className="primary-button"
              disabled={isSavingGoals}
              style={{
                background: '#4338CA',
                border: 'none',
                borderRadius: 999,
                color: '#FFFFFF',
                padding: '10px 18px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isSavingGoals ? 'Saving…' : 'Save goals'}
            </button>
            <span style={{ fontSize: 12, color: '#475569' }}>
              Targets are saved for {goalMonthLabel}. Adjust them anytime to keep your team focused.
            </span>
          </div>
        </form>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
        }}
      >
        <article
          style={{
            background: '#FFFFFF',
            borderRadius: 20,
            border: '1px solid #E2E8F0',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Inventory alerts</h3>
            <p style={{ fontSize: 13, color: '#64748B' }}>
              Watch products that are running low so the floor team can replenish quickly.
            </p>
          </div>

          {inventoryAlerts.length ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {inventoryAlerts.map(item => (
                <li
                  key={item.sku}
                  style={{
                    border: '1px solid #E2E8F0',
                    borderRadius: 12,
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    background: '#F8FAFC',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: '#0F172A' }}>{item.name}</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color:
                          item.severity === 'critical'
                            ? '#DC2626'
                            : item.severity === 'warning'
                              ? '#C2410C'
                              : '#2563EB',
                      }}
                    >
                      {item.status}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: '#64748B' }}>SKU: {item.sku}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 13, color: '#475569' }}>All inventory levels are healthy.</p>
          )}
        </article>

        <article
          style={{
            background: '#FFFFFF',
            borderRadius: 20,
            border: '1px solid #E2E8F0',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Team callouts</h3>
            <p style={{ fontSize: 13, color: '#64748B' }}>
              Share insights with staff so everyone knows what needs attention in this range.
            </p>
          </div>

          <dl style={{ margin: 0, display: 'grid', gap: 12 }}>
            {teamCallouts.map(item => (
              <div
                key={item.label}
                style={{
                  display: 'grid',
                  gap: 4,
                  background: '#F8FAFC',
                  borderRadius: 12,
                  border: '1px solid #E2E8F0',
                  padding: '12px 14px',
                }}
              >
                <dt style={{ fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {item.label}
                </dt>
                <dd style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{item.value}</dd>
                <dd style={{ margin: 0, fontSize: 13, color: '#475569' }}>{item.description}</dd>
              </div>
            ))}
          </dl>
        </article>
      </section>
    </div>
  )
}
