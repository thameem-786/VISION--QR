import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  activateTemplate,
  clearHardwareEvents,
  clearInspections,
  createTemplate,
  deleteInspection,
  deleteTemplate,
  getActiveTemplate,
  getMetricsSummary,
  getTemplateById,
  insertHardwareEvent,
  insertInspection,
  listHardwareEvents,
  listInspections,
  listTemplates,
  updateTemplate,
} from './src/server/db.ts';
import {
  extractTemplateFromImage,
  inspectLabelWithGemini,
  isGeminiConfigured,
} from './src/server/inspector.ts';
import type {
  HardwareStatusResponse,
  InspectionSource,
  Verdict,
} from './src/types/vision.ts';

const PORT = 3000;
const MAX_IMAGE_CHARS = 8_000_000; // ~6MB base64 payload limit

const hardwareRuntime = {
  lastHeartbeatAt: null as string | null,
  deviceId: null as string | null,
  firmware: null as string | null,
  rssi: null as number | null,
  pendingTriggerId: 0,
  lastTriggerAt: null as string | null,
  pendingCommand: 'NONE' as 'OK' | 'NG' | 'NONE',
  pendingCommandAt: null as string | null,
};

function isHttpEsp32Connected(): boolean {
  const hbMs = hardwareRuntime.lastHeartbeatAt
    ? new Date(hardwareRuntime.lastHeartbeatAt).getTime()
    : 0;
  return hbMs > 0 && Date.now() - hbMs < 20_000;
}

