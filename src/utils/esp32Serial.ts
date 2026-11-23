// Web Serial API wrapper for optional USB-connected ESP32 boards

export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

interface NavigatorWithSerial extends Navigator {
  serial?: {
    requestPort(): Promise<SerialPortLike>;
  };
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export interface Esp32SerialConnection {
  port: SerialPortLike;
  sendCommand: (command: 'OK' | 'NG' | 'TEST', detail?: string) => Promise<void>;
  close: () => Promise<void>;
}

export async function connectEsp32Serial(handlers: {
  onLine: (line: string) => void;
  onDisconnect: () => void;
  onError: (message: string) => void;
}): Promise<Esp32SerialConnection> {
  const nav = navigator as NavigatorWithSerial;
  if (!nav.serial) {
    throw new Error('Web Serial API is not supported in this browser. Use Chromium or the HTTP Bridge.');
  }

  const port = await nav.serial.requestPort();
  await port.open({ baudRate: 115200 });

  let closed = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // Start background line reader
  if (port.readable) {
    reader = port.readable.getReader();
    (async () => {
      let buffer = '';
      try {
        while (!closed && reader) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.length > 0) {
                handlers.onLine(trimmed);
              }
            }
          }
        }
      } catch (err) {
        if (!closed) {
          handlers.onError(err instanceof Error ? err.message : 'Serial stream interrupted.');
        }
      } finally {
        if (!closed) {
          handlers.onDisconnect();
        }
      }
    })();
  }

  const sendCommand = async (command: 'OK' | 'NG' | 'TEST', detail?: string) => {
    if (!port.writable) {
      throw new Error('ESP32 serial port is not writable.');
    }
    const writer = port.writable.getWriter();
    try {
      const payload = detail ? `CMD:${command}|${detail}\n` : `CMD:${command}\n`;
      await writer.write(encoder.encode(payload));
    } finally {
      writer.releaseLock();
    }
  };

  const close = async () => {
    closed = true;
    try {
      await reader?.cancel();
    } catch {
      // Ignore cancel errors during teardown
    }
    try {
      await port.close();
    } catch {
      // Ignore close errors
    }
    handlers.onDisconnect();
  };

  return { port, sendCommand, close };
}
