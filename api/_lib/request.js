import { HttpError } from './orbit-server.js';

export function requestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      throw new HttpError(400, 'Ogiltig JSON-body.');
    }
  }
  return req.body;
}

export function firstIcon(value, fallback = '📁') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (globalThis.Intl?.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)][0]?.segment || fallback;
  }
  return Array.from(text)[0] || fallback;
}
