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
import {
  BUTTON_SPRING_PROPS,
  NAV_SPRING_PROPS,
  SPRING_INTERACTIVE,
  SPRING_PANEL,
} from './utils/motionPresets.ts';

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

  const handleClearHardwareEvents = async () => {
    try {
      const res = await fetch('/api/hardware/events', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear hardware event log.');
      await refreshAllData();
      notify('Hardware event log cleared.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Clear failed.', 'error');
    }
  };

  const esp32Label = serialConnected
    ? 'Serial'
    : hardwareStatus?.httpConnected
      ? 'HTTP'
      : 'Off';

  return (
    <div className="navy-white-canvas flex min-h-screen text-[#0b1736]">
      {/* Desktop Sidebar */}
      <aside className="glass-navy-sidebar hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col text-white">
        <div className="navy-accent-bar h-[3px] w-full shrink-0" />
        <div className="flex h-16 items-center gap-3 border-b border-white/15 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/25 bg-white/15 text-white shadow-sm backdrop-blur-md">
            <QrCode className="h-4 w-4" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
            VisionQR Guard
          </span>
        </div>

        <nav className="flex-1 space-y-1.5 px-3 py-5" aria-label="Workspace navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <motion.button
                key={item.id}
                type="button"
                {...NAV_SPRING_PROPS}
                onClick={() => setActiveTab(item.id)}
                className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'text-white'
                    : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="active-nav-bg"
                    transition={SPRING_INTERACTIVE}
                    className="absolute inset-0 rounded-lg border border-white/25 bg-white/15 backdrop-blur-md shadow-sm"
                  />
                )}
                <Icon className="relative z-10 h-4 w-4 shrink-0" />
                <span className="relative z-10">{item.label}</span>
              </motion.button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Navigation Drawer */}
      <AnimatePresence>
        {mobileNavOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 flex lg:hidden"
          >
            <div
              className="fixed inset-0 bg-[#0b1736]/45 backdrop-blur-xs"
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="glass-navy-sidebar relative flex w-64 flex-col text-white"
            >
              <div className="navy-accent-bar h-[3px] w-full shrink-0" />
              <div className="flex h-16 items-center justify-between border-b border-white/15 px-5">
                <span className="font-display text-lg font-bold text-white">
                  VisionQR Guard
                </span>
                <motion.button
                  type="button"
                  {...BUTTON_SPRING_PROPS}
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation"
                  className="rounded-lg p-1.5 text-blue-100 hover:bg-white/15 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </motion.button>
              </div>
              <nav className="flex-1 space-y-1.5 px-3 py-4">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <motion.button
                      key={item.id}
                      type="button"
                      {...NAV_SPRING_PROPS}
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileNavOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                        active
                          ? 'border border-white/25 bg-white/15 text-white backdrop-blur-md shadow-sm'
                          : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </motion.button>
                  );
                })}
              </nav>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Workspace */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="navy-accent-bar h-[3px] w-full shrink-0" />
        <header className="glass-header relative z-10 flex h-16 items-center justify-between gap-4 px-4 sm:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <motion.button
              type="button"
              {...BUTTON_SPRING_PROPS}
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="white-glass-btn rounded-lg p-2 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </motion.button>
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg font-bold text-[#0b1736] sm:text-xl">
                {VIEW_TITLES[activeTab]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-5 shrink-0">
            <div className="hidden md:flex items-center gap-3 font-mono text-xs text-slate-600">
              <span>
                Camera:{' '}
                <strong className={cameraActive ? 'text-emerald-700' : 'text-[#0b1736]'}>
                  {cameraActive ? 'Live' : 'Off'}
                </strong>
              </span>
              <span aria-hidden="true" className="text-blue-900/25">
                /
              </span>
              <span>
                ESP32:{' '}
                <strong className={esp32Label === 'Off' ? 'text-[#0b1736]' : 'text-emerald-700'}>
                  {esp32Label}
                </strong>
              </span>
            </div>

            {activeTab !== 'live' && (
              <motion.button
                type="button"
                {...BUTTON_SPRING_PROPS}
                onClick={() => setActiveTab('live')}
                className="navy-glass-btn rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap"
              >
                New Inspection
              </motion.button>
            )}
          </div>
        </header>

        <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10, scale: 0.992 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.992 }}
              transition={SPRING_PANEL}
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
                  onTemplatesChange={setTemplates}
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
                  onClearEvents={handleClearHardwareEvents}
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
            className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl px-4 py-3 text-xs font-medium ${
              toast.tone === 'error'
                ? 'border border-red-200 bg-red-50/95 text-red-900 backdrop-blur-md shadow-lg'
                : 'glass-panel text-slate-900'
            }`}
          >
            <span>{toast.message}</span>
            <motion.button
              type="button"
              {...BUTTON_SPRING_PROPS}
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="text-slate-400 hover:text-[#0b1736]"
            >
              <X className="h-3.5 w-3.5" />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
