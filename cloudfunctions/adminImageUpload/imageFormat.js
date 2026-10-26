const MAX_PIXELS = 40000000

function dimensions(width, height) {
  return width > 0 && height > 0 && width * height <= MAX_PIXELS
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// Detect the actual binary container, including lengths and required image markers.
// This is format validation, not a claim to decode every compressed pixel or moderate content.
function detectImageType(bytes) {
  if (!Buffer.isBuffer(bytes)) return ""
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    let offset = 8
    let header = false
    let image = false
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset)
      if (length > bytes.length - offset - 12) return ""
      const type = bytes.toString("ascii", offset + 4, offset + 8)
      if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) return ""
      if (!header) {
        if (type !== "IHDR" || length !== 13 || !dimensions(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12))) return ""
        header = true
      } else if (type === "IHDR") return ""
      if (type === "IDAT" && length) image = true
      offset += length + 12
      if (type === "IEND") return length === 0 && image && offset === bytes.length ? "png" : ""
    }
    return ""
  }
  if (bytes.length >= 12 && bytes.readUInt16BE(0) === 0xffd8 && bytes.readUInt16BE(bytes.length - 2) === 0xffd9) {
    let offset = 2
    let frame = false
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) return ""
      while (bytes[offset] === 0xff) offset += 1
      const marker = bytes[offset++]
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length - 2) return ""
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8 || !dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))) return ""
        frame = true
      }
      if (marker === 0xda) return frame && offset + length < bytes.length - 2 ? "jpg" : ""
      offset += length
    }
    return ""
  }
  if (bytes.length >= 26 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) === bytes.length - 8) {
    let offset = 12
    let image = false
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString("ascii", offset, offset + 4)
      const length = bytes.readUInt32LE(offset + 4)
      const start = offset + 8
      if (length > bytes.length - start) return ""
      if (type === "VP8 " && length >= 10 && bytes.subarray(start + 3, start + 6).equals(Buffer.from("9d012a", "hex"))) {
        image = dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff)
      } else if (type === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
        const bits = bytes.readUInt32LE(start + 1)
        image = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
      }
      offset = start + length + (length % 2)
    }
    return image && offset === bytes.length ? "webp" : ""
  }
  return ""
}

function imageType(bytes) {
  try { return detectImageType(bytes) } catch (error) { return "" }
}

module.exports = { imageType }
