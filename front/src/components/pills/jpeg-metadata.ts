// Canvas encoders differ: WebKit adds EXIF even when the source was redrawn.
// Strip metadata from the encoded JPEG, after orientation has been applied to
// pixels. Keep the ICC profile (APP2) and compressed image data unchanged.
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const invalid = () => new Error("사진을 처리하지 못했어요. 다른 사진으로 다시 시도해주세요.");
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw invalid();
  const parts = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.length - 2) {
    const start = offset;
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (length < 2 || offset + length > bytes.length - 2) throw invalid();
    if (marker === 0xda) {
      parts.push(bytes.subarray(start));
      const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let at = 0;
      for (const part of parts) { result.set(part, at); at += part.length; }
      return result;
    }
    // APP1 (EXIF/XMP), APP13 (IPTC), and JPEG comments may contain metadata.
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) {
      parts.push(bytes.subarray(start, offset + length));
    }
    offset += length;
  }
  throw invalid();
}
