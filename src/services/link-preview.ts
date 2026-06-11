/**
 * Sender-side link-preview generation.
 *
 * When a user shares a URL, only the SENDER's device builds the preview, then
 * embeds it E2EE in the message so the recipient never touches the URL. A PWA
 * can't read a third-party page cross-origin (CORS taints even a canvas read of
 * an og:image), so we route both fetches (the HTML, then the resolved og:image)
 * through the server relay (POST /v1/unfurl, see api.ts `fetchUnfurl`). The
 * server streams raw bytes back unparsed - all parsing and the thumbnail
 * downscale happen here, on-device, so the server stays blind to the preview.
 *
 * Everything here is best-effort: any failure (CORS-less site, bot block, no
 * tags, oversize, timeout) resolves to null and the UI falls back to the
 * existing fetch-free domain-only card.
 */
import { fetchUnfurl } from './api';
import type { LinkPreview } from './crypto/message';

// The single source of truth for URL detection in message bodies (the bubble
// renderer imports this too). Matches an http(s) URL run with no whitespace.
export const LINK_RE = /\bhttps?:\/\/[^\s]+/i;

/** The first http(s) URL in a body, or undefined. */
export function firstLink(body: string): string | undefined {
  return body.match(LINK_RE)?.[0];
}

// Bounds that keep a preview from bloating the E2EE ratchet packet.
const THUMB_MAX_EDGE = 320; // px, longest side of the downscaled thumbnail
const THUMB_QUALITY = 0.6; // JPEG quality, matching video posters
const MAX_IMAGE_DATAURL = 60_000; // chars (~45 KiB) - drop the image past this
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 300;
const OVERALL_TIMEOUT = 12_000; // ms ceiling for the whole build

/** Hostname without a leading www., or the raw url if it won't parse. */
export function linkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Build a preview for `url`, or null if one can't be produced. Never throws.
 * Bounded by an overall timeout so a slow site can't wedge the background task.
 */
export async function buildLinkPreview(url: string): Promise<LinkPreview | null> {
  return Promise.race([
    buildInner(url).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), OVERALL_TIMEOUT)),
  ]);
}

async function buildInner(url: string): Promise<LinkPreview | null> {
  const res = await fetchUnfurl(url, false);
  if (!res) return null;
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const title = clamp(
    metaContent(doc, 'og:title') ?? metaContent(doc, 'twitter:title') ?? (doc.title || undefined),
    MAX_TITLE,
  );
  const description = clamp(
    metaContent(doc, 'og:description') ??
      metaContent(doc, 'twitter:description') ??
      doc.querySelector('meta[name="description"]')?.getAttribute('content') ??
      undefined,
    MAX_DESCRIPTION,
  );
  const domain = metaContent(doc, 'og:site_name') || linkDomain(url);

  const preview: LinkPreview = { url, domain };
  if (title) preview.title = title;
  if (description) preview.description = description;

  // Resolve and downscale the preview image (best-effort - the card still works
  // as a meta-only card if this fails or is absent).
  const rawImage =
    metaContent(doc, 'og:image') ??
    metaContent(doc, 'og:image:url') ??
    metaContent(doc, 'twitter:image') ??
    faviconHref(doc);
  if (rawImage) {
    const thumb = await buildThumbnail(rawImage, url).catch(() => undefined);
    if (thumb && thumb.dataUrl.length <= MAX_IMAGE_DATAURL) {
      preview.image = thumb.dataUrl;
      preview.imageWidth = thumb.width;
      preview.imageHeight = thumb.height;
    }
  }

  // A card with nothing but a domain adds no value over the fetch-free fallback.
  if (!preview.title && !preview.description && !preview.image) return null;
  return preview;
}

/** content of <meta property="..."> (Open Graph) or <meta name="..."> (Twitter). */
function metaContent(doc: Document, key: string): string | undefined {
  const el =
    doc.querySelector(`meta[property="${key}"]`) ?? doc.querySelector(`meta[name="${key}"]`);
  return el?.getAttribute('content')?.trim() || undefined;
}

/** Best favicon link from the document head, resolved later against the page URL. */
function faviconHref(doc: Document): string | undefined {
  const el =
    doc.querySelector('link[rel="apple-touch-icon"]') ??
    doc.querySelector('link[rel="icon"]') ??
    doc.querySelector('link[rel="shortcut icon"]');
  return el?.getAttribute('href')?.trim() || undefined;
}

function clamp(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/**
 * Fetch the image bytes through the relay and downscale to a small JPEG data URL
 * via canvas (same approach as the video-poster generator in media-meta.ts).
 */
async function buildThumbnail(
  rawImage: string,
  pageUrl: string,
): Promise<{ dataUrl: string; width: number; height: number } | undefined> {
  let abs: URL;
  try {
    abs = new URL(rawImage, pageUrl); // resolve relative paths against the page
  } catch {
    return undefined;
  }
  if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return undefined;

  const res = await fetchUnfurl(abs.href, true);
  if (!res) return undefined;
  const blob = await res.blob();

  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d');
    if (!cx) return undefined;
    cx.drawImage(bitmap, 0, 0, w, h);
    return { dataUrl: c.toDataURL('image/jpeg', THUMB_QUALITY), width: w, height: h };
  } finally {
    bitmap.close();
  }
}
