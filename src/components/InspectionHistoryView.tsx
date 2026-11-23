import { useMemo, useState } from 'react';
import { FileSpreadsheet, Search, Trash2 } from 'lucide-react';
import type { InspectionRecord, ViewTab } from '../types/vision.ts';

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
  const [verdictFilter, setVerdictFilter] = useState<'ALL' | 'OK' | 'NG'>('ALL');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inspections.filter((item) => {
      if (verdictFilter !== 'ALL' && item.verdict !== verdictFilter) return false;
      if (sourceFilter !== 'ALL' && item.sourceType !== sourceFilter) return false;
      if (!q) return true;
      return (
        item.qrPayload.toLowerCase().includes(q) ||
        item.templateName.toLowerCase().includes(q) ||
        item.ocrExtractedText.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q)
      );
    });
  }, [inspections, search, verdictFilter, sourceFilter]);

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (verdictFilter !== 'ALL') params.set('verdict', verdictFilter);
    if (sourceFilter !== 'ALL') params.set('source', sourceFilter);
    if (search.trim()) params.set('search', search.trim());
    const qs = params.toString();
    return `/api/inspections/export/csv${qs ? `?${qs}` : ''}`;
  }, [verdictFilter, sourceFilter, search]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      {/* Filter & Export Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search QR, template, OCR text..."
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 outline-none focus:border-slate-900"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(['ALL', 'OK', 'NG'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVerdictFilter(v)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  verdictFilter === v
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {v === 'ALL' ? 'All' : v}
              </button>
            ))}
          </div>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-slate-900"
          >
            <option value="ALL">All Sources</option>
            <option value="webcam">Webcam</option>
            <option value="upload">Single Upload</option>
            <option value="batch">Batch</option>
            <option value="esp32_trigger">ESP32 Trigger</option>
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href={exportUrl}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Export CSV
          </a>

          {inspections.length > 0 && !confirmClear && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear Log
            </button>
          )}

          {confirmClear && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={async () => {
                  await onClearAll();
                  setConfirmClear(false);
                }}
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 whitespace-nowrap"
              >
                Confirm Clear
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="divide-y divide-slate-100 px-6 py-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between py-3">
              <div className="h-4 w-56 animate-pulse rounded bg-slate-100" />
              <div className="h-4 w-28 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <p className="text-sm font-medium text-slate-900">
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
            <button
              type="button"
              onClick={() => onNavigate('live')}
              className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              Start Inspecting
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="px-6 py-2.5">Date & Time</th>
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
            <tbody className="divide-y divide-slate-100">
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onSelectInspection(row)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="px-6 py-2.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
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
                    <button
                      type="button"
                      onClick={() => onDeleteInspection(row.id)}
                      aria-label={`Delete record ${row.id}`}
                      className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
