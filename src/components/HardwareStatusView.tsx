import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, Cpu, Plug, Unplug, Zap } from 'lucide-react';
import type { HardwareStatusResponse } from '../types/vision.ts';
import { isWebSerialSupported } from '../utils/esp32Serial.ts';
import { BubbleField } from './BubbleField.tsx';

interface HardwareStatusViewProps {
  hardwareStatus: HardwareStatusResponse | null;
  serialConnected: boolean;
  serialLogs: string[];
  onConnectSerial: () => Promise<void>;
  onDisconnectSerial: () => Promise<void>;
  onSimulateTrigger: () => Promise<void>;
  onSendTestSignal: (signal: 'OK' | 'NG') => Promise<void>;
}

const ESP32_SKETCH = `// VisionQR Guard — Optional ESP32 Hardware Bridge (HTTP + USB Serial)
// Hardware: IR Sensor (GPIO 14), Green LED (GPIO 26), Red LED/Relay (GPIO 27)
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "http://YOUR_SERVER_HOST:3000";

const int IR_SENSOR_PIN = 14;
const int OK_LED_PIN = 26;
const int NG_RELAY_PIN = 27;
unsigned long lastPoll = 0;

void handleVerdict(String cmd) {
  if (cmd == "OK") {
    digitalWrite(OK_LED_PIN, HIGH);
    digitalWrite(NG_RELAY_PIN, LOW);
    delay(800);
    digitalWrite(OK_LED_PIN, LOW);
  } else if (cmd == "NG") {
    digitalWrite(NG_RELAY_PIN, HIGH);
    digitalWrite(OK_LED_PIN, LOW);
    delay(1000);
    digitalWrite(NG_RELAY_PIN, LOW);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(IR_SENSOR_PIN, INPUT_PULLUP);
  pinMode(OK_LED_PIN, OUTPUT);
  pinMode(NG_RELAY_PIN, OUTPUT);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED && millis() < 8000) delay(250);
}

void loop() {
  // 1. Listen for USB Web Serial commands
  if (Serial.available()) {
    String line = Serial.readStringUntil('\\n');
    line.trim();
    if (line.startsWith("CMD:OK")) handleVerdict("OK");
    if (line.startsWith("CMD:NG")) handleVerdict("NG");
  }

  // 2. IR Sensor triggers inspection
  if (digitalRead(IR_SENSOR_PIN) == LOW) {
    Serial.println("TRIGGER");
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(String(SERVER_URL) + "/api/hardware/esp32/trigger");
      http.addHeader("Content-Type", "application/json");
      http.POST("{\\"note\\":\\"IR beam triggered\\"}");
      http.end();
    }
    delay(600);
  }

  // 3. Poll HTTP bridge every 2 seconds for verdict relay commands
  if (WiFi.status() == WL_CONNECTED && millis() - lastPoll > 2000) {
    lastPoll = millis();
    HTTPClient http;
    http.begin(String(SERVER_URL) + "/api/hardware/esp32/command?ack=1");
    int code = http.GET();
    if (code == 200) {
      String body = http.getString();
      if (body.indexOf("\\"OK\\"") >= 0) handleVerdict("OK");
      else if (body.indexOf("\\"NG\\"") >= 0) handleVerdict("NG");
    }
    http.end();
  }
}`;

