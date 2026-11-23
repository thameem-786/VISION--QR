import jsQR from 'jsqr';
import { generateQrMatrix } from './qrGenerator.ts';

export interface QrPoint {
  x: number;
  y: number;
}

export interface QrScanResult {
  detected: boolean;
  payload: string;
  location: {
    topLeftCorner: QrPoint;
    topRightCorner: QrPoint;
    bottomRightCorner: QrPoint;
    bottomLeftCorner: QrPoint;
  } | null;
}

export function scanImageDataForQr(imageData: ImageData): QrScanResult {
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  if (!code || !code.data) {
    return { detected: false, payload: '', location: null };
  }
  return {
    detected: true,
    payload: code.data,
    location: code.location,
  };
}

export async function scanDataUrlForQr(dataUrl: string): Promise<QrScanResult> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ detected: false, payload: '', location: null });
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve(scanImageDataForQr(imageData));
    };
    img.onerror = () => resolve({ detected: false, payload: '', location: null });
    img.src = dataUrl;
  });
}

export async function fileToCompressedDataUrl(
  file: File,
  maxDimension = 1024,
  quality = 0.86
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable.'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Unable to decode selected image file.'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(file);
  });
}

export type SampleLabelVariant = 'nominal' | 'smudge' | 'wrong_text' | 'damaged_qr';

export function generateSampleLabelDataUrl(
  variant: SampleLabelVariant,
  customQrPayload?: string,
  customSku?: string
): string {
  const width = 760;
  const height = 440;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Brushed workbench backdrop
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, width, height);

  // Label stock card
  const lx = 44;
  const ly = 36;
  const lw = width - 88;
  const lh = height - 72;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(lx, ly, lw, lh, 12);
  ctx.fill();
  ctx.stroke();

  // Header band on label
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(lx, ly, lw, 56);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('APEX INDUSTRIAL · PART LABEL', lx + 24, ly + 36);

  ctx.font = 'bold 16px monospace';
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText('QC-VERIFIED', lx + lw - 140, ly + 35);

  const sku = customSku?.trim() || 'SKU: VQG-2040-REV2';
  const qrValue = customQrPayload?.trim() || 'VQG-2040-LOT2611-0042';

  // Left side printed metadata
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 24px monospace';
  ctx.fillText(sku, lx + 28, ly + 106);

  ctx.font = '18px monospace';
  ctx.fillStyle = '#334155';
  if (variant === 'wrong_text') {
    ctx.fillText('LOT: 2026-XX99 (MISMATCH)', lx + 28, ly + 148);
    ctx.fillText('BATCH: B-0000-ERR', lx + 28, ly + 182);
  } else {
    ctx.fillText('LOT: 2026-11A', lx + 28, ly + 148);
    ctx.fillText('BATCH: B-4092-OK', lx + 28, ly + 182);
  }
  ctx.fillText('MFG: PLANT-02 · LINE-A', lx + 28, ly + 216);
  ctx.fillText('ROHS COMPLIANT · CE', lx + 28, ly + 250);

  // Subtle separator line
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(lx + 28, ly + 276);
  ctx.lineTo(lx + 400, ly + 276);
  ctx.stroke();

  ctx.font = '14px monospace';
  ctx.fillStyle = '#475569';
  ctx.fillText(`QR REF: ${qrValue}`, lx + 28, ly + 312);

  // Draw real QR code on the right side
  const matrix = generateQrMatrix(qrValue);
  const qrSizePx = 220;
  const quietZone = 16;
  const modSize = (qrSizePx - quietZone * 2) / matrix.length;
  const qx = lx + lw - qrSizePx - 28;
  const qy = ly + 88;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(qx, qy, qrSizePx, qrSizePx);
  ctx.strokeStyle = '#e2e8f0';
  ctx.strokeRect(qx, qy, qrSizePx, qrSizePx);

  ctx.fillStyle = '#0f172a';
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix.length; c++) {
      if (matrix[r][c]) {
        ctx.fillRect(
          Math.floor(qx + quietZone + c * modSize),
          Math.floor(qy + quietZone + r * modSize),
          Math.ceil(modSize),
          Math.ceil(modSize)
        );
      }
    }
  }

  // Apply realistic physical/print defects for defect variants
  if (variant === 'smudge') {
    // Ink smudge across text & edge tear
    const grad = ctx.createRadialGradient(lx + 220, ly + 170, 8, lx + 220, ly + 170, 72);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.85)');
    grad.addColorStop(0.5, 'rgba(30, 41, 59, 0.52)');
    grad.addColorStop(1, 'rgba(30, 41, 59, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(lx + 220, ly + 170, 76, 30, -0.25, 0, Math.PI * 2);
    ctx.fill();

    // Scuff diagonal streak
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(lx + 110, ly + 235);
    ctx.lineTo(lx + 320, ly + 205);
    ctx.stroke();
  } else if (variant === 'damaged_qr') {
    // Scratch / missing print band obscuring QR finder & data modules
    ctx.fillStyle = '#ffffff';
    ctx.save();
    ctx.translate(qx + qrSizePx / 2, qy + qrSizePx / 2);
    ctx.rotate(-0.4);
    ctx.fillRect(-115, -22, 230, 44);
    ctx.restore();

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(qx + 12, qy + 185);
    ctx.lineTo(qx + 208, qy + 38);
    ctx.stroke();
  }

  ctx.restore();
  return canvas.toDataURL('image/jpeg', 0.92);
}
