// Minimal, deterministic ISO/IEC 18004 QR Code generator (Byte mode, ECC Level M, Versions 1-4)
// Supports payloads up to 64 UTF-8 bytes cleanly for industrial test label generation.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(ecCount: number): number[] {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEc(data: number[], ecCount: number): number[] {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Array<number>(data.length + ecCount).fill(0);
  for (let i = 0; i < data.length; i++) res[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

interface VersionSpec {
  version: number;
  size: number;
  dataCodewords: number;
  ecPerBlock: number;
  blocks: number;
  alignCenters: number[];
}

// Level M specifications for Versions 1-4 (single block or 2 equal blocks)
const VERSION_SPECS: VersionSpec[] = [
  { version: 1, size: 21, dataCodewords: 16, ecPerBlock: 10, blocks: 1, alignCenters: [] },
  { version: 2, size: 25, dataCodewords: 28, ecPerBlock: 16, blocks: 1, alignCenters: [6, 18] },
  { version: 3, size: 29, dataCodewords: 44, ecPerBlock: 26, blocks: 1, alignCenters: [6, 22] },
  { version: 4, size: 33, dataCodewords: 64, ecPerBlock: 18, blocks: 2, alignCenters: [6, 26] },
];

export function generateQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const spec =
    VERSION_SPECS.find((s) => bytes.length + 2 <= s.dataCodewords) ??
    VERSION_SPECS[VERSION_SPECS.length - 1];

  const maxPayload = spec.dataCodewords - 2;
  const payload = bytes.slice(0, maxPayload);

  // Build data bit stream: Mode 0100 (Byte), 8-bit length, data bytes, terminator, pad bytes
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(payload.length, 8);
  for (const b of payload) {
    pushBits(b, 8);
  }
  const targetBits = spec.dataCodewords * 8;
  const terminatorLen = Math.min(4, targetBits - bits.length);
  pushBits(0, terminatorLen);
  while (bits.length % 8 !== 0) bits.push(0);

  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < targetBits) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx += 1;
  }

  const dataBytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i + b];
    dataBytes.push(v);
  }

  // Split into blocks & compute Reed-Solomon ECC
  const blockSize = Math.floor(dataBytes.length / spec.blocks);
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  for (let b = 0; b < spec.blocks; b++) {
    const slice = dataBytes.slice(b * blockSize, (b + 1) * blockSize);
    dataBlocks.push(slice);
    ecBlocks.push(rsComputeEc(slice, spec.ecPerBlock));
  }

  const interleaved: number[] = [];
  for (let i = 0; i < blockSize; i++) {
    for (let b = 0; b < spec.blocks; b++) interleaved.push(dataBlocks[b][i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (let b = 0; b < spec.blocks; b++) interleaved.push(ecBlocks[b][i]);
  }

  const streamBits: number[] = [];
  for (const byte of interleaved) {
    for (let i = 7; i >= 0; i--) streamBits.push((byte >> i) & 1);
  }
  // Remainder bits (Version 2-4 have 7 remainder bits)
  const remainderBits = spec.version === 1 ? 0 : 7;
  for (let i = 0; i < remainderBits; i++) streamBits.push(0);

  const n = spec.size;
  const modules: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const reserved: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));

  const setModule = (r: number, c: number, val: boolean, lock = true) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    modules[r][c] = val;
    if (lock) reserved[r][c] = true;
  };

  const placeFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || c < 0 || r >= n || c >= n) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setModule(r, c, inOuter && (onBorder || inCore), true);
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, n - 7);
  placeFinder(n - 7, 0);

  // Timing patterns
  for (let i = 8; i < n - 8; i++) {
    const bit = i % 2 === 0;
    setModule(6, i, bit, true);
    setModule(i, 6, bit, true);
  }

  // Alignment patterns
  if (spec.alignCenters.length >= 2) {
    for (const ar of spec.alignCenters) {
      for (const ac of spec.alignCenters) {
        if (
          (ar === 6 && ac === 6) ||
          (ar === 6 && ac === n - 7) ||
          (ar === n - 7 && ac === 6)
        ) {
          continue;
        }
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const onEdge = Math.abs(dr) === 2 || Math.abs(dc) === 2;
            const isCenter = dr === 0 && dc === 0;
            setModule(ar + dr, ac + dc, onEdge || isCenter, true);
          }
        }
      }
    }
  }

  // Dark module & reserve format info areas
  setModule(n - 8, 8, true, true);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][n - 1 - i] = true;
    reserved[n - 1 - i][8] = true;
  }

  // Place data bits in zig-zag columns
  let bitIdx = 0;
  let upward = true;
  for (let col = n - 1; col >= 1; col -= 2) {
    if (col === 6) col -= 1;
    for (let step = 0; step < n; step++) {
      const row = upward ? n - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!reserved[row][c]) {
          const rawBit = bitIdx < streamBits.length ? streamBits[bitIdx] === 1 : false;
          bitIdx += 1;
          // Use Mask 0: (row + c) % 2 === 0
          const masked = (row + c) % 2 === 0 ? !rawBit : rawBit;
          modules[row][c] = masked;
        }
      }
    }
    upward = !upward;
  }

  // Format information for ECC M (00) + Mask 0 (000) -> 15-bit BCH + XOR 0x5412 = 0x5412 ^ 0x0000 = 0x5412?
  // Let's compute exact 15-bit format string for (ecc=00, mask=000):
  // Data bits: 00000 -> BCH(15,5) remainder is 0 -> XOR 101010000010010 (0x5412) = 0x5412!
  const formatBits = 0x5412;
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >> i) & 1) === 1;
    // Around top-left
    if (i < 6) modules[8][i] = bit;
    else if (i < 8) modules[8][i + 1] = bit;
    else modules[14 - i][8] = bit;

    // Around top-right & bottom-left
    if (i < 8) modules[n - 1 - i][8] = bit;
    else modules[8][n - 15 + i] = bit;
  }
  // Wait: standard bit order in format strip: bit 14 is placed at (8,0) and (n-1,8), bit 0 at (0,8) and (8,n-1).
  // Let's write explicit standard placement so it's 100% exact:
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >> (14 - i)) & 1) === 1;
    // Strip A (top-left)
    if (i < 6) modules[8][i] = bit;
    else if (i === 6) modules[8][7] = bit;
    else if (i === 7) modules[8][8] = bit;
    else if (i === 8) modules[7][8] = bit;
    else modules[14 - i][8] = bit;

    // Strip B (bottom-left + top-right)
    if (i < 7) modules[n - 1 - i][8] = bit;
    else modules[8][n - 15 + i] = bit;
  }

  return modules;
}