export function HardwareStatusView({
  hardwareStatus,
  serialConnected,
  serialLogs,
  onConnectSerial,
  onDisconnectSerial,
  onSimulateTrigger,
  onSendTestSignal,
}: HardwareStatusViewProps) {
  const [copied, setCopied] = useState(false);
  const [terminalTone, setTerminalTone] = useState<'neutral' | 'emerald' | 'crimson' | 'blue'>(
    'neutral'
  );
  const serialSupported = isWebSerialSupported();
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const copySketch = async () => {
    await navigator.clipboard.writeText(ESP32_SKETCH);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleTestSignalClick = async (signal: 'OK' | 'NG') => {
    setTerminalTone(signal === 'OK' ? 'emerald' : 'crimson');
    await onSendTestSignal(signal);
  };

  const handleTriggerClick = async () => {
    setTerminalTone('blue');
    await onSimulateTrigger();
  };

  return (
    <div className="space-y-6">
      {/* Two Integration Channels */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* USB Web Serial Bridge */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white/95 p-6 space-y-4 backdrop-blur-xs"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">USB Web Serial Bridge</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Direct 115200-baud connection to an ESP32 plugged into this station via USB
              </p>
            </div>
            <span
              className={`font-mono text-xs font-semibold ${
                serialConnected ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              {serialConnected ? 'CONNECTED' : 'OFFLINE'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!serialConnected ? (
              <motion.button
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                disabled={!serialSupported}
                onClick={onConnectSerial}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap"
              >
                <Plug className="h-3.5 w-3.5" />
                Connect USB ESP32
              </motion.button>
            ) : (
              <motion.button
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={onDisconnectSerial}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap"
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect Serial
              </motion.button>
            )}

            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => handleTestSignalClick('OK')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 whitespace-nowrap"
            >
              Test OK Signal
            </motion.button>
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => handleTestSignalClick('NG')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap"
            >
              Test NG Signal
            </motion.button>
          </div>

          {!serialSupported && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Web Serial requires a Chromium-based browser over HTTPS or localhost. Use the Wi-Fi
              HTTP Bridge or Test Trigger anytime.
            </p>
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Serial Monitor Output</p>
            <div className="relative h-36 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200">
              <BubbleField
                variant="terminal"
                tone={serialConnected ? 'emerald' : terminalTone}
                count={16}
              />
              <div className="relative z-10 space-y-1">
                <AnimatePresence initial={false}>
                  {serialLogs.map((line, i) => (
                    <motion.div
                      key={`${line}-${i}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="leading-relaxed"
                    >
                      {line}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Wi-Fi HTTP Bridge + Test Trigger */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white/95 p-6 space-y-4 backdrop-blur-xs"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Wi-Fi HTTP Bridge & Sensor Trigger
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                REST endpoints for standalone Wi-Fi ESP32 conveyor sensors and relay actuators
              </p>
            </div>
            <span
              className={`font-mono text-xs font-semibold ${
                hardwareStatus?.httpConnected ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              {hardwareStatus?.httpConnected ? 'ONLINE' : 'STANDBY'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
            <div>
              <p className="text-slate-500">Device ID</p>
              <p className="mt-0.5 font-mono font-medium text-slate-900">
                {hardwareStatus?.deviceId ?? 'Not paired'}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Queued Relay Command</p>
              <p className="mt-0.5 font-mono font-medium text-slate-900">
                {hardwareStatus?.pendingCommand ?? 'IDLE'}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Last Heartbeat</p>
              <p className="mt-0.5 font-mono text-slate-700 tabular-nums">
                {hardwareStatus?.lastHeartbeatAt
                  ? new Date(hardwareStatus.lastHeartbeatAt).toLocaleTimeString()
                  : 'Never'}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Trigger Counter</p>
              <p className="mt-0.5 font-mono text-slate-700 tabular-nums">
                {hardwareStatus?.pendingTriggerId ?? 0}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.96 }}
              onClick={handleTriggerClick}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap"
            >
              <Zap className="h-3.5 w-3.5" />
              Simulate Sensor Trigger
            </motion.button>
          </div>

          <div className="space-y-1.5 font-mono text-[11px] text-slate-600">
            <p className="font-sans text-xs font-medium text-slate-700">ESP32 Bridge Endpoints</p>
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 space-y-1 break-all">
              <div>POST {baseUrl}/api/hardware/esp32/trigger</div>
              <div>GET  {baseUrl}/api/hardware/esp32/command?ack=1</div>
              <div>POST {baseUrl}/api/hardware/esp32/heartbeat</div>
            </div>
          </div>
        </motion.section>
      </div>

      {/* Hardware Event Log */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-xl border border-slate-200 bg-white/95 backdrop-blur-xs"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-slate-600" />
            <h2 className="text-base font-semibold text-slate-900">Hardware Event Log</h2>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {hardwareStatus?.events.length ?? 0} recent events
          </span>
        </div>

        {!hardwareStatus || hardwareStatus.events.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-slate-500">
            No hardware triggers or relay signals recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="px-6 py-2.5">Timestamp</th>
                  <th className="px-4 py-2.5">Channel</th>
                  <th className="px-4 py-2.5">Event</th>
                  <th className="px-6 py-2.5">Payload / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hardwareStatus.events.slice(0, 15).map((ev) => (
                  <tr key={ev.id}>
                    <td className="px-6 py-2.5 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {new Date(ev.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700 whitespace-nowrap">
                      {ev.channel}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold whitespace-nowrap">
                      <span
                        className={
                          ev.eventType === 'signal_ok'
                            ? 'text-emerald-700'
                            : ev.eventType === 'signal_ng'
                              ? 'text-red-700'
                              : 'text-slate-800'
                        }
                      >
                        {ev.eventType}
                      </span>
                    </td>
                    <td className="px-6 py-2.5 text-xs text-slate-700">{ev.payload}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.section>

      {/* Firmware Reference */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">ESP32 Companion Firmware</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Arduino sketch supporting both USB Serial and Wi-Fi HTTP bridge modes
            </p>
          </div>
          <button
            type="button"
            onClick={copySketch}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied Sketch' : 'Copy Sketch'}
          </button>
        </div>
        <pre className="mt-4 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200">
          {ESP32_SKETCH}
        </pre>
      </section>
    </div>
  );
}
