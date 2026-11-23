import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import type { GoldenTemplate } from '../types/vision.ts';
import {
  fileToCompressedDataUrl,
  generateSampleLabelDataUrl,
  scanDataUrlForQr,
} from '../utils/qrScanner.ts';
import { BUTTON_SPRING_PROPS, SPRING_PANEL } from '../utils/motionPresets.ts';

interface GoldenTemplatesViewProps {
  templates: GoldenTemplate[];
  onTemplatesChange?: (updater: (prev: GoldenTemplate[]) => GoldenTemplate[]) => void;
  onRefresh: () => Promise<void>;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

export function GoldenTemplatesView({
  templates,
  onTemplatesChange,
  onRefresh,
  onNotify,
}: GoldenTemplatesViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [expectedQrPattern, setExpectedQrPattern] = useState('');
  const [expectedOcrText, setExpectedOcrText] = useState('');
  const [appearanceCriteria, setAppearanceCriteria] = useState(
    'Clean label edges, crisp dark ink contrast, no smudges, intact QR quiet zone.'
  );
  const [minSimilarityScore, setMinSimilarityScore] = useState(80);
  const [referenceImageData, setReferenceImageData] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setSku('');
    setExpectedQrPattern('');
    setExpectedOcrText('');
    setAppearanceCriteria(
      'Clean label edges, crisp dark ink contrast, no smudges, intact QR quiet zone.'
    );
    setMinSimilarityScore(80);
    setReferenceImageData(null);
    setIsActive(true);
  };

  const loadForEdit = (tpl: GoldenTemplate) => {
    setEditingId(tpl.id);
    setName(tpl.name);
    setSku(tpl.sku);
    setExpectedQrPattern(tpl.expectedQrPattern);
    setExpectedOcrText(tpl.expectedOcrText);
    setAppearanceCriteria(tpl.appearanceCriteria);
    setMinSimilarityScore(tpl.minSimilarityScore);
    setReferenceImageData(tpl.referenceImageData);
    setIsActive(tpl.isActive);
  };

