/**
 * Minimal, dependency-free ID3v2 (.mp3) tag reader: pulls the title, artist and
 * embedded cover art so a shared audio file can be presented like a track. Only
 * ID3v2.3/2.4 text + APIC frames are parsed; anything it can't read (other
 * container formats, missing tags) just comes back empty, and the user fills the
 * gaps in the review sheet before sending.
 */
export interface AudioTags {
  title?: string;
  artist?: string;
  cover?: Blob; // embedded artwork
}

const synchsafe = (b: Uint8Array, o: number): number =>
  (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const uint32 = (b: Uint8Array, o: number): number =>
  (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];

function decodeText(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const enc = bytes[0];
  const body = bytes.subarray(1);
  const label = enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : enc === 3 ? 'utf-8' : 'iso-8859-1';
  try {
    return new TextDecoder(label).decode(body).replace(/\0+$/, '').trim();
  } catch {
    return new TextDecoder('iso-8859-1').decode(body).replace(/\0+$/, '').trim();
  }
}

// APIC: text-encoding(1) · mime(null-term latin1) · pic-type(1) · description
// (null-term in encoding) · picture bytes.
function parsePicture(bytes: Uint8Array): Blob | undefined {
  let i = 1; // skip encoding byte
  const mimeStart = i;
  while (i < bytes.length && bytes[i] !== 0) i++;
  const mime = new TextDecoder('iso-8859-1').decode(bytes.subarray(mimeStart, i)) || 'image/jpeg';
  i++; // null
  i++; // picture type
  const enc = bytes[0];
  if (enc === 1 || enc === 2) {
    while (i + 1 < bytes.length && !(bytes[i] === 0 && bytes[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < bytes.length && bytes[i] !== 0) i++;
    i++;
  }
  if (i >= bytes.length) return undefined;
  const pic = bytes.slice(i); // copy → standalone ArrayBuffer for the Blob
  return new Blob([pic.buffer], { type: mime });
}

export async function readAudioTags(blob: Blob): Promise<AudioTags> {
  try {
    const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
    if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {}; // "ID3"
    const major = head[3];
    const size = synchsafe(head, 6);
    const buf = new Uint8Array(await blob.slice(10, 10 + size).arrayBuffer());
    const tags: AudioTags = {};
    let p = 0;
    while (p + 10 <= buf.length) {
      const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding / end of frames
      const frameSize = major === 4 ? synchsafe(buf, p + 4) : uint32(buf, p + 4);
      const start = p + 10;
      if (frameSize <= 0 || start + frameSize > buf.length) break;
      const frame = buf.subarray(start, start + frameSize);
      if (id === 'TIT2') tags.title = decodeText(frame);
      else if (id === 'TPE1') tags.artist = decodeText(frame);
      else if (id === 'APIC' && !tags.cover) tags.cover = parsePicture(frame);
      p = start + frameSize;
    }
    return tags;
  } catch {
    return {};
  }
}

/** Read an audio blob's duration (seconds) by loading it into an <audio> element. */
export function readAudioDuration(blob: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const d = Number.isFinite(el.duration) ? el.duration : undefined;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    el.src = url;
  });
}
