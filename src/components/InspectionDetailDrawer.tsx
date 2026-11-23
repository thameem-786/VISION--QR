import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Trash2, X, XCircle } from 'lucide-react';
import type { GoldenTemplate, InspectionRecord } from '../types/vision.ts';

interface InspectionDetailDrawerProps {
  record: InspectionRecord | null;
  templates: GoldenTemplate[];
  onClose: () => void;
  onDelete?: (id: string) => void;
}

export function InspectionDetailDrawer({
  record,
  templates,
  onClose,
  onDelete,
}: InspectionDetailDrawerProps) {
  const matchedTemplate =
    record && record.templateId
      ? templates.find((t) => t.id === record.templateId) ?? null
      : null;

  return (
    <AnimatePresence>
      {record && (
        <motion.div
          key={record.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label="Inspection details"
        >
          <div className="flex-1" onClick={onClose} />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="relative flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white"
          >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="truncate text-lg font-semibold text-slate-900">
                Inspection Record
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold ${
                  record.verdict === 'OK' ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {record.verdict === 'OK' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {record.verdict === 'OK' ? 'Accepted (OK)' : 'Rejected (NG)'}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">
              {record.id} · {new Date(record.createdAt).toLocaleString()} · {record.cycleTimeMs} ms
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(record.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail drawer"
              className="rounded-lg border border-slate-200 p-2 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Summary */}
          <div className="border-b border-slate-200 pb-5">
            <p className="text-xs font-medium text-slate-500">Verdict Summary</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-900">{record.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>Template: {record.templateName}</span>
              <span aria-hidden="true">·</span>
              <span>Source: {record.sourceType}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                Appearance Score: {record.appearanceScore}/100
              </span>
            </div>
          </div>

          {/* Visual Side-by-Side */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">Captured Label</p>
              <div className="aspect-[16/10] overflow-hidden rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center">
                {record.imageData ? (
                  <img
                    src={record.imageData}
                    alt="Inspected label frame"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-slate-400">No image stored</span>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">Golden Reference</p>
              <div className="aspect-[16/10] overflow-hidden rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
                {matchedTemplate?.referenceImageData ? (
                  <img
                    src={matchedTemplate.referenceImageData}
                    alt="Golden reference sample"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="px-4 text-center text-xs text-slate-400">
                    No golden reference image attached
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* QR & OCR Verification */}
          <div className="grid grid-cols-1 gap-5 border-t border-slate-200 pt-5 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">QR Verification</h3>
                <span
                  className={`font-mono text-xs font-semibold ${
                    record.qrMatch ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {record.qrMatch ? 'PASS' : 'FAIL'}
                </span>
              </div>
              <p className="mt-2 font-mono text-xs text-slate-800 break-all bg-slate-50 border border-slate-200 rounded-md p-2.5">
                {record.qrDetected ? record.qrPayload : 'No QR code decoded'}
              </p>
              <p className="mt-1.5 text-xs text-slate-500">{record.qrNote}</p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">OCR Text Check</h3>
                <span
                  className={`font-mono text-xs font-semibold ${
                    record.ocrMatch ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {record.ocrMatch ? 'PASS' : 'FAIL'}
                </span>
              </div>
              <pre className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs text-slate-800">
                {record.ocrExtractedText || 'No legible text detected'}
              </pre>
              {record.ocrMissingItems.length > 0 && (
                <p className="mt-1.5 text-xs text-red-700">
                  Discrepancies: {record.ocrMissingItems.join(', ')}
                </p>
              )}
            </div>
          </div>

          {/* Appearance & Defects */}
          <div className="border-t border-slate-200 pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Appearance & Defect Findings
              </h3>
              <span
                className={`font-mono text-xs font-semibold tabular-nums ${
                  record.appearancePass ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {record.appearanceScore}/100 · {record.appearancePass ? 'PASS' : 'FAIL'}
              </span>
            </div>

            {record.defects.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">
                No surface, print, or structural label defects detected.
              </p>
            ) : (
              <div className="mt-3 divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {record.defects.map((defect, idx) => (
                  <div key={`${defect.type}-${idx}`} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">{defect.type}</span>
                      <span
                        className={`font-mono text-xs font-semibold uppercase ${
                          defect.severity === 'high'
                            ? 'text-red-700'
                            : defect.severity === 'medium'
                              ? 'text-amber-700'
                              : 'text-slate-600'
                        }`}
                      >
                        {defect.severity} · {defect.location}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{defect.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
