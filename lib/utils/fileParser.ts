/**
 * Utilitário para parsear múltiplos formatos de arquivo em uma matriz de strings.
 * Suporta: CSV, TSV, XLSX, XLS, ODS, PDF, JSON.
 *
 * Retorna { headers, rows } onde headers é a primeira linha e rows são as demais.
 */

import { detectCsvDelimiter, parseCsv } from './csv';

export type ParsedFile = {
  headers: string[];
  rows: string[][];
  format: string;
};

function matrixToResult(data: unknown[][], format: string): ParsedFile {
  if (!data.length) return { headers: [], rows: [], format };
  const headers = (data[0] as unknown[]).map(v => String(v ?? '').trim());
  const rows = (data.slice(1) as unknown[][]).map(r =>
    headers.map((_, i) => String((r as unknown[])[i] ?? '').trim())
  );
  return { headers, rows, format };
}

async function parseXlsx(buffer: ArrayBuffer, format: string): Promise<ParsedFile> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  return matrixToResult(data, format);
}

async function parsePdf(buffer: ArrayBuffer): Promise<ParsedFile> {
  const pdfParse = (await import('pdf-parse')).default;
  const result = await pdfParse(Buffer.from(buffer));
  const lines = result.text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  if (!lines.length) return { headers: [], rows: [], format: 'pdf' };

  // Detectar se as linhas têm delimitador
  const sample = lines.slice(0, 5).join('\n');
  const hasComma = (sample.match(/,/g) || []).length;
  const hasSemi = (sample.match(/;/g) || []).length;
  const hasTab = (sample.match(/\t/g) || []).length;

  if (hasTab > hasComma && hasTab > hasSemi) {
    const { headers, rows } = parseCsv(lines.join('\n'), '\t');
    return { headers, rows, format: 'pdf' };
  }
  if (hasSemi >= hasComma) {
    const { headers, rows } = parseCsv(lines.join('\n'), ';');
    return { headers, rows, format: 'pdf' };
  }
  if (hasComma > 0) {
    const { headers, rows } = parseCsv(lines.join('\n'), ',');
    return { headers, rows, format: 'pdf' };
  }

  // Sem delimitador claro: cada linha é uma coluna "Nome"
  const headers = ['Nome'];
  const rows = lines.slice(1).map(l => [l]);
  return { headers, rows, format: 'pdf' };
}

function parseJson(text: string): ParsedFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { headers: [], rows: [], format: 'json' };
  }

  const arr = Array.isArray(data) ? data : [data];
  if (!arr.length) return { headers: [], rows: [], format: 'json' };

  const headers = Object.keys(arr[0] as object);
  const rows = arr.map(item =>
    headers.map(h => String((item as Record<string, unknown>)[h] ?? '').trim())
  );
  return { headers, rows, format: 'json' };
}

export async function parseUploadedFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  const ext = name.split('.').pop() ?? '';

  // XLSX / XLS / ODS
  if (['xlsx', 'xls', 'ods', 'xlsm', 'xlsb'].includes(ext)) {
    const buf = await file.arrayBuffer();
    return parseXlsx(buf, ext);
  }

  // PDF
  if (ext === 'pdf') {
    const buf = await file.arrayBuffer();
    return parsePdf(buf);
  }

  // JSON
  if (ext === 'json') {
    const text = await file.text();
    return parseJson(text);
  }

  // CSV / TSV / TXT — fallback
  const text = await file.text();
  const delimiter = ext === 'tsv' ? '\t' : detectCsvDelimiter(text);
  const { headers, rows } = parseCsv(text, delimiter);
  return { headers, rows, format: ext || 'csv' };
}
