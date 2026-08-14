// ============================================================
// ImageRenderer — `image` ResultNode renderer.
//
// Payload contract (strict; type-guard below):
//   { src: string;           // data: URL or http(s):// URL
//     alt: string;           // REQUIRED for a11y — no decorative
//                            //   alt="" allowed by this renderer
//     caption?: string;
//     width?: number;
//     height?: number; }
//
// Behaviour:
//   - When payload matches the contract, render <figure> +
//     <img loading="lazy"> + optional <figcaption> with the
//     src/alt/caption forwarded verbatim.
//   - When payload is malformed (missing src/alt, wrong types,
//     or src is not a string URL), fail-soft to a labelled JSON
//     dump so a bad upstream payload never crashes the card
//     chrome (mirrors TableRenderer / ChartRenderer fallbacks).
//   - src must be either a data: URL (data:<mime>;...) or
//     http(s):// — anything else is rejected as malformed so
//     javascript: / vbscript: / file: URLs never reach the DOM.
//
// This renderer is intentionally a pure presentational
// component; no gallery, no lightbox, no download (P2+ can
// layer those via context).
// ============================================================

import type { ResultNode } from '../types';
import styles from './ImageRenderer.module.css';

type ImagePayload = {
  src: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
};

const DATA_URL_RE = /^data:/i;
const HTTP_URL_RE = /^https?:\/\//i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isSafeImageSrc(value: string): boolean {
  // Reject anything that isn't a data: URL or http(s) URL.
  // javascript:, vbscript:, file:, etc. all bypass the type-guard.
  return DATA_URL_RE.test(value) || HTTP_URL_RE.test(value);
}

function isImagePayload(value: unknown): value is ImagePayload {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as {
    src?: unknown;
    alt?: unknown;
    caption?: unknown;
    width?: unknown;
    height?: unknown;
  };
  if (!isNonEmptyString(candidate.src)) return false;
  if (!isNonEmptyString(candidate.alt)) return false;
  if (!isSafeImageSrc(candidate.src)) return false;
  if (candidate.caption !== undefined && typeof candidate.caption !== 'string') {
    return false;
  }
  if (candidate.width !== undefined && !isFinitePositiveNumber(candidate.width)) {
    return false;
  }
  if (candidate.height !== undefined && !isFinitePositiveNumber(candidate.height)) {
    return false;
  }
  return true;
}

function tryStringify(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function ImageRenderer({ node }: { node: ResultNode }) {
  const payload = node.payload;

  if (!isImagePayload(payload)) {
    return (
      <div
        data-testid="result-renderer-image-fallback"
        data-result-id={node.id}
        role="region"
        aria-label={`${node.title}（图像数据无效，已降级为 JSON）`}
      >
        <p className={styles.fallbackNote}>
          图像数据格式无法解析，已降级为原始 JSON（fail-soft）：
        </p>
        <pre className={styles.fallback}>{tryStringify(payload)}</pre>
      </div>
    );
  }

  const { src, alt, caption, width, height } = payload;

  return (
    <figure
      className={styles.figure}
      data-testid="result-renderer-image"
      data-result-id={node.id}
    >
      <img
        className={styles.img}
        src={src}
        alt={alt}
        loading="lazy"
        {...(width !== undefined ? { width } : {})}
        {...(height !== undefined ? { height } : {})}
      />
      {caption !== undefined && caption !== '' && (
        <figcaption className={styles.caption}>{caption}</figcaption>
      )}
    </figure>
  );
}