/* BEACN DRep — in-browser integrity verifier.
 *
 * The point of this file: a visitor should never have to take BEACN's word for anything. Every
 * check below runs entirely in YOUR browser, against bytes fetched from this site, with no server
 * and no third-party script. If BEACN tampered with a decision after the fact — softened a
 * rationale, swapped the doctrine, edited the evidence a vote was based on — these checks break.
 *
 * Three independent things get proven:
 *
 *   1. ANCHOR    blake2b-256(rationale.md) === the anchor hash BEACN put ON-CHAIN in its vote tx.
 *                The chain is the witness. If the published reasoning is not byte-identical to what
 *                was committed at vote time, the hash will not match — and it cannot be quietly
 *                fixed, because the on-chain anchor is immutable.
 *
 *   2. BUNDLE    sha256 of {action, resource_snapshots, soul_commit, soul_text_hash,
 *                resource_registry_commit} === the manifest's snapshot_bundle_hash. This binds the
 *                decision to the exact doctrine commit and the exact hash of every evidence file
 *                fed to the engine. Change any input file's hash, or point at a different doctrine,
 *                and the bundle hash breaks.
 *
 *   3. INPUT     sha256(action) === the manifest's input_hash — the specific on-chain action data
 *                the engine actually scored.
 *
 * A note on hashing parity, because it is the whole ballgame: the engine hashes with Python's
 * json.dumps(sort_keys=True), which escapes every non-ASCII character (₳ becomes ₳) and, in
 * its default form, puts spaces after ':' and ','. JavaScript's JSON.stringify does neither. A
 * naive JSON.stringify here would disagree with the engine on every proposal whose title contains
 * an ada sign — which is most of them — and the verifier would cry tamper on honest data. So
 * pyJson() below reimplements Python's serialiser exactly. It is tested for byte-parity against
 * every published manifest (scripts/test_verify_parity.mjs); if it ever drifts, that test fails
 * loudly rather than this page lying quietly.
 */

/* ---------- BLAKE2b-256 (RFC 7693), pure JS. Cardano anchors are blake2b, not sha256, and
              SubtleCrypto does not implement it — so we do, rather than pull in a CDN script
              that could be swapped under us and defeat the entire point of this file. ---------- */
const B2B_IV = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);
const B2B_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

const v = new Uint32Array(32);
const m = new Uint32Array(32);

function add64(a, b) {          // 64-bit add on (lo,hi) pairs held as two u32 slots
  const o0 = v[a] + v[b], o1 = v[a + 1] + v[b + 1] + (o0 >= 0x100000000 ? 1 : 0);
  v[a] = o0; v[a + 1] = o1;
}
function addConst64(a, lo, hi) {
  const o0 = v[a] + lo, o1 = v[a + 1] + hi + (o0 >= 0x100000000 ? 1 : 0);
  v[a] = o0; v[a + 1] = o1;
}
function xor64(a, b) { v[a] ^= v[b]; v[a + 1] ^= v[b + 1]; }
function rotr64(a, bits) {
  const lo = v[a], hi = v[a + 1];
  let nlo, nhi;
  if (bits === 32) { nlo = hi; nhi = lo; }
  else if (bits < 32) { nlo = (lo >>> bits) | (hi << (32 - bits)); nhi = (hi >>> bits) | (lo << (32 - bits)); }
  else { const b = bits - 32; nlo = (hi >>> b) | (lo << (32 - b)); nhi = (lo >>> b) | (hi << (32 - b)); }
  v[a] = nlo >>> 0; v[a + 1] = nhi >>> 0;
}
function G(a, b, c, d, ix, iy) {
  add64(a, b); addConst64(a, m[ix], m[ix + 1]);
  xor64(d, a); rotr64(d, 32);
  add64(c, d); xor64(b, c); rotr64(b, 24);
  add64(a, b); addConst64(a, m[iy], m[iy + 1]);
  xor64(d, a); rotr64(d, 16);
  add64(c, d); xor64(b, c); rotr64(b, 63);
}

