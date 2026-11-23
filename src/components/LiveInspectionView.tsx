import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  FileSpreadsheet,
  Layers,
  Play,
  ScanLine,
  Upload,
  XCircle,
} from 'lucide-react';
import { BubbleField } from './BubbleField.tsx';
import type {
  GoldenTemplate,
  InspectionRecord,
  InspectionSource,
  ViewTab,
} from '../types/vision.ts';
import {
  fileToCompressedDataUrl,
  generateSampleLabelDataUrl,
  scanDataUrlForQr,
  scanImageDataForQr,
} from '../utils/qrScanner.ts';
import type { QrScanResult, SampleLabelVariant } from '../utils/qrScanner.ts';

interface BatchItem {
  id: string;
  name: string;
  dataUrl: string;
  status: 'queued' | 'running' | 'done' | 'error';
  record?: InspectionRecord;
  error?: string;
}

interface LiveInspectionViewProps {
  templates: GoldenTemplate[];
  cameraActive: boolean;
  onCameraActiveChange: (active: boolean) => void;
  pendingTriggerCounter: number;
  onInspectionComplete: (record: InspectionRecord) => Promise<void>;
  onNavigate: (tab: ViewTab) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

export function LiveInspectionView({
  templates,
  cameraActive,
  onCameraActiveChange,
  pendingTriggerCounter,
  onInspectionComplete,
  onNavigate,
  onNotify,
}: LiveInspectionViewProps) {
  const activeDefault = templates.find((t) => t.isActive)?.id ?? templates[0]?.id ?? '';
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(activeDefault);
  const [mode, setMode] = useState<'single' | 'batch'>('single');

  // Single / Webcam state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [liveQr, setLiveQr] = useState<QrScanResult>({
    detected: false,
    payload: '',
    location: null,
  });
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<InspectionSource>('upload');
  const [inspecting, setInspecting] = useState(false);
  const [latestResult, setLatestResult] = useState<InspectionRecord | null>(null);
  const [autoTriggerEnabled, setAutoTriggerEnabled] = useState(true);

  // Batch state
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);

  const lastHandledTriggerRef = useRef<number>(pendingTriggerCounter);

  useEffect(() => {
    if (!selectedTemplateId && templates.length > 0) {
      const active = templates.find((t) => t.isActive) ?? templates[0];
      setSelectedTemplateId(active.id);
    }
  }, [templates, selectedTemplateId]);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    onCameraActiveChange(false);
  }, [onCameraActiveChange]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera API is unavailable in this browser context.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setPreviewImageUrl(null);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      onCameraActiveChange(true);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to access camera. Check browser permissions.';
      setCameraError(msg);
      onCameraActiveChange(false);
    }
  }, [onCameraActiveChange]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Real-time QR scan loop while camera is live
  useEffect(() => {
    if (!cameraActive || mode !== 'single') return;
    let active = true;
    let lastScanTime = 0;

    const tick = (now: number) => {
      if (!active) return;
      const video = videoRef.current;
      const overlay = overlayCanvasRef.current;
      if (video && overlay && video.readyState >= 2 && video.videoWidth > 0) {
        if (now - lastScanTime >= 110) {
          lastScanTime = now;
          if (!captureCanvasRef.current) {
            captureCanvasRef.current = document.createElement('canvas');
          }
          const cap = captureCanvasRef.current;
          cap.width = video.videoWidth;
          cap.height = video.videoHeight;
          const capCtx = cap.getContext('2d', { willReadFrequently: true });
          if (capCtx) {
            capCtx.drawImage(video, 0, 0, cap.width, cap.height);
            const imgData = capCtx.getImageData(0, 0, cap.width, cap.height);
            const qr = scanImageDataForQr(imgData);
            setLiveQr(qr);

            overlay.width = cap.width;
            overlay.height = cap.height;
            const oCtx = overlay.getContext('2d');
            if (oCtx) {
              oCtx.clearRect(0, 0, overlay.width, overlay.height);
              if (qr.detected && qr.location) {
                oCtx.strokeStyle = '#16a34a';
                oCtx.lineWidth = 4;
                oCtx.beginPath();
                oCtx.moveTo(qr.location.topLeftCorner.x, qr.location.topLeftCorner.y);
                oCtx.lineTo(qr.location.topRightCorner.x, qr.location.topRightCorner.y);
                oCtx.lineTo(qr.location.bottomRightCorner.x, qr.location.bottomRightCorner.y);
                oCtx.lineTo(qr.location.bottomLeftCorner.x, qr.location.bottomLeftCorner.y);
                oCtx.closePath();
                oCtx.stroke();
              }
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [cameraActive, mode]);

  const executeInspection = useCallback(
    async (imageDataUrl: string, qrDetected: boolean, qrPayload: string, sourceType: InspectionSource) => {
      setInspecting(true);
      try {
        const res = await fetch('/api/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageDataUrl,
            qrDetected,
            qrPayload,
            templateId: selectedTemplateId || null,
            sourceType,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Inspection request failed.');
        }
        const record = data.inspection as InspectionRecord;
        setLatestResult(record);
        await onInspectionComplete(record);
        onNotify(
          `Inspection ${record.verdict} (${record.cycleTimeMs} ms) — ${
            record.qrDetected ? record.qrPayload : 'No QR'
          }`,
          record.verdict === 'OK' ? 'info' : 'error'
        );
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Inspection failed.', 'error');
      } finally {
        setInspecting(false);
      }
    },
    [selectedTemplateId, onInspectionComplete, onNotify]
  );

  const handleInspectCurrentFrame = useCallback(async () => {
    if (inspecting) return;
    if (cameraActive && videoRef.current && videoRef.current.videoWidth > 0) {
      const video = videoRef.current;
      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      const qr = await scanDataUrlForQr(dataUrl);
      setLiveQr(qr);
      await executeInspection(dataUrl, qr.detected, qr.payload, 'webcam');
      return;
    }

    if (previewImageUrl) {
      const qr = await scanDataUrlForQr(previewImageUrl);
      setLiveQr(qr);
      await executeInspection(previewImageUrl, qr.detected, qr.payload, previewSource);
      return;
    }

    onNotify('Start the camera, upload an image, or load a test sample first.', 'error');
  }, [cameraActive, inspecting, previewImageUrl, previewSource, executeInspection, onNotify]);

  // Listen for ESP32 / Test Trigger events
  useEffect(() => {
    if (pendingTriggerCounter > lastHandledTriggerRef.current) {
      lastHandledTriggerRef.current = pendingTriggerCounter;
      if (!autoTriggerEnabled || mode !== 'single') return;

      if (cameraActive && videoRef.current && videoRef.current.videoWidth > 0) {
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
          scanDataUrlForQr(dataUrl).then((qr) => {
            setLiveQr(qr);
            void executeInspection(dataUrl, qr.detected, qr.payload, 'esp32_trigger');
          });
        }
      } else if (previewImageUrl) {
        scanDataUrlForQr(previewImageUrl).then((qr) => {
          setLiveQr(qr);
          void executeInspection(previewImageUrl, qr.detected, qr.payload, 'esp32_trigger');
        });
      } else {
        onNotify('ESP32 trigger received, but no camera feed or label image is loaded.', 'error');
      }
    }
  }, [
    pendingTriggerCounter,
    autoTriggerEnabled,
    mode,
    cameraActive,
    previewImageUrl,
    executeInspection,
    onNotify,
  ]);

  const handleUploadSingle = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopCamera();
    try {
      const dataUrl = await fileToCompressedDataUrl(file, 1024, 0.88);
      setPreviewImageUrl(dataUrl);
      setPreviewSource('upload');
      const qr = await scanDataUrlForQr(dataUrl);
      setLiveQr(qr);
      onNotify(
        qr.detected ? `Loaded "${file.name}" · QR decoded: ${qr.payload}` : `Loaded "${file.name}" · No QR detected`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to load image.', 'error');
    }
    e.target.value = '';
  };

  const handleLoadSyntheticSample = async (variant: SampleLabelVariant) => {
    stopCamera();
    const activeTpl = templates.find((t) => t.id === selectedTemplateId);
    const qrPayload = activeTpl?.expectedQrPattern
      ? `${activeTpl.expectedQrPattern}-LOT2611-0042`
      : 'VQG-2040-LOT2611-0042';
    const dataUrl = generateSampleLabelDataUrl(
      variant,
      qrPayload,
      activeTpl ? `SKU: ${activeTpl.sku}` : undefined
    );
    setPreviewImageUrl(dataUrl);
    setPreviewSource('upload');
    const qr = await scanDataUrlForQr(dataUrl);
    setLiveQr(qr);
  };

  // Batch handlers
  const handleBatchFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const loaded: BatchItem[] = [];
    for (const file of files) {
      try {
        const dataUrl = await fileToCompressedDataUrl(file, 1024, 0.85);
        loaded.push({
          id: `${file.name}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          dataUrl,
          status: 'queued',
        });
      } catch {
        // skip unreadable file
      }
    }
    setBatchItems((prev) => [...prev, ...loaded]);
    e.target.value = '';
  };

  const handleLoadSampleBatch = () => {
    const activeTpl = templates.find((t) => t.id === selectedTemplateId);
    const qrPayload = activeTpl?.expectedQrPattern
      ? `${activeTpl.expectedQrPattern}-LOT2611-0042`
      : 'VQG-2040-LOT2611-0042';
    const skuText = activeTpl ? `SKU: ${activeTpl.sku}` : undefined;
    const variants: Array<{ name: string; variant: SampleLabelVariant }> = [
      { name: 'batch-01-nominal.jpg', variant: 'nominal' },
      { name: 'batch-02-smudge-defect.jpg', variant: 'smudge' },
      { name: 'batch-03-text-mismatch.jpg', variant: 'wrong_text' },
      { name: 'batch-04-damaged-qr.jpg', variant: 'damaged_qr' },
    ];
    setBatchItems(
      variants.map((v, i) => ({
        id: `sample-${i}-${Date.now()}`,
        name: v.name,
        dataUrl: generateSampleLabelDataUrl(v.variant, qrPayload, skuText),
        status: 'queued',
      }))
    );
  };

  const handleRunBatch = async () => {
    if (batchRunning || batchItems.length === 0) return;
    setBatchRunning(true);
    let okCount = 0;
    let ngCount = 0;

    for (const item of batchItems) {
      if (item.status === 'done') {
        if (item.record?.verdict === 'OK') okCount += 1;
        else ngCount += 1;
        continue;
      }

      setBatchItems((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, status: 'running' } : p))
      );

      try {
        const qr = await scanDataUrlForQr(item.dataUrl);
        const res = await fetch('/api/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageDataUrl: item.dataUrl,
            qrDetected: qr.detected,
            qrPayload: qr.payload,
            templateId: selectedTemplateId || null,
            sourceType: 'batch',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Batch item failed.');
        const record = data.inspection as InspectionRecord;
        if (record.verdict === 'OK') okCount += 1;
        else ngCount += 1;

        setBatchItems((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, status: 'done', record } : p))
        );
        await onInspectionComplete(record);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error';
        setBatchItems((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, status: 'error', error: msg } : p))
        );
      }
    }

    setBatchRunning(false);
    onNotify(`Batch finished: ${okCount} OK, ${ngCount} NG.`);
  };

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  return (
    <div className="space-y-5">
      {/* Toolbar: Mode Switcher + Golden Template Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'single'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Single / Webcam
            </button>
            <button
              type="button"
              onClick={() => {
                stopCamera();
                setMode('batch');
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'batch'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Batch Upload
            </button>
          </div>

          <label className="hidden sm:flex items-center gap-2 text-xs text-slate-600 whitespace-nowrap">
            <input
              type="checkbox"
              checked={autoTriggerEnabled}
              onChange={(e) => setAutoTriggerEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-900"
            />
            Auto-inspect on ESP32 trigger
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
            Golden Template:
          </label>
          <select
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 outline-none focus:border-slate-900"
          >
            <option value="">Ad-hoc (No Template)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.sku}){t.isActive ? ' · Active' : ''}
              </option>
            ))}
          </select>
          {templates.length === 0 && (
            <button
              type="button"
              onClick={() => onNavigate('templates')}
              className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              Create Template
            </button>
          )}
        </div>
      </div>

      {mode === 'single' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* Left: Camera / Image Viewport */}
          <section className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Optical Capture Viewport</h2>
                <p className="text-xs text-slate-500">
                  {selectedTemplate
                    ? `Comparing against ${selectedTemplate.name} (Min score ${selectedTemplate.minSimilarityScore}%)`
                    : 'Running standalone QR, OCR, and defect verification'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Start Camera
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap"
                  >
                    <CameraOff className="h-3.5 w-3.5" />
                    Stop Camera
                  </button>
                )}

                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap">
                  <Upload className="h-3.5 w-3.5" />
                  Upload Image
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleUploadSingle}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {cameraError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
                {cameraError} You can still upload label images or use the synthetic test samples below.
              </div>
            )}

            {/* Viewport Frame */}
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-950 flex items-center justify-center">
              <video
                ref={videoRef}
                muted
                playsInline
                className={`h-full w-full object-contain ${cameraActive ? 'block' : 'hidden'}`}
              />
              <canvas
                ref={overlayCanvasRef}
                className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${
                  cameraActive ? 'block' : 'hidden'
                }`}
              />

              {!cameraActive && previewImageUrl && (
                <img
                  src={previewImageUrl}
                  alt="Loaded inspection label"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-contain bg-slate-100"
                />
              )}

              {!cameraActive && !previewImageUrl && (
                <>
                  <BubbleField variant="terminal" tone="blue" count={12} />
                  <div className="relative z-10 flex flex-col items-center justify-center px-6 text-center text-slate-400">
                    <ScanLine className="h-9 w-9 text-slate-500" />
                    <p className="mt-3 text-sm font-medium text-slate-200">
                      Camera idle · No label frame loaded
                    </p>
                    <p className="mt-1 max-w-sm text-xs text-slate-400">
                      Start a USB/webcam feed, upload a label photo, or generate a synthetic test label
                      below.
                    </p>
                  </div>
                </>
              )}

              {inspecting && (
                <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
                  <BubbleField variant="burst" tone="blue" count={10} />
                  <div className="scan-sweep-anim h-1 w-full bg-gradient-to-r from-transparent via-sky-400 to-transparent shadow-[0_0_18px_rgba(56,189,248,0.85)]" />
                </div>
              )}
            </div>

            {/* Live QR Bar + Inspect Button */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-slate-500">Live QR Matrix Read</p>
                <p
                  className={`truncate font-mono text-xs font-medium ${
                    liveQr.detected ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                >
                  {liveQr.detected ? liveQr.payload : 'No QR matrix decoded in current frame'}
                </p>
              </div>
              <motion.button
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                disabled={inspecting || (!cameraActive && !previewImageUrl)}
                onClick={handleInspectCurrentFrame}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                {inspecting ? 'Inspecting Frame...' : 'Inspect Frame'}
              </motion.button>
            </div>

            {/* Synthetic Test Sample Generator */}
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-600">
                Benchtop Test Samples (Real Scannable QR Labels)
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    ['nominal', 'Nominal OK Label'],
                    ['smudge', 'Ink Smudge Defect'],
                    ['wrong_text', 'OCR Lot Mismatch'],
                    ['damaged_qr', 'Damaged QR Scratch'],
                  ] as Array<[SampleLabelVariant, string]>
                ).map(([variant, label]) => (
                  <button
                    key={variant}
                    type="button"
                    onClick={() => handleLoadSyntheticSample(variant)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Right: Verdict & Analysis */}
          <section className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-semibold text-slate-900">Verification Result</h2>
              {latestResult && (
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {latestResult.cycleTimeMs} ms
                </span>
              )}
            </div>

            {inspecting ? (
              <div className="space-y-4 py-6">
                <div className="h-14 w-full animate-pulse rounded-lg bg-slate-100" />
                <div className="h-20 w-full animate-pulse rounded-lg bg-slate-100" />
                <div className="h-24 w-full animate-pulse rounded-lg bg-slate-100" />
              </div>
            ) : !latestResult ? (
              <div className="py-12 text-center">
                <p className="text-sm font-medium text-slate-900">Ready for inspection</p>
                <p className="mt-1 text-xs text-slate-500">
                  Capture a frame or load a label image and click Inspect Frame to run QR, OCR, and
                  visual appearance verification.
                </p>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={latestResult.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-4"
                >
                  {/* Verdict Banner */}
                  <div
                    className={`relative overflow-hidden flex items-start gap-3 rounded-lg border px-4 py-3 ${
                      latestResult.verdict === 'OK'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                        : 'border-red-200 bg-red-50 text-red-950'
                    }`}
                  >
                    <BubbleField
                      variant="burst"
                      tone={latestResult.verdict === 'OK' ? 'emerald' : 'crimson'}
                      count={10}
                    />
                    {latestResult.verdict === 'OK' ? (
                      <CheckCircle2 className="relative z-10 mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                    ) : (
                      <XCircle className="relative z-10 mt-0.5 h-5 w-5 shrink-0 text-red-700" />
                    )}
                    <div className="relative z-10 min-w-0">
                      <p className="font-mono text-sm font-semibold">
                        VERDICT: {latestResult.verdict === 'OK' ? 'OK — ACCEPTED' : 'NG — REJECTED'}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed opacity-90">
                        {latestResult.summary}
                      </p>
                    </div>
                  </div>

                {/* 3 Check Breakdown */}
                <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                  <div className="p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900">1. QR Payload Check</span>
                      <span
                        className={`font-mono text-xs font-semibold ${
                          latestResult.qrMatch ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {latestResult.qrMatch ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-700 break-all">
                      {latestResult.qrDetected ? latestResult.qrPayload : 'No QR decoded'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{latestResult.qrNote}</p>
                  </div>

                  <div className="p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900">2. OCR Text Match</span>
                      <span
                        className={`font-mono text-xs font-semibold ${
                          latestResult.ocrMatch ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {latestResult.ocrMatch ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <pre className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700">
                      {latestResult.ocrExtractedText || 'No text extracted'}
                    </pre>
                    {latestResult.ocrMissingItems.length > 0 && (
                      <p className="mt-1 text-xs text-red-700">
                        Mismatch / Missing: {latestResult.ocrMissingItems.join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900">
                        3. Appearance & Golden Check
                      </span>
                      <span
                        className={`font-mono text-xs font-semibold tabular-nums ${
                          latestResult.appearancePass ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {latestResult.appearanceScore}/100 ·{' '}
                        {latestResult.appearancePass ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all ${
                          latestResult.appearancePass ? 'bg-emerald-600' : 'bg-red-600'
                        }`}
                        style={{ width: `${latestResult.appearanceScore}%` }}
                      />
                    </div>
                    {latestResult.defects.length > 0 ? (
                      <ul className="mt-2.5 space-y-1.5">
                        {latestResult.defects.map((d, i) => (
                          <li key={i} className="text-xs text-slate-700">
                            <span className="font-mono font-semibold text-red-700 uppercase">
                              [{d.severity}]
                            </span>{' '}
                            <span className="font-medium">{d.type}</span> ({d.location}):{' '}
                            {d.description}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        No visual print or surface defects observed.
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
              </AnimatePresence>
            )}
          </section>
        </div>
      ) : (
        /* Batch Upload Mode */
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Batch Label Inspection</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Queue multiple label images, run sequential verification, and export a CSV QA report
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleLoadSampleBatch}
                disabled={batchRunning}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap"
              >
                <Layers className="h-3.5 w-3.5" />
                Load 4 Sample Labels
              </button>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap">
                <Upload className="h-3.5 w-3.5" />
                Select Images
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleBatchFiles}
                  className="hidden"
                />
              </label>
              <a
                href="/api/inspections/export/csv?source=batch"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Export Batch CSV
              </a>
              <button
                type="button"
                disabled={batchRunning || batchItems.length === 0}
                onClick={handleRunBatch}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                {batchRunning ? 'Running Batch...' : 'Run Batch Inspection'}
              </button>
            </div>
          </div>

          {batchItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 py-14 text-center">
              <p className="text-sm font-medium text-slate-900">Batch queue is empty</p>
              <p className="mt-1 text-xs text-slate-500">
                Select multiple label photos or click Load 4 Sample Labels to test mixed OK/NG batch
                throughput.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <th className="px-4 py-2.5">Preview</th>
                    <th className="px-4 py-2.5">File</th>
                    <th className="px-4 py-2.5">QR Payload</th>
                    <th className="px-4 py-2.5 text-right">Appearance</th>
                    <th className="px-4 py-2.5 text-right">Cycle</th>
                    <th className="px-4 py-2.5 text-right">Status / Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batchItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2">
                        <img
                          src={item.dataUrl}
                          alt={item.name}
                          referrerPolicy="no-referrer"
                          className="h-10 w-16 rounded border border-slate-200 bg-slate-100 object-contain"
                        />
                      </td>
                      <td className="px-4 py-2 text-xs font-medium text-slate-900">
                        {item.name}
                        {item.record && (
                          <p className="mt-0.5 max-w-md truncate text-[11px] font-normal text-slate-500">
                            {item.record.summary}
                          </p>
                        )}
                        {item.error && (
                          <p className="mt-0.5 text-[11px] font-normal text-red-700">{item.error}</p>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">
                        {item.record
                          ? item.record.qrDetected
                            ? item.record.qrPayload
                            : 'Not detected'
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-700 tabular-nums">
                        {item.record ? `${item.record.appearanceScore}%` : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-slate-500 tabular-nums">
                        {item.record ? `${item.record.cycleTimeMs} ms` : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs font-semibold">
                        {item.status === 'queued' && <span className="text-slate-500">QUEUED</span>}
                        {item.status === 'running' && (
                          <span className="text-blue-700">INSPECTING...</span>
                        )}
                        {item.status === 'error' && <span className="text-red-700">ERROR</span>}
                        {item.status === 'done' && item.record && (
                          <span
                            className={
                              item.record.verdict === 'OK' ? 'text-emerald-700' : 'text-red-700'
                            }
                          >
                            {item.record.verdict}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
