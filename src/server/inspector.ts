import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { DefectItem, GoldenTemplate } from '../types/vision.ts';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error('Invalid image data URL format.');
  }
  const mimeType = match[1];
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new Error(`Unsupported image MIME type: ${mimeType}`);
  }
  return { mimeType, data: match[2] };
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
}

export interface TemplateExtractionResult {
  ocrText: string;
  suggestedAppearanceCriteria: string;
  suggestedSku: string;
}

export async function extractTemplateFromImage(
  imageDataUrl: string
): Promise<TemplateExtractionResult> {
  const ai = getClient();
  const parsed = parseDataUrl(imageDataUrl);

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        },
        {
          text:
            'Analyze this golden-sample industrial product label. ' +
            'Extract every legible line of printed text exactly as shown, propose a concise SKU or part identifier if visible, ' +
            'and write clear visual appearance inspection criteria describing print sharpness, alignment, label borders, and QR quiet-zone quality.',
        },
      ],
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          ocrText: {
            type: Type.STRING,
            description: 'All legible printed text on the label separated by newlines.',
          },
          suggestedSku: {
            type: Type.STRING,
            description: 'Detected SKU, model number, or part code if visible, otherwise empty string.',
          },
          suggestedAppearanceCriteria: {
            type: Type.STRING,
            description: 'Concise visual inspection checklist for this label.',
          },
        },
        required: ['ocrText', 'suggestedSku', 'suggestedAppearanceCriteria'],
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  const parsedJson = JSON.parse(raw) as Partial<TemplateExtractionResult>;
  return {
    ocrText: parsedJson.ocrText ?? '',
    suggestedSku: parsedJson.suggestedSku ?? '',
    suggestedAppearanceCriteria:
      parsedJson.suggestedAppearanceCriteria ??
      'Clean label edges, crisp dark print contrast, zero ink smudges, intact QR quiet zone.',
  };
}

export interface VisionInspectionInput {
  imageDataUrl: string;
  qrDetected: boolean;
  qrPayload: string;
  template: GoldenTemplate | null;
}

export interface VisionInspectionOutput {
  qrMatch: boolean;
  qrNote: string;
  ocrExtractedText: string;
  ocrMatch: boolean;
  ocrMissingItems: string[];
  appearanceScore: number;
  appearancePass: boolean;
  defects: DefectItem[];
  summary: string;
}

export function evaluateQrPattern(
  qrDetected: boolean,
  qrPayload: string,
  expectedPattern: string
): { qrMatch: boolean; qrNote: string } {
  if (!qrDetected || !qrPayload.trim()) {
    return {
      qrMatch: false,
      qrNote: 'No readable QR code detected in frame.',
    };
  }

  const pattern = expectedPattern.trim();
  if (!pattern) {
    return {
      qrMatch: true,
      qrNote: 'QR decoded (no pattern restriction configured).',
    };
  }

  // Regex syntax: /pattern/flags
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    const lastSlash = pattern.lastIndexOf('/');
    const body = pattern.slice(1, lastSlash);
    const flags = pattern.slice(lastSlash + 1);
    try {
      const regex = new RegExp(body, flags);
      const matched = regex.test(qrPayload);
      return {
        qrMatch: matched,
        qrNote: matched
          ? `Matches expected pattern ${pattern}`
          : `Payload "${qrPayload}" failed pattern ${pattern}`,
      };
    } catch {
      // Fall back to literal substring if invalid regex
    }
  }

  const matched =
    qrPayload === pattern || qrPayload.toLowerCase().includes(pattern.toLowerCase());
  return {
    qrMatch: matched,
    qrNote: matched
      ? `Matches expected QR value "${pattern}"`
      : `Expected "${pattern}", decoded "${qrPayload}"`,
  };
}

