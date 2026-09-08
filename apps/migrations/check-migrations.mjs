#!/usr/bin/env node
// Validates apps/migrations/ integrity. Run from the repo root or the migrations dir.
// Exit 0 = clean. Exit 1 = one or more errors printed to stderr.
//
// Two checks:
//   1. manifest.txt must list every .sql file in this directory — no extras, no gaps.
//   2. Numbered migrations (NNNN_*.sql) must form a gap-free sequence with no new
//      duplicate numbers. The known historical 0009 duplicate is grandfathered below.

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));

// 0009 exists twice on disk (bio_credentials + roster_address_fields) — both deployed.
// List any other grandfathered duplicate numbers here if history repeats itself.
const KNOWN_DUPLICATE_NUMBERS = new Set([9]);

function migrationNumber(filename) {
  const m = filename.match(/^(\d{4})_/);
  return m ? parseInt(m[1], 10) : null;
}

const manifestPath = resolve(dir, 'manifest.txt');
const manifestEntries = readFileSync(manifestPath, 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

const diskFiles = readdirSync(dir)
  .filter(f => f.endsWith('.sql'))
  .sort();

let errors = 0;
function fail(msg) { console.error(`FAIL: ${msg}`); errors++; }

// Check 1: manifest ↔ directory
const manifestSet = new Set(manifestEntries);
const diskSet = new Set(diskFiles);

for (const f of diskFiles) {
  if (!manifestSet.has(f)) fail(`"${f}" is on disk but missing from manifest.txt`);
}
for (const f of manifestEntries) {
  if (!diskSet.has(f)) fail(`"${f}" is in manifest.txt but not on disk`);
}

// Check 2: numbered migrations — no new duplicates, no gaps
const numbered = manifestEntries.filter(f => /^\d{4}_/.test(f));
const byNumber = new Map();
for (const f of numbered) {
  const n = migrationNumber(f);
  if (!byNumber.has(n)) byNumber.set(n, []);
  byNumber.get(n).push(f);
}

for (const [n, files] of byNumber) {
  if (files.length > 1 && !KNOWN_DUPLICATE_NUMBERS.has(n)) {
    fail(`Duplicate migration number ${String(n).padStart(4, '0')}: ${files.join(', ')}`);
  }
}

const numbers = [...byNumber.keys()].sort((a, b) => a - b);
const min = numbers[0];
const max = numbers[numbers.length - 1];
for (let i = min; i <= max; i++) {
  if (!byNumber.has(i)) fail(`Gap in migration sequence: ${String(i).padStart(4, '0')} is missing`);
}

if (errors === 0) {
  const range = `${String(min).padStart(4, '0')}–${String(max).padStart(4, '0')}`;
  console.log(`OK: ${diskFiles.length} migrations, sequence ${range}, manifest in sync`);
  process.exit(0);
} else {
  console.error(`${errors} error(s) — fix them or update manifest.txt before merging`);
  process.exit(1);
}
