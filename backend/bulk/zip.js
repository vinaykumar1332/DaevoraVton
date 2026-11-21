// Reads a ZIP of product and model photos. Nothing is written to disk here; the caller decides where images go.
import JSZip from 'jszip';
import crypto from 'node:crypto';
import path from 'node:path';
import { LIMITS, IMAGE_EXTENSIONS, MAX_BULK_IMAGES } from './config.js';

export class BulkError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const MAGIC = {
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  webp: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Width and height read from the image header, or null when the header is not understood. */
export function imageSize(b, type) {
  if (type === 'png') return b.length >= 24 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
  if (type === 'jpeg') {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (SOF.has(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  if (type === 'webp') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ' && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && b.length >= 25) {
      const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    if (chunk === 'VP8X' && b.length >= 30) return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  return null;
}

function assertSafePath(entryName) {
  const normal = entryName.replace(/\\/g, '/');
  if (normal.startsWith('/') || /^[A-Za-z]:/.test(normal) || normal.split('/').some((p) => p === '..')) {
    throw new BulkError('UnsafePath', `The archive has an unsafe file path: ${entryName}`);
  }
  return normal;
}

/** A name safe to use as a file name: no folders, no path tricks. */
export function cleanBaseName(entryName) {
  return path.posix.basename(assertSafePath(entryName));
}

/**
 * Checks every name in the ZIP's central directory before parsing. JSZip rewrites unsafe names
 * on load (a "../" entry turns into a plain file), so the raw names are read here first.
 */
export function assertArchiveNames(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return; // not a ZIP; JSZip reports it as corrupt
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) {
    throw new BulkError('UnsupportedArchive', 'This ZIP format is not supported. Re-create the ZIP with a standard tool.');
  }
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new BulkError('CorruptArchive', 'The ZIP directory is damaged.');
    const n = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + n);
    assertSafePath(name);
    p += 46 + n + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
}

const isSkipped = (name) => name.startsWith('__MACOSX/') || path.posix.basename(name).startsWith('.');

/**
 * Extracts the images from a ZIP buffer.
 * Returns { images: [{ name, bytes, type, width, height, sha256 }], rejected: [{ name, reason }] }.
 * Throws BulkError when the archive as a whole cannot be used (corrupt, unsafe, too big, too many images).
 */
export async function extractImages(buffer) {
  if (buffer.length > LIMITS.zipBytes) throw new BulkError('ZipTooLarge', 'The ZIP is too large. The limit is 60 MB.', 413);
  assertArchiveNames(buffer);
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new BulkError('CorruptArchive', 'The file is not a valid ZIP archive.');
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir && !isSkipped(f.name));
  if (Object.keys(zip.files).length > LIMITS.entries) throw new BulkError('TooManyFiles', `The ZIP has too many files. The limit is ${LIMITS.entries}.`);

  let total = 0;
  const images = [];
  const rejected = [];
  const seenNames = new Set();
  const seenHashes = new Map();

  for (const entry of entries) {
    const name = cleanBaseName(entry.name);
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (!IMAGE_EXTENSIONS.has(ext)) {
      rejected.push({ name, reason: 'Not a JPG, PNG or WEBP image' });
      continue;
    }
    const declared = entry._data?.uncompressedSize;
    if (typeof declared === 'number' && total + declared > LIMITS.uncompressedBytes) {
      throw new BulkError('ArchiveTooLarge', 'The ZIP expands to too much data. Use smaller images.', 413);
    }
    const bytes = Buffer.from(await entry.async('uint8array'));
    total += bytes.length;
    if (total > LIMITS.uncompressedBytes) throw new BulkError('ArchiveTooLarge', 'The ZIP expands to too much data. Use smaller images.', 413);

    if (bytes.length > LIMITS.imageBytes) {
      rejected.push({ name, reason: 'Image is larger than 25 MB' });
      continue;
    }
    const type = ['jpg', 'jpeg'].includes(ext) ? 'jpeg' : ext;
    if (!MAGIC[type]?.(bytes)) {
      rejected.push({ name, reason: 'File content does not match its extension (corrupted or renamed)' });
      continue;
    }
    const size = imageSize(bytes, type);
    if (!size || !size.width || !size.height) {
      rejected.push({ name, reason: 'Image header could not be read' });
      continue;
    }
    const short = Math.min(size.width, size.height);
    const long = Math.max(size.width, size.height);
    if (short < LIMITS.minSide || long > LIMITS.maxSide) {
      rejected.push({ name, reason: `Image size ${size.width}×${size.height} is outside ${LIMITS.minSide}–${LIMITS.maxSide} px` });
      continue;
    }
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (seenHashes.has(sha256)) {
      rejected.push({ name, reason: `Duplicate of ${seenHashes.get(sha256)}` });
      continue;
    }
    if (seenNames.has(name)) {
      rejected.push({ name, reason: 'Two files have the same name in different folders' });
      continue;
    }
    seenNames.add(name);
    seenHashes.set(sha256, name);
    images.push({ name, bytes, type, width: size.width, height: size.height, sha256 });
  }

  if (images.length > MAX_BULK_IMAGES) {
    throw new BulkError('TooManyImages', `This ZIP has ${images.length} valid images. The limit is ${MAX_BULK_IMAGES} per batch.`);
  }
  return { images, rejected };
}
