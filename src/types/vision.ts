export type ViewTab = 'overview' | 'live' | 'templates' | 'history' | 'hardware';

export type Verdict = 'OK' | 'NG';

export type InspectionSource = 'webcam' | 'upload' | 'batch' | 'esp32_trigger';

export type DefectSeverity = 'low' | 'medium' | 'high';

export interface DefectItem {
  type: string;
  severity: DefectSeverity;
  description: string;
  location: string;
}

export interface GoldenTemplate {
  id: string;
  name: string;
  sku: string;
  expectedQrPattern: string;
  expectedOcrText: string;
  appearanceCriteria: string;
  minSimilarityScore: number;
  referenceImageData: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionRecord {
  id: string;
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
  createdAt: string;
}

export interface TrendBucket {
  label: string;
  okCount: number;
  ngCount: number;
  total: number;
}

export interface MetricsSummary {
  totalInspections: number;
  acceptedCount: number;
  rejectedCount: number;
  qrSuccessRate: number;
  avgCycleTimeMs: number;
  defectDetectionRate: number;
  trend: TrendBucket[];
}

export type HardwareChannel = 'http_bridge' | 'web_serial' | 'manual_test';

export type HardwareEventType =
  | 'trigger'
  | 'signal_ok'
  | 'signal_ng'
  | 'heartbeat'
  | 'connect'
  | 'disconnect';

export interface HardwareEvent {
  id: string;
  channel: HardwareChannel;
  eventType: HardwareEventType;
  payload: string;
  createdAt: string;
}

export interface HardwareStatusResponse {
  httpConnected: boolean;
  lastHeartbeatAt: string | null;
  deviceId: string | null;
  firmware: string | null;
  rssi: number | null;
  pendingTriggerId: number;
  lastTriggerAt: string | null;
  pendingCommand: 'OK' | 'NG' | 'NONE' | 'IDLE';
  pendingCommandAt: string | null;
  events: HardwareEvent[];
}
