import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Check, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import type { GoldenTemplate } from '../types/vision.ts';
import {
  fileToCompressedDataUrl,
  generateSampleLabelDataUrl,
  scanDataUrlForQr,
} from '../utils/qrScanner.ts';

interface GoldenTemplatesViewProps {
  templates: GoldenTemplate[];
  onRefresh: () => Promise<void>;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

export function GoldenTemplatesView({
  templates,
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
      await onRefresh();
      onNotify('Template deleted.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
      {/* Left: Saved Golden Templates */}
      <section className="lg:col-span-7 rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Golden Sample Templates</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Reference standards used for QR matching, OCR validation, and visual similarity
            </p>
          </div>
          <button
            type="button"
            onClick={handleLoadStarterTemplate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            Load Starter Sample
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-900">No golden templates defined</p>
            <p className="mt-1 text-xs text-slate-500">
              Create a golden reference template on the right or load the starter industrial sample
              to enable template comparison.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex gap-4 min-w-0">
                  <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
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
                      <h3 className="truncate text-sm font-semibold text-slate-900">{tpl.name}</h3>
                      {tpl.isActive && (
                        <span className="font-mono text-xs font-semibold text-emerald-700">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">
                      SKU: {tpl.sku} · Min Score: {tpl.minSimilarityScore}%
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
                    <button
                      type="button"
                      onClick={() => handleActivate(tpl.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Set Active
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => loadForEdit(tpl)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(tpl.id)}
                    aria-label={`Delete ${tpl.name}`}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Right: Create / Edit Template Form */}
      <section className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h2 className="text-base font-semibold text-slate-900">
            {editingId ? 'Edit Golden Template' : 'New Golden Template'}
          </h2>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              Cancel Edit
            </button>
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
              <button
                type="button"
                disabled={!referenceImageData || extracting}
                onClick={handleExtractFromReference}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {extracting ? 'Extracting...' : 'Auto-Extract OCR'}
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap">
                <Upload className="h-3.5 w-3.5" />
                Upload Golden Image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleUploadReference}
                  className="hidden"
                />
              </label>
              {referenceImageData && (
                <button
                  type="button"
                  onClick={() => setReferenceImageData(null)}
                  className="text-xs text-slate-500 hover:text-red-700"
                >
                  Remove image
                </button>
              )}
            </div>
            {referenceImageData && (
              <div className="mt-2 aspect-[16/9] overflow-hidden rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
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
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-slate-900"
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
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 outline-none focus:border-slate-900"
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
                className="mt-1.5 w-full accent-slate-900"
              />
            </div>

            <label className="mt-4 flex items-center gap-2 text-xs font-medium text-slate-700 whitespace-nowrap">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-slate-900"
              />
              Set as Active
            </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving Template...' : editingId ? 'Update Golden Template' : 'Save Golden Template'}
          </button>
        </form>
      </section>
    </div>
  );
}