export async function inspectLabelWithGemini(
  input: VisionInspectionInput
): Promise<VisionInspectionOutput> {
  const ai = getClient();
  const samplePart = parseDataUrl(input.imageDataUrl);
  const template = input.template;

  const qrCheck = evaluateQrPattern(
    input.qrDetected,
    input.qrPayload,
    template?.expectedQrPattern ?? ''
  );

  const parts: Array<
    | { inlineData: { mimeType: string; data: string } }
    | { text: string }
  > = [];

  let prompt =
    'You are an automated industrial vision inspection system verifying a product label. ' +
    'Inspect the TEST LABEL image carefully for:\n' +
    '1. OCR Text Accuracy: Read all printed text on the test label verbatim.\n' +
    '2. Visual Appearance & Defects: Check for ink smudges, faded print, scratched/damaged QR modules, torn/peeling label edges, severe skew, foreign debris, or misregistration.\n';

  if (template) {
    prompt += `\nActive Golden Template: "${template.name}" (SKU: ${template.sku})\n`;
    if (template.expectedOcrText.trim()) {
      prompt += `Required OCR Text Lines:\n"""\n${template.expectedOcrText.trim()}\n"""\nCompare the test label text against every required token/line. Mark ocrMatch=false and list specific discrepancies in ocrMissingItems if any required text is missing, altered, or illegible.\n`;
    } else {
      prompt += 'No strict OCR text template specified; mark ocrMatch=true if printed text is legible and coherent.\n';
    }
    if (template.appearanceCriteria.trim()) {
      prompt += `Appearance Criteria: ${template.appearanceCriteria.trim()}\n`;
    }
    prompt += `Minimum Acceptable Appearance Score: ${template.minSimilarityScore}/100.\n`;
  } else {
    prompt +=
      '\nNo active golden template is selected. Extract all printed text cleanly, evaluate general label print quality and QR integrity, and flag any visible physical or print defects.\n';
  }

  if (template?.referenceImageData) {
    try {
      const refPart = parseDataUrl(template.referenceImageData);
      parts.push({
        inlineData: {
          mimeType: refPart.mimeType,
          data: refPart.data,
        },
      });
      prompt +=
        '\nImage 1 is the GOLDEN REFERENCE SAMPLE. Image 2 is the TEST LABEL under inspection. Score visual similarity and layout alignment of Image 2 against Image 1 from 0 to 100.\n';
    } catch {
      // Ignore malformed reference image if somehow present
    }
  }

  parts.push({
    inlineData: {
      mimeType: samplePart.mimeType,
      data: samplePart.data,
    },
  });
  parts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          ocrExtractedText: {
            type: Type.STRING,
            description: 'Exact legible text printed on the test label.',
          },
          ocrMatch: {
            type: Type.BOOLEAN,
            description: 'True if all required OCR text lines match accurately without missing or wrong tokens.',
          },
          ocrMissingItems: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Specific missing, garbled, or mismatched text tokens compared to expected OCR text.',
          },
          appearanceScore: {
            type: Type.INTEGER,
            description: 'Visual print quality and golden-sample similarity score from 0 to 100.',
          },
          appearancePass: {
            type: Type.BOOLEAN,
            description: 'True if label appearance meets quality criteria with no critical defects.',
          },
          defects: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: {
                  type: Type.STRING,
                  description: 'Defect category e.g. Ink Smudge, Torn Corner, Low Contrast, Skew, Damaged QR, Text Mismatch.',
                },
                severity: {
                  type: Type.STRING,
                  description: 'One of: low, medium, high.',
                },
                description: {
                  type: Type.STRING,
                  description: 'Specific observation of the defect.',
                },
                location: {
                  type: Type.STRING,
                  description: 'Region of the label e.g. Top-right corner, QR quiet zone, Lot line.',
                },
              },
              required: ['type', 'severity', 'description', 'location'],
            },
          },
          summary: {
            type: Type.STRING,
            description: 'Concise 1-sentence QA inspection verdict summary.',
          },
        },
        required: [
          'ocrExtractedText',
          'ocrMatch',
          'ocrMissingItems',
          'appearanceScore',
          'appearancePass',
          'defects',
          'summary',
        ],
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  const parsed = JSON.parse(raw) as {
    ocrExtractedText?: string;
    ocrMatch?: boolean;
    ocrMissingItems?: string[];
    appearanceScore?: number;
    appearancePass?: boolean;
    defects?: Array<{
      type?: string;
      severity?: string;
      description?: string;
      location?: string;
    }>;
    summary?: string;
  };

  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.appearanceScore) || 0)));
  const threshold = template?.minSimilarityScore ?? 75;
  const normalizedDefects: DefectItem[] = (parsed.defects ?? []).map((d) => {
    const sev = d.severity === 'high' || d.severity === 'medium' || d.severity === 'low' ? d.severity : 'medium';
    return {
      type: d.type ?? 'Visual Anomaly',
      severity: sev,
      description: d.description ?? 'Defect observed during visual inspection.',
      location: d.location ?? 'Label surface',
    };
  });

  const hasHighDefect = normalizedDefects.some((d) => d.severity === 'high');
  const appearancePass = Boolean(parsed.appearancePass) && score >= threshold && !hasHighDefect;
  const ocrMatch = template?.expectedOcrText.trim() ? Boolean(parsed.ocrMatch) : true;

  return {
    qrMatch: qrCheck.qrMatch,
    qrNote: qrCheck.qrNote,
    ocrExtractedText: parsed.ocrExtractedText ?? '',
    ocrMatch,
    ocrMissingItems: parsed.ocrMissingItems ?? [],
    appearanceScore: score,
    appearancePass,
    defects: normalizedDefects,
    summary:
      parsed.summary ??
      (qrCheck.qrMatch && ocrMatch && appearancePass
        ? 'Label passed QR, OCR, and appearance checks.'
        : 'Label failed one or more quality verification checks.'),
  };
}