function getHardwareStatus(): HardwareStatusResponse {
  const httpConnected = isHttpEsp32Connected();

  return {
    httpConnected,
    lastHeartbeatAt: hardwareRuntime.lastHeartbeatAt,
    deviceId: hardwareRuntime.deviceId,
    firmware: hardwareRuntime.firmware,
    rssi: hardwareRuntime.rssi,
    pendingTriggerId: hardwareRuntime.pendingTriggerId,
    lastTriggerAt: hardwareRuntime.lastTriggerAt,
    pendingCommand: httpConnected ? hardwareRuntime.pendingCommand : 'NONE',
    pendingCommandAt: httpConnected ? hardwareRuntime.pendingCommandAt : null,
    events: listHardwareEvents(40),
  };
}

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      geminiConfigured: isGeminiConfigured(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/metrics', (_req: Request, res: Response) => {
    res.json(getMetricsSummary());
  });

  // Golden Templates CRUD
  app.get('/api/templates', (_req: Request, res: Response) => {
    res.json({ templates: listTemplates() });
  });

  app.post('/api/templates/extract', async (req: Request, res: Response) => {
    try {
      const imageDataUrl = typeof req.body?.imageDataUrl === 'string' ? req.body.imageDataUrl : '';
      if (!imageDataUrl || imageDataUrl.length > MAX_IMAGE_CHARS) {
        res.status(400).json({ error: 'A valid label image under 6MB is required.' });
        return;
      }
      const extracted = await extractTemplateFromImage(imageDataUrl);
      res.json(extracted);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to extract template details.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/templates', (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const sku = typeof req.body?.sku === 'string' ? req.body.sku.trim() : '';
    if (!name || !sku) {
      res.status(400).json({ error: 'Template name and SKU are required.' });
      return;
    }

    const referenceImageData =
      typeof req.body?.referenceImageData === 'string' && req.body.referenceImageData.length > 0
        ? req.body.referenceImageData
        : null;
    if (referenceImageData && referenceImageData.length > MAX_IMAGE_CHARS) {
      res.status(400).json({ error: 'Reference image exceeds maximum size.' });
      return;
    }

    const minScore = Math.max(40, Math.min(100, Number(req.body?.minSimilarityScore) || 80));

    const created = createTemplate({
      name,
      sku,
      expectedQrPattern:
        typeof req.body?.expectedQrPattern === 'string' ? req.body.expectedQrPattern.trim() : '',
      expectedOcrText:
        typeof req.body?.expectedOcrText === 'string' ? req.body.expectedOcrText.trim() : '',
      appearanceCriteria:
        typeof req.body?.appearanceCriteria === 'string'
          ? req.body.appearanceCriteria.trim()
          : 'Clean edges, crisp ink contrast, intact QR quiet zone, no smudges.',
      minSimilarityScore: minScore,
      referenceImageData,
      isActive: Boolean(req.body?.isActive),
    });

    res.status(201).json({ template: created });
  });

  app.put('/api/templates/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    const referenceImageData =
      req.body?.referenceImageData === null
        ? null
        : typeof req.body?.referenceImageData === 'string'
          ? req.body.referenceImageData
          : undefined;
    if (referenceImageData && referenceImageData.length > MAX_IMAGE_CHARS) {
      res.status(400).json({ error: 'Reference image exceeds maximum size.' });
      return;
    }

    const updated = updateTemplate(id, {
      name: typeof req.body?.name === 'string' ? req.body.name.trim() : undefined,
      sku: typeof req.body?.sku === 'string' ? req.body.sku.trim() : undefined,
      expectedQrPattern:
        typeof req.body?.expectedQrPattern === 'string'
          ? req.body.expectedQrPattern.trim()
          : undefined,
      expectedOcrText:
        typeof req.body?.expectedOcrText === 'string' ? req.body.expectedOcrText.trim() : undefined,
      appearanceCriteria:
        typeof req.body?.appearanceCriteria === 'string'
          ? req.body.appearanceCriteria.trim()
          : undefined,
      minSimilarityScore:
        req.body?.minSimilarityScore !== undefined
          ? Math.max(40, Math.min(100, Number(req.body.minSimilarityScore) || 80))
          : undefined,
      referenceImageData,
      isActive: req.body?.isActive !== undefined ? Boolean(req.body.isActive) : undefined,
    });

    if (!updated) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }
    res.json({ template: updated });
  });

  app.post('/api/templates/:id/activate', (req: Request, res: Response) => {
    const activated = activateTemplate(req.params.id);
    if (!activated) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }
    res.json({ template: activated });
  });

  app.delete('/api/templates/:id', (req: Request, res: Response) => {
    const deleted = deleteTemplate(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  // Inspections & Vision Pipeline
  app.get('/api/inspections', (req: Request, res: Response) => {
    const verdict = typeof req.query.verdict === 'string' ? req.query.verdict : undefined;
    const source = typeof req.query.source === 'string' ? req.query.source : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 200;

    res.json({
      inspections: listInspections({ verdict, source, search, from, to, limit }),
    });
  });

  app.post('/api/inspect', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const imageDataUrl = typeof req.body?.imageDataUrl === 'string' ? req.body.imageDataUrl : '';
      if (!imageDataUrl || imageDataUrl.length > MAX_IMAGE_CHARS) {
        res.status(400).json({ error: 'A valid captured image under 6MB is required.' });
        return;
      }

      const qrDetected = Boolean(req.body?.qrDetected);
      const qrPayload = typeof req.body?.qrPayload === 'string' ? req.body.qrPayload.trim() : '';
      const rawSource = typeof req.body?.sourceType === 'string' ? req.body.sourceType : 'upload';
      const sourceType: InspectionSource =
        rawSource === 'webcam' ||
        rawSource === 'upload' ||
        rawSource === 'batch' ||
        rawSource === 'esp32_trigger'
          ? rawSource
          : 'upload';

      const requestedTemplateId =
        typeof req.body?.templateId === 'string' && req.body.templateId.trim().length > 0
          ? req.body.templateId.trim()
          : null;
      const template = requestedTemplateId
        ? getTemplateById(requestedTemplateId)
        : getActiveTemplate();

      const visionResult = await inspectLabelWithGemini({
        imageDataUrl,
        qrDetected,
        qrPayload,
        template,
      });

      const verdict: Verdict =
        qrDetected &&
        visionResult.qrMatch &&
        visionResult.ocrMatch &&
        visionResult.appearancePass
          ? 'OK'
          : 'NG';

      const cycleTimeMs = Math.max(1, Date.now() - startedAt);

      const record = insertInspection({
        templateId: template?.id ?? null,
        templateName: template?.name ?? 'Ad-hoc Inspection',
        verdict,
        qrDetected,
        qrPayload,
        qrMatch: visionResult.qrMatch,
        qrNote: visionResult.qrNote,
        ocrExtractedText: visionResult.ocrExtractedText,
        ocrMatch: visionResult.ocrMatch,
        ocrMissingItems: visionResult.ocrMissingItems,
        appearanceScore: visionResult.appearanceScore,
        appearancePass: visionResult.appearancePass,
        defects: visionResult.defects,
        summary: visionResult.summary,
        cycleTimeMs,
        sourceType,
        imageData: imageDataUrl,
      });

      // Queue signal only if an ESP32 HTTP bridge device is actively connected
      if (isHttpEsp32Connected()) {
        hardwareRuntime.pendingCommand = verdict;
        hardwareRuntime.pendingCommandAt = new Date().toISOString();
        insertHardwareEvent(
          'http_bridge',
          verdict === 'OK' ? 'signal_ok' : 'signal_ng',
          `Inspection ${record.id} -> ${verdict} (${cycleTimeMs} ms)`
        );
      }

      res.status(201).json({ inspection: record });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Inspection pipeline error.';
      res.status(500).json({ error: message });
    }
  });

  app.delete('/api/inspections/:id', (req: Request, res: Response) => {
    const deleted = deleteInspection(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Inspection record not found.' });
      return;
    }
    res.json({ deleted: true });
  });

  app.delete('/api/inspections', (_req: Request, res: Response) => {
    const count = clearInspections();
    res.json({ cleared: count });
  });

  app.get('/api/inspections/export/csv', (req: Request, res: Response) => {
    const verdict = typeof req.query.verdict === 'string' ? req.query.verdict : undefined;
    const source = typeof req.query.source === 'string' ? req.query.source : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const records = listInspections({ verdict, source, search, from, to, limit: 1000 });

    const headers = [
      'ID',
      'Timestamp',
      'Template',
      'Verdict',
      'Source',
      'QR Detected',
      'QR Payload',
      'QR Match',
      'OCR Match',
      'OCR Extracted Text',
      'Appearance Score',
      'Appearance Pass',
      'Defects Count',
      'Defect Details',
      'Cycle Time (ms)',
      'Summary',
    ];

    const lines = [headers.map(escapeCsvCell).join(',')];
    for (const r of records) {
      const defectDetails = r.defects
        .map((d) => `[${d.severity.toUpperCase()}] ${d.type} (${d.location}): ${d.description}`)
        .join('; ');
      lines.push(
        [
          r.id,
          r.createdAt,
          r.templateName,
          r.verdict,
          r.sourceType,
          r.qrDetected ? 'Yes' : 'No',
          r.qrPayload,
          r.qrMatch ? 'Pass' : 'Fail',
          r.ocrMatch ? 'Pass' : 'Fail',
          r.ocrExtractedText.replace(/\r?\n/g, ' | '),
          r.appearanceScore,
          r.appearancePass ? 'Pass' : 'Fail',
          r.defects.length,
          defectDetails,
          r.cycleTimeMs,
          r.summary,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }

    const csv = lines.join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="visionqr-inspections-${stamp}.csv"`);
    res.send(csv);
  });

  // Optional ESP32 HTTP Bridge + Test Trigger Endpoints
  app.get('/api/hardware/status', (_req: Request, res: Response) => {
    res.json(getHardwareStatus());
  });

  app.post('/api/hardware/esp32/heartbeat', (req: Request, res: Response) => {
    const now = new Date().toISOString();
    hardwareRuntime.lastHeartbeatAt = now;
    hardwareRuntime.deviceId =
      typeof req.body?.deviceId === 'string' ? req.body.deviceId.slice(0, 64) : 'esp32-station-01';
    hardwareRuntime.firmware =
      typeof req.body?.firmware === 'string' ? req.body.firmware.slice(0, 32) : '1.0.0';
    hardwareRuntime.rssi = typeof req.body?.rssi === 'number' ? req.body.rssi : null;

    res.json({
      ok: true,
      pendingCommand: hardwareRuntime.pendingCommand,
      timestamp: now,
    });
  });

  app.post('/api/hardware/esp32/trigger', (req: Request, res: Response) => {
    const now = new Date().toISOString();
    const channel = req.body?.channel === 'manual_test' ? 'manual_test' : 'http_bridge';
    hardwareRuntime.pendingTriggerId += 1;
    hardwareRuntime.lastTriggerAt = now;
    if (channel === 'http_bridge') {
      hardwareRuntime.lastHeartbeatAt = now;
    }

    const note =
      typeof req.body?.note === 'string' && req.body.note.trim().length > 0
        ? req.body.note.trim().slice(0, 120)
        : channel === 'manual_test'
          ? 'Manual sensor trigger simulated from dashboard'
          : 'IR proximity trigger received from ESP32';

    const event = insertHardwareEvent(channel, 'trigger', note);
    res.json({
      ok: true,
      pendingTriggerId: hardwareRuntime.pendingTriggerId,
      event,
    });
  });

  app.get('/api/hardware/esp32/command', (req: Request, res: Response) => {
    const now = new Date().toISOString();
    hardwareRuntime.lastHeartbeatAt = now;
    const ack = req.query.ack === '1' || req.query.ack === 'true';
    const command = hardwareRuntime.pendingCommand;
    if (ack && command !== 'NONE') {
      hardwareRuntime.pendingCommand = 'NONE';
    }
    res.json({
      command,
      commandAt: hardwareRuntime.pendingCommandAt,
      timestamp: now,
    });
  });

  app.post('/api/hardware/test-signal', (req: Request, res: Response) => {
    const signal = req.body?.signal === 'OK' ? 'OK' : 'NG';
    const channel = req.body?.channel === 'web_serial' ? 'web_serial' : 'manual_test';
    const now = new Date().toISOString();
    if (isHttpEsp32Connected()) {
      hardwareRuntime.pendingCommand = signal;
      hardwareRuntime.pendingCommandAt = now;
    }

    const event = insertHardwareEvent(
      channel,
      signal === 'OK' ? 'signal_ok' : 'signal_ng',
      `Manual ${signal} test signal dispatched to hardware output`
    );
    res.json({ ok: true, command: signal, event });
  });

  app.delete('/api/hardware/events', (_req: Request, res: Response) => {
    const cleared = clearHardwareEvents();
    hardwareRuntime.pendingCommand = 'NONE';
    hardwareRuntime.pendingCommandAt = null;
    res.json({ cleared });
  });

  app.post('/api/hardware/event', (req: Request, res: Response) => {
    const channel =
      req.body?.channel === 'web_serial' ||
      req.body?.channel === 'http_bridge' ||
      req.body?.channel === 'manual_test'
        ? req.body.channel
        : 'web_serial';
    const eventType =
      req.body?.eventType === 'connect' ||
      req.body?.eventType === 'disconnect' ||
      req.body?.eventType === 'trigger' ||
      req.body?.eventType === 'signal_ok' ||
      req.body?.eventType === 'signal_ng' ||
      req.body?.eventType === 'heartbeat'
        ? req.body.eventType
        : 'connect';
    const payload = typeof req.body?.payload === 'string' ? req.body.payload.slice(0, 200) : '';
    const event = insertHardwareEvent(channel, eventType, payload);
    res.status(201).json({ event });
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VisionQR Guard server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start VisionQR Guard server:', err);
  process.exit(1);
});
