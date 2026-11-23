import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { FileSpreadsheet, Search, Trash2 } from 'lucide-react';
import type { InspectionRecord, ViewTab } from '../types/vision.ts';
import { BUTTON_SPRING_PROPS, SPRING_PANEL } from '../utils/motionPresets.ts';

interface InspectionHistoryViewProps {
  inspections: InspectionRecord[];
  loading: boolean;
  onSelectInspection: (record: InspectionRecord) => void;
  onDeleteInspection: (id: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  onNavigate: (tab: ViewTab) => void;
}

export function InspectionHistoryView({
  inspections,
  loading,
  onSelectInspection,
  onDeleteInspection,
  onClearAll,
  onNavigate,
}: InspectionHistoryViewProps) {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<'ALL' | 'OK' | 'NG'>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    return inspections.filter((item) => {
      if (verdictFilter !== 'ALL' && item.verdict !== verdictFilter) return false;
      if (sourceFilter !== 'ALL' && item.sourceType !== sourceFilter) return false;
      if (fromTime !== null || toTime !== null) {
        const createdMs = new Date(item.createdAt).getTime();
        if (fromTime !== null && createdMs < fromTime) return false;
        if (toTime !== null && createdMs > toTime) return false;
      }
      if (!q) return true;
      return (
        item.qrPayload.toLowerCase().includes(q) ||
        item.templateName.toLowerCase().includes(q) ||
        item.ocrExtractedText.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q)
      );
    });
  }, [inspections, search, dateFrom, dateTo, verdictFilter, sourceFilter]);

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (verdictFilter !== 'ALL') params.set('verdict', verdictFilter);
    if (sourceFilter !== 'ALL') params.set('source', sourceFilter);
    if (search.trim()) params.set('search', search.trim());
    if (dateFrom) params.set('from', new Date(`${dateFrom}T00:00:00`).toISOString());
    if (dateTo) params.set('to', new Date(`${dateTo}T23:59:59.999`).toISOString());
    const qs = params.toString();
    return `/api/inspections/export/csv${qs ? `?${qs}` : ''}`;
  }, [verdictFilter, sourceFilter, search, dateFrom, dateTo]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING_PANEL}
      className="glass-panel rounded-xl overflow-hidden"
    >
      {/* Filter & Export Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-blue-950/12 px-6 py-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search QR, template, OCR text..."
              className="w-full rounded-lg border border-blue-950/15 bg-white/90 py-1.5 pl-8 pr-3 text-xs text-[#0b1736] outline-none focus:border-blue-800"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <label className="text-[11px] font-medium text-slate-500" htmlFor="history-date-from">
              From
            </label>
            <input
              id="history-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="From date"
              className="rounded-lg border border-blue-950/15 bg-white/90 px-2.5 py-1.5 font-mono text-xs text-[#0b1736] outline-none focus:border-blue-800"
            />
            <label className="text-[11px] font-medium text-slate-500" htmlFor="history-date-to">
              To
            </label>
            <input
              id="history-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="To date"
              className="rounded-lg border border-blue-950/15 bg-white/90 px-2.5 py-1.5 font-mono text-xs text-[#0b1736] outline-none focus:border-blue-800"
            />
            {(dateFrom || dateTo) && (
              <motion.button
                type="button"
                {...BUTTON_SPRING_PROPS}
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="white-glass-btn rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-600 whitespace-nowrap"
              >
                Reset dates
              </motion.button>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-blue-950/[0.06] p-1">
            {(['ALL', 'OK', 'NG'] as const).map((v) => (
              <motion.button
                key={v}
                type="button"
                {...BUTTON_SPRING_PROPS}
                onClick={() => setVerdictFilter(v)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  verdictFilter === v
                    ? 'navy-glass-btn text-white'
                    : 'text-slate-700 hover:text-blue-900'
                }`}
              >
                {v === 'ALL' ? 'All' : v}
              </motion.button>
            ))}
          </div>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-blue-950/15 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-blue-800"
          >
            <option value="ALL">All Sources</option>
            <option value="webcam">Webcam</option>
            <option value="upload">Single Upload</option>
            <option value="batch">Batch</option>
            <option value="esp32_trigger">ESP32 Trigger</option>
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <motion.a
            {...BUTTON_SPRING_PROPS}
            href={exportUrl}
            className="white-glass-btn inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Export CSV
          </motion.a>

          {inspections.length > 0 && !confirmClear && (
            <motion.button
              type="button"
              {...BUTTON_SPRING_PROPS}
              onClick={() => setConfirmClear(true)}
              className="white-glass-btn inline-flex items-center gap-1.5 rounded-lg border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear Log
            </motion.button>
          )}

          {confirmClear && (
            <div className="flex items-center gap-1.5">
              <motion.button
                type="button"
                {...BUTTON_SPRING_PROPS}
                onClick={async () => {
                  await onClearAll();
                  setConfirmClear(false);
                }}
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 whitespace-nowrap"
              >
                Confirm Clear
              </motion.button>
              <motion.button
                type="button"
                {...BUTTON_SPRING_PROPS}
                onClick={() => setConfirmClear(false)}
                className="white-glass-btn rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
              >
                Cancel
              </motion.button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="divide-y divide-blue-950/10 px-6 py-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between py-3">
              <div className="h-4 w-56 animate-pulse rounded bg-blue-950/10" />
              <div className="h-4 w-28 animate-pulse rounded bg-blue-950/10" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <p className="text-sm font-medium text-[#0b1736]">
            {inspections.length === 0
              ? 'No inspection history recorded'
              : 'No records match your filters'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {inspections.length === 0
              ? 'Completed inspections from Live Inspection or Batch Upload are persisted automatically.'
              : 'Try clearing the search query or switching the verdict filter.'}
          </p>
          {inspections.length === 0 && (
            <motion.button
              type="button"
              {...BUTTON_SPRING_PROPS}
              onClick={() => onNavigate('live')}
              className="navy-glass-btn mt-4 rounded-lg px-4 py-2 text-xs font-medium"
            >
              Start Inspecting
            </motion.button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-blue-950/12 bg-blue-950/[0.04] text-xs font-medium text-slate-600">
                <th className="px-6 py-2.5">Preview</th>
                <th className="px-4 py-2.5">Date & Time</th>
                <th className="px-4 py-2.5">Template</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5">QR Payload</th>
                <th className="px-4 py-2.5 text-right">OCR</th>
                <th className="px-4 py-2.5 text-right">Score</th>
                <th className="px-4 py-2.5 text-right">Cycle</th>
                <th className="px-4 py-2.5 text-right">Verdict</th>
                <th className="px-6 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-950/10">
              {filtered.map((row, idx) => (
                <motion.tr
                  key={row.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16, delay: Math.min(idx * 0.015, 0.2) }}
                  onClick={() => onSelectInspection(row)}
                  className="cursor-pointer transition-colors hover:bg-white/80"
                >
                  <td className="px-6 py-2">
                    <div className="flex h-9 w-14 items-center justify-center overflow-hidden rounded border border-blue-950/15 bg-white">
                      {row.imageData ? (
                        <img
                          src={row.imageData}
                          alt={`${row.templateName} capture`}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="text-[10px] text-slate-400">No img</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                    {new Date(row.createdAt).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-medium text-slate-900 whitespace-nowrap">
                    {row.templateName}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">
                    {row.sourceType}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-xs text-slate-700">
                    {row.qrDetected ? row.qrPayload : 'Not detected'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap">
                    <span className={row.ocrMatch ? 'text-emerald-700' : 'text-red-700'}>
                      {row.ocrMatch ? 'PASS' : 'FAIL'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums">
                    {row.appearanceScore}%
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                    {row.cycleTimeMs} ms
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold whitespace-nowrap">
                    <span className={row.verdict === 'OK' ? 'text-emerald-700' : 'text-red-700'}>
                      {row.verdict}
                    </span>
                  </td>
                  <td
                    className="px-6 py-2.5 text-right whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <motion.button
                      type="button"
                      {...BUTTON_SPRING_PROPS}
                      onClick={() => onDeleteInspection(row.id)}
                      aria-label={`Delete record ${row.id}`}
                      className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </motion.button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.section>
  );
}
