/** Builders for tiny audio files that carry an embedded cover.
 *
 *  Shared by the Vitest unit tests for the cover extractor and by the
 *  sandbox UI test, so both exercise the same bytes. Everything here is
 *  generated rather than checked in as a binary: a few hundred bytes of
 *  hand-written tag structure is easier to review than an opaque blob.
 */

/** Smallest valid PNG: a 1x1 opaque red pixel. */
export function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

/** Smallest valid JPEG: a 1x1 grey pixel. */
export function tinyJpeg() {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );
}

/** Silent MPEG-1 Layer III frames, so a decoder (and music-metadata's MPEG
 *  parser) sees real audio after the tag. Each frame is 1152 samples at
 *  44.1kHz, so about 26ms: a browser test that plays the file wants a few
 *  hundred of them, or it ends mid-test and the player advances. */
function mpegFrames(count = 8) {
  // 0xFF 0xFB: sync + MPEG-1 Layer III, no CRC. 0x90: 128kbps, 44.1kHz.
  // 0x00: stereo, no padding. 128kbps at 44.1kHz is a 417-byte frame.
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x00;
  return Buffer.concat(Array.from({ length: count }, () => frame));
}

/** ID3v2.3 sizes are "syncsafe": 7 bits per byte, top bit always clear. */
function syncsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function id3Frame(id, body) {
  const header = Buffer.alloc(10);
  header.write(id, 0, 'ascii');
  // v2.3 frame sizes are plain big-endian, unlike the tag size above.
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** MP3 with an ID3v2.3 APIC (attached picture) frame, plus a TIT2 title so
 *  the file looks like something a real tagger produced. */
export function makeMp3WithApic({ image = tinyJpeg(), mime = 'image/jpeg', title = 'Cover Song', frames = 8 } = {}) {
  const apic = id3Frame(
    'APIC',
    Buffer.concat([
      Buffer.from([0x00]), // ISO-8859-1 text encoding
      Buffer.from(mime, 'ascii'),
      Buffer.from([0x00]),
      Buffer.from([0x03]), // picture type: cover (front)
      Buffer.from([0x00]), // empty description
      image,
    ]),
  );
  const tit2 = id3Frame('TIT2', Buffer.concat([Buffer.from([0x00]), Buffer.from(title, 'ascii'), Buffer.from([0x00])]));
  const tag = Buffer.concat([tit2, apic]);
  const header = Buffer.concat([
    Buffer.from('ID3', 'ascii'),
    Buffer.from([0x03, 0x00]), // v2.3.0
    Buffer.from([0x00]), // no flags
    syncsafe(tag.length),
  ]);
  return Buffer.concat([header, tag, mpegFrames(frames)]);
}

/** MP3 with an ID3v2.3 tag that carries no picture at all. */
export function makeMp3WithoutPicture({ title = 'Bare Song' } = {}) {
  const tit2 = id3Frame('TIT2', Buffer.concat([Buffer.from([0x00]), Buffer.from(title, 'ascii'), Buffer.from([0x00])]));
  const header = Buffer.concat([
    Buffer.from('ID3', 'ascii'),
    Buffer.from([0x03, 0x00]),
    Buffer.from([0x00]),
    syncsafe(tit2.length),
  ]);
  return Buffer.concat([header, tit2, mpegFrames()]);
}

function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, body]);
}

/** A "full box" carries a version byte and three flag bytes before its body. */
function fullBox(type, version, flags, ...parts) {
  return box(type, Buffer.from([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...parts);
}

/** M4A with an iTunes-style `covr` atom under moov/udta/meta/ilst. */
export function makeM4aWithCovr({ image = tinyPng(), png = true } = {}) {
  const ftyp = box(
    'ftyp',
    Buffer.from('M4A ', 'ascii'),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from('M4A mp42isom', 'ascii'),
  );
  // The `data` atom's version byte doubles as a type indicator: 13 = JPEG,
  // 14 = PNG. Everything else in those four bytes is zero.
  const data = fullBox('data', 0x00, png ? 14 : 13, Buffer.alloc(4), image);
  const ilst = box('ilst', box('covr', data));
  const hdlr = fullBox(
    'hdlr',
    0,
    0,
    Buffer.alloc(4),
    Buffer.from('mdirappl', 'ascii'),
    Buffer.alloc(9),
  );
  const meta = fullBox('meta', 0, 0, hdlr, ilst);
  const moov = box('moov', mvhd(), box('udta', meta));
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.alloc(64))]);
}

/** Minimal movie header: parsers read the timescale and duration from it. */
function mvhd() {
  const body = Buffer.alloc(100);
  body.writeUInt32BE(600, 12); // timescale
  body.writeUInt32BE(600, 16); // duration: one second
  body.writeUInt32BE(0x00010000, 20); // rate 1.0
  body.writeUInt16BE(0x0100, 24); // volume 1.0
  // Unity matrix, which some parsers insist on seeing.
  body.writeUInt32BE(0x00010000, 36);
  body.writeUInt32BE(0x00010000, 52);
  body.writeUInt32BE(0x40000000, 68);
  return fullBox('mvhd', 0, 0, body);
}

/** M4A with no cover atom at all. */
export function makeM4aWithoutCovr() {
  const ftyp = box(
    'ftyp',
    Buffer.from('M4A ', 'ascii'),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from('M4A mp42isom', 'ascii'),
  );
  return Buffer.concat([ftyp, box('moov', mvhd()), box('mdat', Buffer.alloc(64))]);
}

/** FLAC carrying a METADATA_BLOCK_PICTURE. STREAMINFO must come first and is
 *  the only block a decoder actually requires. */
export function makeFlacWithPicture({ image = tinyPng(), mime = 'image/png' } = {}) {
  const streamInfo = Buffer.alloc(34);
  streamInfo.writeUInt16BE(4096, 0); // min block size
  streamInfo.writeUInt16BE(4096, 2); // max block size
  // Sample rate 44100, 2 channels, 16 bits, 0 total samples: bits 20/3/5/36
  // packed across bytes 10..17.
  streamInfo[10] = 0x0a;
  streamInfo[11] = 0xc4;
  streamInfo[12] = 0x42;
  streamInfo[13] = 0xf0;

  const desc = Buffer.alloc(0);
  const picture = Buffer.concat([
    uint32(3), // picture type: cover (front)
    uint32(mime.length),
    Buffer.from(mime, 'ascii'),
    uint32(desc.length),
    desc,
    uint32(1), // width
    uint32(1), // height
    uint32(24), // colour depth
    uint32(0), // indexed colours
    uint32(image.length),
    image,
  ]);

  return Buffer.concat([
    Buffer.from('fLaC', 'ascii'),
    metaBlock(0, streamInfo, false),
    metaBlock(6, picture, true),
    // A frame header, so the file is not just metadata.
    Buffer.from([0xff, 0xf8, 0xc9, 0x08, 0x00, 0x00, 0x00, 0x00]),
  ]);
}

function uint32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function metaBlock(type, body, last) {
  const header = Buffer.alloc(4);
  header[0] = (last ? 0x80 : 0x00) | type;
  header.writeUIntBE(body.length, 1, 3);
  return Buffer.concat([header, body]);
}
