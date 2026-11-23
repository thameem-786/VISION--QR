import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  DefectItem,
  GoldenTemplate,
  HardwareChannel,
  HardwareEvent,
  HardwareEventType,
  InspectionRecord,
  InspectionSource,
  MetricsSummary,
  TrendBucket,
  Verdict,
} from '../types/vision.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'visionqr.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS golden_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT NOT NULL,
    expected_qr_pattern TEXT NOT NULL DEFAULT '',
    expected_ocr_text TEXT NOT NULL DEFAULT '',
    appearance_criteria TEXT NOT NULL DEFAULT '',
    min_similarity_score INTEGER NOT NULL DEFAULT 80,
    reference_image_data TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inspections (
    id TEXT PRIMARY KEY,
    template_id TEXT,
    template_name TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('OK', 'NG')),
    qr_detected INTEGER NOT NULL DEFAULT 0,
    qr_payload TEXT NOT NULL DEFAULT '',
    qr_match INTEGER NOT NULL DEFAULT 0,
    qr_note TEXT NOT NULL DEFAULT '',
    ocr_extracted_text TEXT NOT NULL DEFAULT '',
    ocr_match INTEGER NOT NULL DEFAULT 0,
    ocr_missing_items TEXT NOT NULL DEFAULT '[]',
    appearance_score INTEGER NOT NULL DEFAULT 0,
    appearance_pass INTEGER NOT NULL DEFAULT 0,
    defects_json TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    cycle_time_ms INTEGER NOT NULL DEFAULT 0,
    source_type TEXT NOT NULL DEFAULT 'upload',
    image_data TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_inspections_created_at ON inspections(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_inspections_verdict ON inspections(verdict);

  CREATE TABLE IF NOT EXISTS hardware_events (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_hardware_events_created_at ON hardware_events(created_at DESC);
`);

interface RawTemplateRow {
  id: string;
  name: string;
  sku: string;
  expected_qr_pattern: string;
  expected_ocr_text: string;
  appearance_criteria: string;
  min_similarity_score: number;
  reference_image_data: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface RawInspectionRow {
  id: string;
  template_id: string | null;
  template_name: string;
  verdict: string;
  qr_detected: number;
  qr_payload: string;
  qr_match: number;
  qr_note: string;
  ocr_extracted_text: string;
  ocr_match: number;
  ocr_missing_items: string;
  appearance_score: number;
  appearance_pass: number;
  defects_json: string;
  summary: string;
  cycle_time_ms: number;
  source_type: string;
  image_data: string | null;
  created_at: string;
}

interface RawHardwareEventRow {
  id: string;
  channel: string;
  event_type: string;
  payload: string;
  created_at: string;
}

function mapTemplate(row: RawTemplateRow): GoldenTemplate {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    expectedQrPattern: row.expected_qr_pattern,
    expectedOcrText: row.expected_ocr_text,
    appearanceCriteria: row.appearance_criteria,
    minSimilarityScore: row.min_similarity_score,
    referenceImageData: row.reference_image_data,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapInspection(row: RawInspectionRow): InspectionRecord {
  return {
    id: row.id,
    templateId: row.template_id,
    templateName: row.template_name,
    verdict: row.verdict === 'OK' ? 'OK' : 'NG',
    qrDetected: row.qr_detected === 1,
    qrPayload: row.qr_payload,
    qrMatch: row.qr_match === 1,
    qrNote: row.qr_note,
    ocrExtractedText: row.ocr_extracted_text,
    ocrMatch: row.ocr_match === 1,
    ocrMissingItems: safeParseJson<string[]>(row.ocr_missing_items, []),
    appearanceScore: row.appearance_score,
    appearancePass: row.appearance_pass === 1,
    defects: safeParseJson<DefectItem[]>(row.defects_json, []),
    summary: row.summary,
    cycleTimeMs: row.cycle_time_ms,
    sourceType: row.source_type as InspectionSource,
    imageData: row.image_data,
    createdAt: row.created_at,
  };
}

function mapHardwareEvent(row: RawHardwareEventRow): HardwareEvent {
  return {
    id: row.id,
    channel: row.channel as HardwareChannel,
    eventType: row.event_type as HardwareEventType,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export function listTemplates(): GoldenTemplate[] {
  const rows = db
    .prepare('SELECT * FROM golden_templates ORDER BY is_active DESC, updated_at DESC')
    .all() as unknown as RawTemplateRow[];
  return rows.map(mapTemplate);
}

export function getTemplateById(id: string): GoldenTemplate | null {
  const row = db
    .prepare('SELECT * FROM golden_templates WHERE id = ?')
    .get(id) as unknown as RawTemplateRow | undefined;
  return row ? mapTemplate(row) : null;
}

export function getActiveTemplate(): GoldenTemplate | null {
  const row = db
    .prepare('SELECT * FROM golden_templates WHERE is_active = 1 LIMIT 1')
    .get() as unknown as RawTemplateRow | undefined;
  return row ? mapTemplate(row) : null;
}

export interface CreateTemplateInput {
  name: string;
  sku: string;
  expectedQrPattern: string;
  expectedOcrText: string;
  appearanceCriteria: string;
  minSimilarityScore: number;
  referenceImageData: string | null;
  isActive: boolean;
}

export function createTemplate(input: CreateTemplateInput): GoldenTemplate {
  const id = `tpl_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    if (input.isActive) {
      db.prepare('UPDATE golden_templates SET is_active = 0').run();
    }
    db.prepare(
      `INSERT INTO golden_templates (
        id, name, sku, expected_qr_pattern, expected_ocr_text,
        appearance_criteria, min_similarity_score, reference_image_data,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.name,
      input.sku,
      input.expectedQrPattern,
      input.expectedOcrText,
      input.appearanceCriteria,
      input.minSimilarityScore,
      input.referenceImageData,
      input.isActive ? 1 : 0,
      now,
      now
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getTemplateById(id)!;
}

export function updateTemplate(id: string, input: Partial<CreateTemplateInput>): GoldenTemplate | null {
  const existing = getTemplateById(id);
  if (!existing) return null;
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    if (input.isActive) {
      db.prepare('UPDATE golden_templates SET is_active = 0').run();
    }
    db.prepare(
      `UPDATE golden_templates SET
        name = ?,
        sku = ?,
        expected_qr_pattern = ?,
        expected_ocr_text = ?,
        appearance_criteria = ?,
        min_similarity_score = ?,
        reference_image_data = ?,
        is_active = ?,
        updated_at = ?
      WHERE id = ?`
    ).run(
      input.name ?? existing.name,
      input.sku ?? existing.sku,
      input.expectedQrPattern ?? existing.expectedQrPattern,
      input.expectedOcrText ?? existing.expectedOcrText,
      input.appearanceCriteria ?? existing.appearanceCriteria,
      input.minSimilarityScore ?? existing.minSimilarityScore,
      input.referenceImageData !== undefined ? input.referenceImageData : existing.referenceImageData,
      input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.isActive ? 1 : 0,
      now,
      id
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getTemplateById(id);
}

export function activateTemplate(id: string): GoldenTemplate | null {
  const existing = getTemplateById(id);
  if (!existing) return null;
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE golden_templates SET is_active = 0').run();
    db.prepare('UPDATE golden_templates SET is_active = 1, updated_at = ? WHERE id = ?').run(now, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getTemplateById(id);
}

export function deleteTemplate(id: string): boolean {
  const result = db.prepare('DELETE FROM golden_templates WHERE id = ?').run(id);
  return result.changes > 0;
}

export interface CreateInspectionInput {
  templateId: string | null;
  templateName: string;
  verdict: Verdict;
  qrDetected: boolean;
  qrPayload: string;
  qrMatch: boolean;
  qrNote: string;
  ocrExtractedText: string;
  ocrMatch: boolean;
  ocrMissingItems: string[];
  appearanceScore: number;
  appearancePass: boolean;
  defects: DefectItem[];
  summary: string;
  cycleTimeMs: number;
  sourceType: InspectionSource;
  imageData: string | null;
}

export function insertInspection(input: CreateInspectionInput): InspectionRecord {
  const id = `ins_${randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO inspections (
      id, template_id, template_name, verdict, qr_detected, qr_payload, qr_match,
      qr_note, ocr_extracted_text, ocr_match, ocr_missing_items, appearance_score,
      appearance_pass, defects_json, summary, cycle_time_ms, source_type, image_data, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.templateId,
    input.templateName,
    input.verdict,
    input.qrDetected ? 1 : 0,
    input.qrPayload,
    input.qrMatch ? 1 : 0,
    input.qrNote,
    input.ocrExtractedText,
    input.ocrMatch ? 1 : 0,
    JSON.stringify(input.ocrMissingItems),
    input.appearanceScore,
    input.appearancePass ? 1 : 0,
    JSON.stringify(input.defects),
    input.summary,
    input.cycleTimeMs,
    input.sourceType,
    input.imageData,
    now
  );

  const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(id) as unknown as RawInspectionRow;
  return mapInspection(row);
}

export interface ListInspectionsOptions {
  verdict?: string;
  source?: string;
  search?: string;
  limit?: number;
}

export function listInspections(opts: ListInspectionsOptions = {}): InspectionRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (opts.verdict === 'OK' || opts.verdict === 'NG') {
    clauses.push('verdict = ?');
    params.push(opts.verdict);
  }
  if (
    opts.source === 'webcam' ||
    opts.source === 'upload' ||
    opts.source === 'batch' ||
    opts.source === 'esp32_trigger'
  ) {
    clauses.push('source_type = ?');
    params.push(opts.source);
  }
  if (opts.search && opts.search.trim().length > 0) {
    const q = `%${opts.search.trim().toLowerCase()}%`;
    clauses.push(
      '(LOWER(qr_payload) LIKE ? OR LOWER(template_name) LIKE ? OR LOWER(ocr_extracted_text) LIKE ? OR LOWER(summary) LIKE ?)'
    );
    params.push(q, q, q, q);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 1000);
  params.push(limit);

  const rows = db
    .prepare(`SELECT * FROM inspections ${whereSql} ORDER BY created_at DESC LIMIT ?`)
    .all(...params) as unknown as RawInspectionRow[];

  return rows.map(mapInspection);
}

export function deleteInspection(id: string): boolean {
  const result = db.prepare('DELETE FROM inspections WHERE id = ?').run(id);
  return result.changes > 0;
}

export function clearInspections(): number {
  const result = db.prepare('DELETE FROM inspections').run();
  return Number(result.changes);
}

export function getMetricsSummary(): MetricsSummary {
  const agg = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN verdict = 'OK' THEN 1 ELSE 0 END), 0) AS accepted,
        COALESCE(SUM(CASE WHEN verdict = 'NG' THEN 1 ELSE 0 END), 0) AS rejected,
        COALESCE(SUM(CASE WHEN qr_detected = 1 THEN 1 ELSE 0 END), 0) AS qr_ok,
        COALESCE(AVG(cycle_time_ms), 0) AS avg_cycle,
        COALESCE(SUM(CASE WHEN appearance_pass = 0 OR verdict = 'NG' THEN 1 ELSE 0 END), 0) AS defect_flagged
      FROM inspections`
    )
    .get() as unknown as {
    total: number;
    accepted: number;
    rejected: number;
    qr_ok: number;
    avg_cycle: number;
    defect_flagged: number;
  };

  const total = Number(agg.total) || 0;
  const accepted = Number(agg.accepted) || 0;
  const rejected = Number(agg.rejected) || 0;
  const qrOk = Number(agg.qr_ok) || 0;
  const defectFlagged = Number(agg.defect_flagged) || 0;

  // Group recent inspections into up to 12 chronological buckets for the trend chart
  const recentRows = db
    .prepare('SELECT verdict, created_at FROM inspections ORDER BY created_at DESC LIMIT 120')
    .all() as unknown as Array<{ verdict: string; created_at: string }>;

  const reversed = [...recentRows].reverse();
  const bucketMap = new Map<string, TrendBucket>();

  for (const row of reversed) {
    const dt = new Date(row.created_at);
    const label = `${String(dt.getHours()).padStart(2, '0')}:00 · ${dt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })}`;
    const current = bucketMap.get(label) ?? { label, okCount: 0, ngCount: 0, total: 0 };
    if (row.verdict === 'OK') {
      current.okCount += 1;
    } else {
      current.ngCount += 1;
    }
    current.total += 1;
    bucketMap.set(label, current);
  }

  const trend = Array.from(bucketMap.values()).slice(-12);

  return {
    totalInspections: total,
    acceptedCount: accepted,
    rejectedCount: rejected,
    qrSuccessRate: total > 0 ? Math.round((qrOk / total) * 100) : 0,
    avgCycleTimeMs: total > 0 ? Math.round(Number(agg.avg_cycle) || 0) : 0,
    defectDetectionRate: total > 0 ? Math.round((defectFlagged / total) * 100) : 0,
    trend,
  };
}

export function insertHardwareEvent(
  channel: HardwareChannel,
  eventType: HardwareEventType,
  payload: string
): HardwareEvent {
  const id = `hw_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO hardware_events (id, channel, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, channel, eventType, payload, now);

  const row = db
    .prepare('SELECT * FROM hardware_events WHERE id = ?')
    .get(id) as unknown as RawHardwareEventRow;
  return mapHardwareEvent(row);
}

export function listHardwareEvents(limit = 50): HardwareEvent[] {
  const rows = db
    .prepare('SELECT * FROM hardware_events ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 200)) as unknown as RawHardwareEventRow[];
  return rows.map(mapHardwareEvent);
}
