import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Camera,
  Cpu,
  History,
  LayoutDashboard,
  Menu,
  QrCode,
  ShieldCheck,
  X,
} from 'lucide-react';
import { BubbleField } from './components/BubbleField.tsx';
import { GoldenTemplatesView } from './components/GoldenTemplatesView.tsx';
import { HardwareStatusView } from './components/HardwareStatusView.tsx';
import { InspectionDetailDrawer } from './components/InspectionDetailDrawer.tsx';
import { InspectionHistoryView } from './components/InspectionHistoryView.tsx';
import { LiveInspectionView } from './components/LiveInspectionView.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import type {
  GoldenTemplate,
  HardwareStatusResponse,
  InspectionRecord,
  MetricsSummary,
  ViewTab,
} from './types/vision.ts';
import { connectEsp32Serial } from './utils/esp32Serial.ts';
import type { Esp32SerialConnection } from './utils/esp32Serial.ts';

const EMPTY_METRICS: MetricsSummary = {
  totalInspections: 0,
  acceptedCount: 0,
  rejectedCount: 0,
  qrSuccessRate: 0,
  avgCycleTimeMs: 0,
  defectDetectionRate: 0,
  trend: [],
};

const NAV_ITEMS: Array<{ id: ViewTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'live', label: 'Live Inspection', icon: Camera },
  { id: 'templates', label: 'Golden Templates', icon: ShieldCheck },
  { id: 'history', label: 'Inspection History', icon: History },
  { id: 'hardware', label: 'Hardware Status', icon: Cpu },
];