  const handleUploadReference = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToCompressedDataUrl(file, 1024, 0.88);
      setReferenceImageData(dataUrl);
      const qr = await scanDataUrlForQr(dataUrl);
      if (qr.detected && !expectedQrPattern.trim()) {
        setExpectedQrPattern(qr.payload);
      }
      onNotify('Reference image loaded.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load image.', 'error');
    }
    e.target.value = '';
  };

  const handleLoadStarterTemplate = () => {
    const sampleDataUrl = generateSampleLabelDataUrl(
      'nominal',
      'VQG-2040-LOT2611-0042',
      'SKU: VQG-2040-REV2'
    );
    setEditingId(null);
    setName('Industrial Part Label — VQG-2040');
    setSku('VQG-2040-REV2');
    setExpectedQrPattern('VQG-2040');
    setExpectedOcrText(
      'APEX INDUSTRIAL · PART LABEL\nSKU: VQG-2040-REV2\nLOT: 2026-11A\nBATCH: B-4092-OK\nROHS COMPLIANT · CE'
    );
    setAppearanceCriteria(
      'Crisp dark typography, legible Lot/Batch lines, clean white label borders, zero ink smudges or QR scratches.'
    );
    setMinSimilarityScore(80);
    setReferenceImageData(sampleDataUrl);
    setIsActive(true);
    onNotify('Starter golden template fields populated. Click Save Template to store.');
  };

  const handleExtractFromReference = async () => {
    if (!referenceImageData) {
      onNotify('Upload or load a reference image first.', 'error');
      return;
    }
    setExtracting(true);
    try {
      const res = await fetch('/api/templates/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl: referenceImageData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Extraction failed.');
      if (data.ocrText) setExpectedOcrText(data.ocrText);
      if (data.suggestedSku && !sku.trim()) setSku(data.suggestedSku);
      if (data.suggestedAppearanceCriteria) {
        setAppearanceCriteria(data.suggestedAppearanceCriteria);
      }
      onNotify('OCR text and visual criteria extracted from reference label.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Extraction failed.', 'error');
    } finally {
      setExtracting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !sku.trim()) {
      onNotify('Template name and SKU are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const url = editingId ? `/api/templates/${editingId}` : '/api/templates';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim(),
          expectedQrPattern: expectedQrPattern.trim(),
          expectedOcrText: expectedOcrText.trim(),
          appearanceCriteria: appearanceCriteria.trim(),
          minSimilarityScore,
          referenceImageData,
          isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save template.');
      const savedTpl = data.template as GoldenTemplate | undefined;
      if (savedTpl && onTemplatesChange) {
        onTemplatesChange((prev) => {
          const base = savedTpl.isActive
            ? prev.map((item) => ({ ...item, isActive: false }))
            : prev;
          const exists = base.some((item) => item.id === savedTpl.id);
          return exists
            ? base.map((item) => (item.id === savedTpl.id ? savedTpl : item))
            : [savedTpl, ...base];
        });
      }
      await onRefresh();
      onNotify(editingId ? 'Golden template updated.' : 'Golden template saved.');
      resetForm();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Save failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (id: string) => {
    try {
      const res = await fetch(`/api/templates/${id}/activate`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to activate template.');
      if (onTemplatesChange) {
        onTemplatesChange((prev) =>
          prev.map((item) => ({ ...item, isActive: item.id === id }))
        );
      }
      await onRefresh();
      onNotify('Active golden template updated.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Activation failed.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete template.');
      if (editingId === id) resetForm();
      if (onTemplatesChange) {
        onTemplatesChange((prev) => prev.filter((item) => item.id !== id));
      }
      await onRefresh();
      onNotify('Template deleted.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
      {/* Left: Saved Golden Templates */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_PANEL}
        className="glass-panel lg:col-span-7 rounded-xl overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-950/12 px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-[#0b1736]">Golden Sample Templates</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Reference standards used for QR matching, OCR validation, and visual similarity
            </p>
          </div>
          <motion.button
            type="button"
            {...BUTTON_SPRING_PROPS}
            onClick={handleLoadStarterTemplate}
            className="white-glass-btn inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            Load Starter Sample
          </motion.button>
        </div>

        {templates.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-[#0b1736]">No golden templates defined</p>
            <p className="mt-1 text-xs text-slate-500">
              Create a golden reference template on the right or load the starter industrial sample
              to enable template comparison.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-blue-950/10">
            <AnimatePresence initial={false}>
              {templates.map((tpl, idx) => (
                <motion.div
                  key={tpl.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, delay: idx * 0.03 }}
                  className="flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex gap-4 min-w-0">
                    <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-blue-950/15 bg-white flex items-center justify-center">
                      {tpl.referenceImageData ? (
                        <img
                          src={tpl.referenceImageData}
                          alt={tpl.name}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="text-[11px] text-slate-400">No img</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-bold text-[#0b1736]">{tpl.name}</h3>
                        {tpl.isActive && (
                          <span className="font-mono text-xs font-semibold text-emerald-700">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">
                        SKU: {tpl.sku} · Similarity Threshold: {tpl.minSimilarityScore}%
                        {tpl.expectedQrPattern ? ` · QR: ${tpl.expectedQrPattern}` : ''}
                      </p>
                      {tpl.expectedOcrText && (
                        <p className="mt-1.5 line-clamp-2 text-xs text-slate-600">
                          OCR: {tpl.expectedOcrText.replace(/\n/g, ' · ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!tpl.isActive && (
                      <motion.button
                        type="button"
                        {...BUTTON_SPRING_PROPS}
                        onClick={() => handleActivate(tpl.id)}
                        className="white-glass-btn inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Set Active
                      </motion.button>
                    )}
                    <motion.button
                      type="button"
                      {...BUTTON_SPRING_PROPS}
                      onClick={() => loadForEdit(tpl)}
                      className="white-glass-btn rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap"
                    >
                      Edit
                    </motion.button>
                    <motion.button
                      type="button"
                      {...BUTTON_SPRING_PROPS}
                      onClick={() => handleDelete(tpl.id)}
                      aria-label={`Delete ${tpl.name}`}
                      className="white-glass-btn inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </motion.button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </motion.section>

      {/* Right: Create / Edit Template Form */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_PANEL, delay: 0.05 }}
        className="glass-panel lg:col-span-5 rounded-xl p-6"
      >
        <div className="flex items-center justify-between border-b border-blue-950/12 pb-4">
          <h2 className="text-base font-bold text-[#0b1736]">
            {editingId ? 'Edit Golden Template' : 'New Golden Template'}
          </h2>
          {editingId && (
            <motion.button
              type="button"
              {...BUTTON_SPRING_PROPS}
              onClick={resetForm}
              className="text-xs font-medium text-slate-600 hover:text-[#0b1736]"
            >
              Cancel Edit
            </motion.button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Template Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Controller Label A1"
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">SKU / Part Code</label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="e.g. VQG-2040-REV2"
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Expected QR Pattern (exact, substring, or /regex/)
            </label>
            <input
              type="text"
              value={expectedQrPattern}
              onChange={(e) => setExpectedQrPattern(e.target.value)}
              placeholder="e.g. VQG-2040 or /^VQG-\d{4}/"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-slate-900"
            />
          </div>

          {/* Reference Image + AI Extract */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-slate-700">
                Golden Reference Image
              </label>
              <motion.button
                type="button"
                {...BUTTON_SPRING_PROPS}
                disabled={!referenceImageData || extracting}
                onClick={handleExtractFromReference}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-900 hover:text-blue-700 disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {extracting ? 'Extracting...' : 'Auto-Extract OCR'}
              </motion.button>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <motion.label
                {...BUTTON_SPRING_PROPS}
                className="white-glass-btn inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload Golden Image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleUploadReference}
                  className="hidden"
                />
              </motion.label>
              {referenceImageData && (
                <motion.button
                  type="button"
                  {...BUTTON_SPRING_PROPS}
                  onClick={() => setReferenceImageData(null)}
                  className="text-xs text-slate-500 hover:text-red-700"
                >
                  Remove image
                </motion.button>
              )}
            </div>
            {referenceImageData && (
              <div className="mt-2 aspect-[16/9] overflow-hidden rounded-lg border border-blue-950/15 bg-white flex items-center justify-center">
                <img
                  src={referenceImageData}
                  alt="Golden sample preview"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-contain"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Expected OCR Text Lines
            </label>
            <textarea
              rows={4}
              value={expectedOcrText}
              onChange={(e) => setExpectedOcrText(e.target.value)}
              placeholder="Enter required printed text lines..."
              className="mt-1 w-full rounded-lg border border-blue-950/15 bg-white/90 px-3 py-2 font-mono text-xs text-[#0b1736] outline-none focus:border-blue-800"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Visual Appearance Criteria
            </label>
            <textarea
              rows={2}
              value={appearanceCriteria}
              onChange={(e) => setAppearanceCriteria(e.target.value)}
              className="mt-1 w-full rounded-lg border border-blue-950/15 bg-white/90 px-3 py-2 text-xs text-[#0b1736] outline-none focus:border-blue-800"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-700">
                Minimum Similarity Score ({minSimilarityScore}%)
              </label>
              <input
                type="range"
                min={50}
                max={98}
                value={minSimilarityScore}
                onChange={(e) => setMinSimilarityScore(Number(e.target.value))}
                className="mt-1.5 w-full accent-[#0b1736]"
              />
            </div>

            <label className="mt-4 flex items-center gap-2 text-xs font-medium text-slate-700 whitespace-nowrap">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-blue-950/25 accent-[#0b1736]"
              />
              Set as Active
            </label>
          </div>

          <motion.button
            type="submit"
            {...BUTTON_SPRING_PROPS}
            disabled={saving}
            className="navy-glass-btn w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving Template...' : editingId ? 'Update Golden Template' : 'Save Golden Template'}
          </motion.button>
        </form>
      </motion.section>
    </div>
  );
}
