/* Byte-parity test for verify.js against REAL published artifacts.
 *
 * verify.js recomputes, in the visitor's browser, hashes that the Python engine computed. If the
 * two serialisers ever disagree by a single byte, the site would show "TAMPERED" on honest data —
 * destroying the credibility of the one feature that matters most. So we prove parity against every
 * manifest and every anchored rationale actually on disk, not against toy fixtures.
 *
 *   node scripts/test_verify_parity.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { blake2b256Hex, verifyManifest } from "../verify.js";

const RAT = "data/output/public/rationales";
const ANCHORED = "data/output/public/r";

let pass = 0, fail = 0;
const failures = [];

// --- 1. blake2b-256 known-answer test (RFC 7693 / standard vector) ---
const abc = blake2b256Hex(new TextEncoder().encode("abc"));
const ABC_EXPECTED = "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319";
if (abc === ABC_EXPECTED) pass++;
else { fail++; failures.push(`blake2b("abc") = ${abc}\n              want ${ABC_EXPECTED}`); }

// --- 2. Every published manifest must recompute its own input_hash + snapshot_bundle_hash ---
const manifests = readdirSync(RAT).filter((f) => f.endsWith(".manifest.json"));
for (const name of manifests) {
  const manifest = JSON.parse(readFileSync(`${RAT}/${name}`, "utf8"));
  const r = await verifyManifest(manifest);
  if (r.input.ok) pass++;
  else { fail++; failures.push(`${name} input_hash\n  got  ${r.input.got}\n  want ${r.input.want}`); }
  if (r.bundle.ok) pass++;
  else { fail++; failures.push(`${name} snapshot_bundle_hash\n  got  ${r.bundle.got}\n  want ${r.bundle.want}`); }
}

// --- 3. Every anchored rationale is named for its own blake2b hash: /r/<first24hex>.md.
//        That filename is derived from the bytes, so hashing the bytes must reproduce it.
//        This is the same hash that goes on-chain as the vote's anchor-data-hash.
const anchored = readdirSync(ANCHORED).filter((f) => f.endsWith(".md"));
for (const name of anchored) {
  const bytes = readFileSync(`${ANCHORED}/${name}`);
  const got = blake2b256Hex(new Uint8Array(bytes));
  const want = name.replace(/\.md$/, "");
  if (got.startsWith(want)) pass++;
  else { fail++; failures.push(`${name}\n  blake2b = ${got}\n  filename claims ${want}`); }
}

console.log(`manifests: ${manifests.length}   anchored rationales: ${anchored.length}`);
console.log(`checks passed: ${pass}   failed: ${fail}`);
if (fail) {
  console.log("\nFAILURES (first 5):");
  failures.slice(0, 5).forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("\nverify.js reproduces the engine's hashes byte-for-byte on all published artifacts.");