const VIEW_TITLES: Record<ViewTab, string> = {
  overview: 'Intelligent QR Label & Appearance Verification',
  live: 'Live Inspection Station',
  templates: 'Golden Sample Templates',
  history: 'Inspection History & CSV Reports',
  hardware: 'ESP32 Hardware Bridge',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [metrics, setMetrics] = useState<MetricsSummary>(EMPTY_METRICS);
  const [templates, setTemplates] = useState<GoldenTemplate[]>([]);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [hardwareStatus, setHardwareStatus] = useState<HardwareStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedRecord, setSelectedRecord] = useState<InspectionRecord | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'info' | 'error' } | null>(null);

  // ESP32 Web Serial + Trigger tracking
  const serialConnRef = useRef<Esp32SerialConnection | null>(null);
  const [serialConnected, setSerialConnected] = useState(false);
  const [serialLogs, setSerialLogs] = useState<string[]>([]);
  const [triggerCounter, setTriggerCounter] = useState(0);
  const lastServerTriggerIdRef = useRef<number>(0);

  const notify = useCallback((message: string, tone: 'info' | 'error' = 'info') => {
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  const refreshAllData = useCallback(async () => {
    try {
      const [metricsRes, templatesRes, inspectionsRes, hwRes] = await Promise.all([
        fetch('/api/metrics'),
        fetch('/api/templates'),
        fetch('/api/inspections?limit=250'),
        fetch('/api/hardware/status'),
      ]);

      if (metricsRes.ok) setMetrics(await metricsRes.json());
      if (templatesRes.ok) {
        const data = await templatesRes.json();
        setTemplates(data.templates ?? []);
      }
      if (inspectionsRes.ok) {
        const data = await inspectionsRes.json();
        setInspections(data.inspections ?? []);
      }
      if (hwRes.ok) {
        const hw = (await hwRes.json()) as HardwareStatusResponse;
        setHardwareStatus(hw);
        lastServerTriggerIdRef.current = hw.pendingTriggerId;
      }
    } catch {
      notify('Unable to reach VisionQR Guard server.', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void refreshAllData();
  }, [refreshAllData]);

  // Poll hardware status every 3s for HTTP ESP32 triggers & heartbeats
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/hardware/status');
        if (!res.ok) return;
        const hw = (await res.json()) as HardwareStatusResponse;
        setHardwareStatus(hw);
        if (hw.pendingTriggerId > lastServerTriggerIdRef.current) {
          lastServerTriggerIdRef.current = hw.pendingTriggerId;
          setTriggerCounter((c) => c + 1);
        }
      } catch {
        // Silent background poll retry
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const appendSerialLog = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString();
    setSerialLogs((prev) => [`[${stamp}] ${line}`, ...prev].slice(0, 80));
  }, []);

  const handleConnectSerial = async () => {
    try {
      const conn = await connectEsp32Serial({
        onLine: (line) => {
          appendSerialLog(`RX: ${line}`);
          if (line.toUpperCase().includes('TRIGGER')) {
            setTriggerCounter((c) => c + 1);
            void fetch('/api/hardware/event', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                channel: 'web_serial',
                eventType: 'trigger',
                payload: `Serial RX: ${line}`,
              }),
            });
          }
        },
        onDisconnect: () => {
          setSerialConnected(false);
          serialConnRef.current = null;
          appendSerialLog('Serial connection closed.');
        },
        onError: (msg) => {
          notify(msg, 'error');
        },
      });
      serialConnRef.current = conn;
      setSerialConnected(true);
      appendSerialLog('Connected to ESP32 over USB Serial (115200 baud).');
      await fetch('/api/hardware/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'web_serial',
          eventType: 'connect',
          payload: 'ESP32 USB Serial port opened at 115200 baud',
        }),
      });
      notify('ESP32 USB Serial connected.');
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Unable to open ESP32 serial port.',
        'error'
      );
    }
  };

  const handleDisconnectSerial = async () => {
    if (serialConnRef.current) {
      await serialConnRef.current.close();
      serialConnRef.current = null;
    }
    setSerialConnected(false);
    await fetch('/api/hardware/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'web_serial',
        eventType: 'disconnect',
        payload: 'ESP32 USB Serial port disconnected',
      }),
    });
    notify('ESP32 USB Serial disconnected.');
  };

  const handleInspectionComplete = useCallback(
    async (record: InspectionRecord) => {
      if (serialConnRef.current) {
        try {
          await serialConnRef.current.sendCommand(
            record.verdict,
            record.qrDetected ? record.qrPayload : 'NO_QR'
          );
          appendSerialLog(`TX: CMD:${record.verdict}`);
        } catch {
          // Hardware output is optional
        }
      }
      await refreshAllData();
    },
    [refreshAllData, appendSerialLog]
  );

  const handleDeleteInspection = async (id: string) => {
    try {
      const res = await fetch(`/api/inspections/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed.');
      if (selectedRecord?.id === id) setSelectedRecord(null);
      await refreshAllData();
      notify('Inspection record removed.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed.', 'error');
    }
  };

  const handleClearInspections = async () => {
    try {
      const res = await fetch('/api/inspections', { method: 'DELETE' });
      if (!res.ok) throw new Error('Clear failed.');
      setSelectedRecord(null);
      await refreshAllData();
      notify('Inspection history cleared.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Clear failed.', 'error');
    }
  };

  const handleSimulateTrigger = async () => {
    try {
      const res = await fetch('/api/hardware/esp32/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'manual_test', note: 'Dashboard test trigger' }),
      });
      if (!res.ok) throw new Error('Trigger failed.');
      const data = await res.json();
      lastServerTriggerIdRef.current = data.pendingTriggerId;
      setTriggerCounter((c) => c + 1);
      await refreshAllData();
      notify('Sensor trigger dispatched.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Trigger failed.', 'error');
    }
  };

  const handleSendTestSignal = async (signal: 'OK' | 'NG') => {
    try {
      if (serialConnRef.current) {
        await serialConnRef.current.sendCommand(signal, 'TEST');
        appendSerialLog(`TX: CMD:${signal}|TEST`);
      }
      const res = await fetch('/api/hardware/test-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signal,
          channel: serialConnected ? 'web_serial' : 'manual_test',
        }),
      });
      if (!res.ok) throw new Error('Failed to dispatch signal.');
      await refreshAllData();
      notify(`Dispatched ${signal} test signal.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Signal failed.', 'error');
    }
  };

  const esp32Label = serialConnected
    ? 'Serial'
    : hardwareStatus?.httpConnected
      ? 'HTTP'
      : 'Off';

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white">
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
            <QrCode className="h-4 w-4" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            VisionQR Guard
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-5" aria-label="Workspace navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="active-nav-bg"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-lg bg-slate-900"
                  />
                )}
                <Icon className="relative z-10 h-4 w-4 shrink-0" />
                <span className="relative z-10">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500">
          Team Phoenix · PS-017
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setMobileNavOpen(false)} />
          <aside className="relative flex w-64 flex-col bg-white border-r border-slate-200">
            <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
              <span className="font-display text-base font-bold text-slate-900">
                VisionQR Guard
              </span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-4">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-slate-200 px-5 py-4 text-xs text-slate-500">
              Team Phoenix · PS-017
            </div>
          </aside>
        </div>
      )}

      {/* Main Workspace */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <BubbleField variant="ambient" tone="blue" count={14} className="opacity-70" />
        <header className="relative z-10 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xs sm:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">
                {VIEW_TITLES[activeTab]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-5 shrink-0">
            <div className="hidden md:flex items-center gap-3 font-mono text-xs text-slate-600">
              <span>
                Camera:{' '}
                <strong className={cameraActive ? 'text-emerald-700' : 'text-slate-900'}>
                  {cameraActive ? 'Live' : 'Off'}
                </strong>
              </span>
              <span aria-hidden="true" className="text-slate-300">
                /
              </span>
              <span>
                ESP32:{' '}
                <strong className={esp32Label === 'Off' ? 'text-slate-900' : 'text-emerald-700'}>
                  {esp32Label}
                </strong>
              </span>
            </div>

            {activeTab !== 'live' && (
              <button
                type="button"
                onClick={() => setActiveTab('live')}
                className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap"
              >
                New Inspection
              </button>
            )}
          </div>
        </header>

        <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === 'overview' && (
                <OverviewView
                  metrics={metrics}
                  recentInspections={inspections}
                  loading={loading}
                  onNavigate={setActiveTab}
                  onSelectInspection={setSelectedRecord}
                />
              )}

              {activeTab === 'live' && (
                <LiveInspectionView
                  templates={templates}
                  cameraActive={cameraActive}
                  onCameraActiveChange={setCameraActive}
                  pendingTriggerCounter={triggerCounter}
                  onInspectionComplete={handleInspectionComplete}
                  onNavigate={setActiveTab}
                  onNotify={notify}
                />
              )}

              {activeTab === 'templates' && (
                <GoldenTemplatesView
                  templates={templates}
                  onRefresh={refreshAllData}
                  onNotify={notify}
                />
              )}

              {activeTab === 'history' && (
                <InspectionHistoryView
                  inspections={inspections}
                  loading={loading}
                  onSelectInspection={setSelectedRecord}
                  onDeleteInspection={handleDeleteInspection}
                  onClearAll={handleClearInspections}
                  onNavigate={setActiveTab}
                />
              )}

              {activeTab === 'hardware' && (
                <HardwareStatusView
                  hardwareStatus={hardwareStatus}
                  serialConnected={serialConnected}
                  serialLogs={serialLogs}
                  onConnectSerial={handleConnectSerial}
                  onDisconnectSerial={handleDisconnectSerial}
                  onSimulateTrigger={handleSimulateTrigger}
                  onSendTestSignal={handleSendTestSignal}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Inspection Detail Drawer */}
      <InspectionDetailDrawer
        record={selectedRecord}
        templates={templates}
        onClose={() => setSelectedRecord(null)}
        onDelete={handleDeleteInspection}
      />

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.message}
            role="status"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-lg border px-4 py-3 text-xs font-medium shadow-md ${
              toast.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-900'
                : 'border-slate-200 bg-white text-slate-900'
            }`}
          >
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
