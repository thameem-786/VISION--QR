import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Camera, FileSpreadsheet } from 'lucide-react';
import type { InspectionRecord, MetricsSummary, ViewTab } from '../types/vision.ts';
import { BUTTON_SPRING_PROPS, SPRING_INTERACTIVE, SPRING_PANEL } from '../utils/motionPresets.ts';

interface OverviewViewProps {
  metrics: MetricsSummary;
  recentInspections: InspectionRecord[];
  loading: boolean;
  onNavigate: (tab: ViewTab) => void;
  onSelectInspection: (record: InspectionRecord) => void;
}

export function OverviewView({
  metrics,
  recentInspections,
  loading,
  onNavigate,
  onSelectInspection,
}: OverviewViewProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const kpis = [
    {
      label: 'Total Inspections',
      value: metrics.totalInspections.toLocaleString(),
      tone: 'text-slate-900',
      sub: 'Logged station runs',
    },
    {
      label: 'Accepted (OK)',
      value: metrics.acceptedCount.toLocaleString(),
      tone: 'text-emerald-700',
      sub:
        metrics.totalInspections > 0
          ? `${Math.round((metrics.acceptedCount / metrics.totalInspections) * 100)}% yield`
          : 'Awaiting first inspection',
    },
    {
      label: 'Rejected (NG)',
      value: metrics.rejectedCount.toLocaleString(),
      tone: 'text-red-700',
      sub: 'QR, OCR, or visual fail',
    },
    {
      label: 'QR Read Success Rate',
      value: `${metrics.qrSuccessRate}%`,
      tone: 'text-slate-900',
      sub: 'Decoded matrix rate',
    },
    {
      label: 'Avg Cycle Time',
      value: `${metrics.avgCycleTimeMs} ms`,
      tone: 'text-slate-900',
      sub: 'End-to-end vision pass',
    },
    {
      label: 'Defect Detection Rate',
      value: `${metrics.defectDetectionRate}%`,
      tone: 'text-slate-900',
      sub: 'Flagged anomalies',
    },
  ];

  const maxBucket = Math.max(
    1,
    ...metrics.trend.map((b) => Math.max(b.okCount + b.ngCount, 1))
  );

  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <section aria-label="Key station metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi, idx) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2 }}
            transition={{
              duration: 0.22,
              delay: idx * 0.035,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="glass-card relative overflow-hidden rounded-xl px-5 py-4 transition-shadow"
          >
            <div className="navy-accent-bar absolute inset-x-0 top-0 h-[2px] opacity-80" />
            <p className="text-xs font-medium text-slate-600">{kpi.label}</p>
            {loading ? (
              <div className="mt-2 h-8 w-24 animate-pulse rounded bg-blue-950/10" />
            ) : (
              <p className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${kpi.tone}`}>
                {kpi.value}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">{kpi.sub}</p>
          </motion.div>
        ))}
      </section>

      {/* Inspection Trend */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
        className="glass-panel relative overflow-hidden rounded-xl p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-blue-950/12 pb-4">
          <div>
            <h2 className="text-base font-bold text-[#0b1736]">Inspection Trend</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Chronological OK vs. NG inspection counts across recent intervals
            </p>
          </div>
          <div className="flex items-center gap-5 text-xs text-slate-600">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
              Accepted (OK)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-red-600" />
              Rejected (NG)
            </span>
          </div>
        </div>

        {metrics.trend.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm font-medium text-slate-900">
              No inspection telemetry recorded yet
            </p>
            <p className="mt-1 max-w-md text-xs text-slate-500">
              Run your first webcam scan, upload a product label, or generate a synthetic test label
              in Live Inspection to populate trend analytics.
            </p>
            <motion.button
              type="button"
              {...BUTTON_SPRING_PROPS}
              onClick={() => onNavigate('live')}
              className="navy-glass-btn mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium whitespace-nowrap"
            >
              <Camera className="h-3.5 w-3.5" />
              Open Live Inspection
            </motion.button>
          </div>
        ) : (
          <div className="mt-5">
            <div className="relative h-56 w-full">
              <svg
                viewBox="0 0 720 200"
                className="h-full w-full overflow-visible"
                role="img"
                aria-label="Inspection trend bar chart"
              >
                {/* Horizontal gridlines */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                  const y = 170 - ratio * 145;
                  const tickVal = Math.round(ratio * maxBucket);
                  return (
                    <g key={ratio}>
                      <line
                        x1={38}
                        y1={y}
                        x2={708}
                        y2={y}
                        stroke="#e2e8f0"
                        strokeWidth={1}
                      />
                      <text
                        x={30}
                        y={y + 4}
                        textAnchor="end"
                        className="fill-slate-400 font-mono text-[10px]"
                      >
                        {tickVal}
                      </text>
                    </g>
                  );
                })}

                {metrics.trend.map((bucket, idx) => {
                  const count = metrics.trend.length;
                  const slotWidth = (708 - 46) / count;
                  const barWidth = Math.min(34, Math.max(12, slotWidth * 0.52));
                  const cx = 46 + idx * slotWidth + slotWidth / 2;
                  const okH = (bucket.okCount / maxBucket) * 145;
                  const ngH = (bucket.ngCount / maxBucket) * 145;
                  const totalH = okH + ngH;
                  const isHovered = hoveredIdx === idx;

                  return (
                    <g
                      key={bucket.label}
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={cx - slotWidth / 2}
                        y={20}
                        width={slotWidth}
                        height={155}
                        fill={isHovered ? 'rgba(241, 245, 249, 0.8)' : 'transparent'}
                        rx={4}
                      />
                      {/* OK segment (bottom) */}
                      {bucket.okCount > 0 && (
                        <motion.rect
                          initial={{ opacity: 0, scaleY: 0 }}
                          animate={{ opacity: 1, scaleY: 1 }}
                          transition={{ ...SPRING_INTERACTIVE, delay: idx * 0.03 }}
                          style={{ transformOrigin: `${cx}px 170px` }}
                          x={cx - barWidth / 2}
                          y={170 - okH}
                          width={barWidth}
                          height={okH}
                          fill="#16a34a"
                          rx={bucket.ngCount === 0 ? 3 : 0}
                        />
                      )}
                      {/* NG segment (stacked top) */}
                      {bucket.ngCount > 0 && (
                        <motion.rect
                          initial={{ opacity: 0, scaleY: 0 }}
                          animate={{ opacity: 1, scaleY: 1 }}
                          transition={{ ...SPRING_INTERACTIVE, delay: idx * 0.03 + 0.04 }}
                          style={{ transformOrigin: `${cx}px 170px` }}
                          x={cx - barWidth / 2}
                          y={170 - totalH}
                          width={barWidth}
                          height={ngH}
                          fill="#dc2626"
                          rx={3}
                        />
                      )}
                      <text
                        x={cx}
                        y={188}
                        textAnchor="middle"
                        className="fill-slate-500 font-mono text-[10px]"
                      >
                        {bucket.label.split(' · ')[0]}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {hoveredIdx !== null && metrics.trend[hoveredIdx] && (
                <div className="pointer-events-none absolute right-3 top-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                  <p className="font-medium text-slate-900">{metrics.trend[hoveredIdx].label}</p>
                  <p className="mt-0.5 font-mono text-slate-600 tabular-nums">
                    OK: {metrics.trend[hoveredIdx].okCount} · NG: {metrics.trend[hoveredIdx].ngCount}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </motion.section>

      {/* Recent Inspections Table */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_PANEL, delay: 0.18 }}
        className="glass-panel rounded-xl overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-950/12 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-[#0b1736]">Recent Inspections</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Latest label verification events saved to the station database
            </p>
          </div>
          <div className="flex items-center gap-2">
            <motion.a
              {...BUTTON_SPRING_PROPS}
              href="/api/inspections/export/csv"
              className="white-glass-btn inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Export CSV
            </motion.a>
            <motion.button
              type="button"
              {...BUTTON_SPRING_PROPS}
              onClick={() => onNavigate('history')}
              className="white-glass-btn inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
            >
              View All
              <ArrowRight className="h-3.5 w-3.5" />
            </motion.button>
          </div>
        </div>

        {loading ? (
          <div className="divide-y divide-blue-950/10 px-6 py-2">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex items-center justify-between py-3">
                <div className="h-4 w-48 animate-pulse rounded bg-blue-950/10" />
                <div className="h-4 w-24 animate-pulse rounded bg-blue-950/10" />
              </div>
            ))}
          </div>
        ) : recentInspections.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-slate-600">No inspection runs recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-blue-950/12 bg-blue-950/[0.04] text-xs font-medium text-slate-600">
                  <th className="px-6 py-2.5">Timestamp</th>
                  <th className="px-4 py-2.5">Template</th>
                  <th className="px-4 py-2.5">QR Payload</th>
                  <th className="px-4 py-2.5 text-right">Appearance</th>
                  <th className="px-4 py-2.5 text-right">Cycle</th>
                  <th className="px-6 py-2.5 text-right">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-950/10">
                {recentInspections.slice(0, 6).map((row, idx) => (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: idx * 0.025 }}
                    onClick={() => onSelectInspection(row)}
                    className="cursor-pointer transition-colors hover:bg-white/80"
                  >
                    <td className="px-6 py-2.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-medium text-slate-900 whitespace-nowrap">
                      {row.templateName}
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-2.5 font-mono text-xs text-slate-700">
                      {row.qrDetected ? row.qrPayload : 'Not detected'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums">
                      {row.appearanceScore}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {row.cycleTimeMs} ms
                    </td>
                    <td className="px-6 py-2.5 text-right font-mono text-xs font-semibold whitespace-nowrap">
                      <span className={row.verdict === 'OK' ? 'text-emerald-700' : 'text-red-700'}>
                        {row.verdict}
                      </span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.section>
    </div>
  );
}
