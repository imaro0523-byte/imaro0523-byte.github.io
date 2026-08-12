/**
 * PNG / JPG / PDF generation.
 *
 * `html-to-image` rasterises the node with the browser's own renderer, and
 * jsPDF writes the file locally. Neither library performs a network request;
 * the CSP would block it if one tried.
 */

import { toBlob, toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';

import { downloadBlob } from './download';

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

export interface ImageOptions {
  /** 2 or 3 gives a crisp result on a projector or in print. */
  scale: number;
  backgroundColor: string;
}

const DEFAULTS: ImageOptions = { scale: 2, backgroundColor: '#ffffff' };

/** Filters out anything marked `no-print` so buttons never appear in an export. */
function keepForExport(node: HTMLElement): boolean {
  return !(node.classList && typeof node.classList.contains === 'function' && node.classList.contains('no-print'));
}

export async function exportPng(
  node: HTMLElement,
  fileName: string,
  options: Partial<ImageOptions> = {},
): Promise<void> {
  const settings = { ...DEFAULTS, ...options };
  let blob: Blob | null;
  try {
    blob = await toBlob(node, {
      pixelRatio: settings.scale,
      backgroundColor: settings.backgroundColor,
      cacheBust: false,
      filter: keepForExport,
    });
  } catch {
    throw new ExportError(
      '이미지를 만들지 못했습니다. 화면을 조금 줄이거나 «정밀도»를 낮춘 뒤 다시 시도해 주세요.',
    );
  }
  if (!blob) throw new ExportError('이미지를 만들지 못했습니다. 다시 시도해 주세요.');
  downloadBlob(blob, fileName);
}

export async function exportJpg(
  node: HTMLElement,
  fileName: string,
  options: Partial<ImageOptions> = {},
): Promise<void> {
  const settings = { ...DEFAULTS, ...options };
  try {
    const dataUrl = await toJpeg(node, {
      pixelRatio: settings.scale,
      backgroundColor: settings.backgroundColor,
      quality: 0.92,
      cacheBust: false,
      filter: keepForExport,
    });
    const response = dataUrlToBlob(dataUrl);
    downloadBlob(response, fileName);
  } catch {
    throw new ExportError('이미지를 만들지 못했습니다. 다시 시도해 주세요.');
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(header ?? '')?.[1] ?? 'image/jpeg';
  const binary = atob(payload ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export interface PdfOptions {
  orientation: 'landscape' | 'portrait';
  title?: string;
  subtitle?: string;
  /** Millimetres. */
  margin: number;
}

export async function exportPdf(
  node: HTMLElement,
  fileName: string,
  options: PdfOptions,
): Promise<void> {
  let dataUrl: string;
  try {
    dataUrl = await toJpeg(node, {
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      quality: 0.95,
      cacheBust: false,
      filter: keepForExport,
    });
  } catch {
    throw new ExportError('PDF를 만들지 못했습니다. 다시 시도해 주세요.');
  }

  const pdf = new jsPDF({ orientation: options.orientation, unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = Math.max(0, Math.min(options.margin, 40));

  let top = margin;
  if (options.title) {
    // A core font is used rather than an embedded Korean font, so the header is
    // kept to characters the built-in font can draw; the seat map itself is an
    // image and renders Korean perfectly.
    pdf.setFontSize(9);
    pdf.setTextColor(90);
    pdf.text(options.subtitle ?? '', margin, top + 3);
    top += 6;
  }

  const availableWidth = pageWidth - margin * 2;
  const availableHeight = pageHeight - top - margin;
  const properties = pdf.getImageProperties(dataUrl);
  const ratio = Math.min(availableWidth / properties.width, availableHeight / properties.height);
  const width = properties.width * ratio;
  const height = properties.height * ratio;

  pdf.addImage(dataUrl, 'JPEG', margin + (availableWidth - width) / 2, top, width, height);
  pdf.save(fileName);
}