function compress(ctx, last) {
  for (let i = 0; i < 16; i++) { v[i] = ctx.h[i]; v[i + 16] = B2B_IV[i]; }
  v[24] = (v[24] ^ ctx.t) >>> 0;                       // low word of the byte counter
  v[25] = (v[25] ^ (ctx.t / 0x100000000)) >>> 0;       // high word
  if (last) { v[28] = ~v[28] >>> 0; v[29] = ~v[29] >>> 0; }

  for (let i = 0; i < 32; i++) {
    const j = i * 4;
    m[i] = ctx.b[j] ^ (ctx.b[j + 1] << 8) ^ (ctx.b[j + 2] << 16) ^ (ctx.b[j + 3] << 24);
  }
  for (let r = 0; r < 12; r++) {
    const s = B2B_SIGMA[r];
    G(0, 8, 16, 24, s[0] * 2, s[1] * 2);
    G(2, 10, 18, 26, s[2] * 2, s[3] * 2);
    G(4, 12, 20, 28, s[4] * 2, s[5] * 2);
    G(6, 14, 22, 30, s[6] * 2, s[7] * 2);
    G(0, 10, 20, 30, s[8] * 2, s[9] * 2);
    G(2, 12, 22, 24, s[10] * 2, s[11] * 2);
    G(4, 14, 16, 26, s[12] * 2, s[13] * 2);
    G(6, 8, 18, 28, s[14] * 2, s[15] * 2);
  }
  for (let i = 0; i < 16; i++) ctx.h[i] = (ctx.h[i] ^ v[i] ^ v[i + 16]) >>> 0;
}

/** blake2b-256 of a byte array -> lowercase hex. This is the hash Cardano anchors use. */
export function blake2b256Hex(input) {
  const ctx = { b: new Uint8Array(128), h: new Uint32Array(16), t: 0, c: 0 };
  ctx.h.set(B2B_IV);
  ctx.h[0] ^= 0x01010000 ^ 32;                          // no key, 32-byte digest

  for (let i = 0; i < input.length; i++) {
    if (ctx.c === 128) { ctx.t += ctx.c; compress(ctx, false); ctx.c = 0; }
    ctx.b[ctx.c++] = input[i];
  }
  ctx.t += ctx.c;
  while (ctx.c < 128) ctx.b[ctx.c++] = 0;               // zero-pad the final block
  compress(ctx, true);

  let out = "";
  for (let i = 0; i < 32; i++) {
    const byte = (ctx.h[i >> 2] >> (8 * (i & 3))) & 0xff;
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/* ---------- SHA-256 via the browser's own crypto. No dependency, no supply chain. ---------- */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- Python-compatible canonical JSON ----------
 * Byte-for-byte equivalent of Python's json.dumps(obj, sort_keys=True[, separators]).
 * `compact` mirrors separators=(",", ":"); omit it for Python's spaced default.
 */
function pyString(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else if (c < 0x7f) out += ch;
    else if (c <= 0xffff) out += "\\u" + c.toString(16).padStart(4, "0");
    else {
      // Python's ensure_ascii emits astral chars as a UTF-16 surrogate pair (emoji flags do this).
      const n = c - 0x10000;
      out += "\\u" + (0xd800 + (n >> 10)).toString(16).padStart(4, "0");
      out += "\\u" + (0xdc00 + (n & 0x3ff)).toString(16).padStart(4, "0");
    }
  }
  return out + '"';
}

export function pyJson(value, compact = false) {
  const colon = compact ? ":" : ": ";
  const comma = compact ? "," : ", ";
  const enc = (val) => {
    if (val === null) return "null";
    if (val === true) return "true";
    if (val === false) return "false";
    if (typeof val === "number") return Number.isInteger(val) ? String(val) : String(val);
    if (typeof val === "string") return pyString(val);
    if (Array.isArray(val)) return "[" + val.map(enc).join(comma) + "]";
    if (typeof val === "object") {
      const keys = Object.keys(val).sort();
      return "{" + keys.map((k) => pyString(k) + colon + enc(val[k])).join(comma) + "}";
    }
    throw new Error("cannot canonicalise " + typeof val);
  };
  return enc(value);
}

const utf8 = (s) => new TextEncoder().encode(s);

/* ---------- The three checks ---------- */

/** Recompute the manifest's own headline hashes from its own contents. */
export async function verifyManifest(manifest) {
  const inputHash = await sha256Hex(utf8(pyJson(manifest.action, false)));
  const bundleHash = await sha256Hex(utf8(pyJson({
    action: manifest.action,
    resource_snapshots: manifest.resource_snapshots,
    soul_commit: manifest.soul_commit,
    soul_text_hash: manifest.soul_text_hash,
    resource_registry_commit: manifest.resource_registry_commit,
  }, true)));

  return {
    input: { ok: inputHash === manifest.input_hash, got: inputHash, want: manifest.input_hash },
    bundle: { ok: bundleHash === manifest.snapshot_bundle_hash, got: bundleHash, want: manifest.snapshot_bundle_hash },
  };
}

/** Prove the rationale you are reading is the one anchored on-chain at vote time. */
export async function verifyAnchor(rationaleBytes, onchainAnchorHash) {
  const got = blake2b256Hex(rationaleBytes);
  return { ok: !!onchainAnchorHash && got === onchainAnchorHash, got, want: onchainAnchorHash || null };
}
