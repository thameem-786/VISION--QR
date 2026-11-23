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
  RotateCcw,
  ScanLine,
  Upload,
  XCircle,
} from 'lucide-react';
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
import { BUTTON_SPRING_PROPS, SPRING_PANEL } from '../utils/motionPresets.ts';

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

  const handleResetInspection = useCallback(() => {
    stopCamera();
    setPreviewImageUrl(null);
    setCameraError(null);
    setLiveQr({ detected: false, payload: '', location: null });
    setLatestResult(null);
  }, [stopCamera]);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  const resultTemplate = latestResult?.templateId
    ? templates.find((t) => t.id === latestResult.templateId) ?? null
    : null;

  const verificationBreakdown: Array<{
    label: string;
    status: 'Pass' | 'Fail' | 'Not Implemented';
    detail: string;
  }> = latestResult
    ? [
        {
          label: 'QR Presence',
          status: latestResult.qrDetected ? 'Pass' : 'Fail',
          detail: latestResult.qrDetected
            ? 'QR matrix located in captured label'
            : 'No QR matrix detected in frame',
        },
        {
          label: 'QR Readability',
          status:
            latestResult.qrDetected && latestResult.qrPayload.trim().length > 0 ? 'Pass' : 'Fail',
          detail:
            latestResult.qrDetected && latestResult.qrPayload.trim().length > 0
              ? latestResult.qrPayload
              : 'QR payload could not be decoded',
        },
        {
          label: 'QR Format Validation',
          status: !latestResult.qrDetected
            ? 'Fail'
            : resultTemplate?.expectedQrPattern.trim()
              ? latestResult.qrMatch
                ? 'Pass'
                : 'Fail'
              : 'Not Implemented',
          detail: !latestResult.qrDetected
            ? 'Requires a decoded QR payload'
            : resultTemplate?.expectedQrPattern.trim()
              ? latestResult.qrNote
              : 'No expected QR pattern configured on template',
        },
        {
          label: 'OCR Text Matching',
          status: resultTemplate?.expectedOcrText.trim()
            ? latestResult.ocrMatch
              ? 'Pass'
              : 'Fail'
            : latestResult.ocrMatch
              ? 'Not Implemented'
              : 'Fail',
          detail: resultTemplate?.expectedOcrText.trim()
            ? latestResult.ocrMatch
              ? 'All required OCR lines matched'
              : `Mismatch / Missing: ${latestResult.ocrMissingItems.join(', ') || 'Text discrepancy'}`
            : 'No reference OCR text configured (extracted text shown below)',
        },
        {
          label: 'Appearance Verification',
          status: latestResult.appearancePass ? 'Pass' : 'Fail',
          detail: `${latestResult.appearanceScore}/100 visual quality score`,
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* Toolbar: Mode Switcher + Golden Template Selector */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-xl px-5 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1 rounded-lg bg-blue-950/[0.06] p-1">
            <motion.button
              type="button"
              {...BUTTON_SPRING_PROPS}
              onClick={() => setMode('single')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'single'
                  ? 'navy-glass-btn text-white'
                  : 'text-slate-700 hover:text-blue-900'
              }`}
            >
              Single / Webcam
            </motion.button>
            <motion.button
              type="button"
              {...BUTTON_SPRING_PROPS}
              onClick={() => {
                stopCamera();
                setMode('batch');
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                mode === 'batch'
                  ? 'navy-glass-btn text-white'
                  : 'text-slate-700 hover:text-blue-900'
              }`}
            >
              Batch Upload
            </motion.button>
          </div>

          <label className="hidden sm:flex items-center gap-2 text-xs text-slate-600 whitespace-nowrap">
            <input
              type="checkbox"
              checked={autoTriggerEnabled}
              onChange={(e) => setAutoTriggerEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-blue-950/25 accent-[#0b1736]"
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
            className="rounded-lg border border-blue-950/15 bg-white/90 px-3 py-1.5 text-xs font-medium text-[#0b1736] outline-none focus:border-blue-800"
          >
            <option value="">Ad-hoc (No Template)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.sku}){t.isActive ? ' · Active' : ''}
              </option>
            ))}
          </select>
          {templates.length === 0 && (
            <motion.button
              type="button"
              {...BUTTON_SPRING_PROPS}
              onClick={() => onNavigate('templates')}
              className="text-xs font-medium text-blue-900 hover:underline whitespace-nowrap"
            >
              Create Template
            </motion.button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
      {mode === 'single' ? (
        <motion.div
          key="single-mode"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={SPRING_PANEL}
          className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start"
        >
          {/* Left: Camera / Image Viewport */}
          <section className="glass-panel lg:col-span-7 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#0b1736]">Optical Capture Viewport</h2>
                <p className="text-xs text-slate-500">
                  {selectedTemplate
                    ? `Comparing against ${selectedTemplate.name} (Min score ${selectedTemplate.minSimilarityScore}%)`
                    : 'Running standalone QR, OCR, and defect verification'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!cameraActive ? (
                  <motion.button
                    type="button"
                    {...BUTTON_SPRING_PROPS}
                    onClick={startCamera}
                    className="white-glass-btn inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Start Camera
                  </motion.button>
                ) : (
                  <motion.button
                    type="button"
                    {...BUTTON_SPRING_PROPS}
                    onClick={stopCamera}
                    className="white-glass-btn inline-flex items-center gap-1.5 rounded-lg border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap"
                  >
                    <CameraOff className="h-3.5 w-3.5" />
                    Stop Camera
                  </motion.button>
                )}

                <motion.label
                  {...BUTTON_SPRING_PROPS}
                  className="white-glass-btn inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Image
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleUploadSingle}
                    className="hidden"
                  />
                </motion.label>

                <motion.button
                  type="button"
                  {...BUTTON_SPRING_PROPS}
                  disabled={inspecting}
                  onClick={handleResetInspection}
                  className="white-glass-btn inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-45 whitespace-nowrap"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset Inspection
                </motion.button>
              </div>
            </div>

            {cameraError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
                {cameraError} You can still upload label images or use the synthetic test samples below.
              </div>
            )}

            {/* Viewport Frame */}
            <div className="glass-dark-terminal relative aspect-[16/10] w-full overflow-hidden rounded-lg flex items-center justify-center">
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
                  className="h-full w-full object-contain bg-white/90"
                />
              )}

              {!cameraActive && !previewImageUrl && (
                <div className="relative z-10 flex flex-col items-center justify-center px-6 text-center text-sky-200/80">
                  <ScanLine className="h-9 w-9 text-sky-400" />
                  <p className="mt-3 text-sm font-medium text-white">
                    Camera idle · No label frame loaded
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-sky-200/75">
                    Start a USB/webcam feed, upload a label photo, or generate a synthetic test label
                    below.
                  </p>
                </div>
              )}

              {inspecting && (
                <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden bg-blue-950/20 backdrop-blur-[1px]">
                  <div className="scan-sweep-anim h-1 w-full bg-gradient-to-r from-transparent via-sky-400 to-transparent shadow-[0_0_20px_rgba(56,189,248,0.95)]" />
                </div>
              )}
            </div>

            {/* Live QR Bar + Inspect Button */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-blue-950/12 pt-3">
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
                {...BUTTON_SPRING_PROPS}
                disabled={inspecting || (!cameraActive && !previewImageUrl)}
                onClick={handleInspectCurrentFrame}
                className="navy-glass-btn inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-medium disabled:opacity-45 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                {inspecting ? 'Inspecting Frame...' : 'Inspect Frame'}
              </motion.button>
            </div>

            {/* Synthetic Test Sample Generator */}
            <div className="border-t border-blue-950/12 pt-3">
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
                  <motion.button
                    key={variant}
                    type="button"
                    {...BUTTON_SPRING_PROPS}
                    onClick={() => handleLoadSyntheticSample(variant)}
                    className="white-glass-btn rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap"
                  >
                    {label}
                  </motion.button>
                ))}
              </div>
            </div>
          </section>

          {/* Right: Verdict & Analysis */}
          <section className="glass-panel lg:col-span-5 rounded-xl p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-blue-950/12 pb-3">
              <h2 className="text-sm font-bold text-[#0b1736]">Verification Result</h2>
              {latestResult && (
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {latestResult.cycleTimeMs} ms
                </span>
              )}
            </div>

            {inspecting ? (
              <div className="space-y-4 py-6">
                <div className="h-14 w-full animate-pulse rounded-lg bg-blue-950/10" />
                <div className="h-20 w-full animate-pulse rounded-lg bg-blue-950/10" />
                <div className="h-24 w-full animate-pulse rounded-lg bg-blue-950/10" />
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
                    className={`flex items-start gap-3 rounded-lg border px-4 py-3 backdrop-blur-md ${
                      latestResult.verdict === 'OK'
                        ? 'border-emerald-200 bg-emerald-50/90 text-emerald-950'
                        : 'border-red-200 bg-red-50/90 text-red-950'
                    }`}
                  >
                    {latestResult.verdict === 'OK' ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                    ) : (
                      <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
                    )}
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold">
                        VERDICT: {latestResult.verdict === 'OK' ? 'OK — ACCEPTED' : 'NG — REJECTED'}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed opacity-90">
                        {latestResult.summary}
                      </p>
                    </div>
                  </div>

                  {/* 5-Check Breakdown List */}
                  <div className="divide-y divide-blue-950/10 rounded-lg border border-blue-950/15 bg-white/75">
                    {verificationBreakdown.map((item) => (
                      <div key={item.label} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#0b1736]">{item.label}</p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-500">{item.detail}</p>
                        </div>
                        <span
                          className={`shrink-0 font-mono text-xs font-semibold whitespace-nowrap ${
                            item.status === 'Pass'
                              ? 'text-emerald-700'
                              : item.status === 'Fail'
                                ? 'text-red-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Extracted OCR & Defect Details */}
                  <div className="divide-y divide-blue-950/10 rounded-lg border border-blue-950/15 bg-white/60">
                    <div className="p-3.5">
                      <p className="text-xs font-semibold text-[#0b1736]">Extracted OCR Text</p>
                      <pre className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap rounded border border-blue-950/10 bg-white/90 p-2 font-mono text-[11px] text-slate-700">
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
                        <span className="text-xs font-semibold text-[#0b1736]">
                          Visual Appearance Score
                        </span>
                        <span
                          className={`font-mono text-xs font-semibold tabular-nums ${
                            latestResult.appearancePass ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {latestResult.appearanceScore}/100
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-950/10">
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
        </motion.div>
      ) : (
        /* Batch Upload Mode */
        <motion.section
          key="batch-mode"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={SPRING_PANEL}
          className="glass-panel rounded-xl p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-blue-950/12 pb-4">
            <div>
              <h2 className="text-base font-bold text-[#0b1736]">Batch Label Inspection</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Queue multiple label images, run sequential verification, and export a CSV QA report
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <motion.button
                type="button"
                {...BUTTON_SPRING_PROPS}
                onClick={handleLoadSampleBatch}
                disabled={batchRunning}
                className="white-glass-btn inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-45 whitespace-nowrap"
              >
                <Layers className="h-3.5 w-3.5" />
                Load 4 Sample Labels
              </motion.button>
              <motion.label
                {...BUTTON_SPRING_PROPS}
                className="white-glass-btn inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" />
                Select Images
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleBatchFiles}
                  className="hidden"
                />
              </motion.label>
              <motion.a
                {...BUTTON_SPRING_PROPS}
                href="/api/inspections/export/csv?source=batch"
                className="white-glass-btn inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Export Batch CSV
              </motion.a>
              <motion.button
                type="button"
                {...BUTTON_SPRING_PROPS}
                disabled={batchRunning || batchItems.length === 0}
                onClick={handleRunBatch}
                className="navy-glass-btn inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-45 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                {batchRunning ? 'Running Batch...' : 'Run Batch Inspection'}
              </motion.button>
            </div>
          </div>

          {batchItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-blue-950/20 bg-white/60 py-14 text-center">
              <p className="text-sm font-medium text-[#0b1736]">Batch queue is empty</p>
              <p className="mt-1 text-xs text-slate-500">
                Select multiple label photos or click Load 4 Sample Labels to test mixed OK/NG batch
                throughput.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-blue-950/12 bg-blue-950/[0.04] text-xs font-medium text-slate-600">
                    <th className="px-4 py-2.5">Preview</th>
                    <th className="px-4 py-2.5">File</th>
                    <th className="px-4 py-2.5">QR Payload</th>
                    <th className="px-4 py-2.5 text-right">Appearance</th>
                    <th className="px-4 py-2.5 text-right">Cycle</th>
                    <th className="px-4 py-2.5 text-right">Status / Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-950/10">
                  {batchItems.map((item, idx) => (
                    <motion.tr
                      key={item.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.16, delay: idx * 0.025 }}
                      className="hover:bg-white/75"
                    >
                      <td className="px-4 py-2">
                        <img
                          src={item.dataUrl}
                          alt={item.name}
                          referrerPolicy="no-referrer"
                          className="h-10 w-16 rounded border border-blue-950/15 bg-white object-contain"
                        />
                      </td>
                      <td className="px-4 py-2 text-xs font-medium text-[#0b1736]">
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
                          <span className="text-blue-800">INSPECTING...</span>
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
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.section>
      )}
      </AnimatePresence>
    </div>
  );
}
