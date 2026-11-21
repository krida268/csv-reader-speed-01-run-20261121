// Driver harness untuk entry csv-reader-speed ini: membaca semua kasus dari
// cases.json, menjawabnya satu per satu dengan run() dari solve.js, lalu
// menulis answers.json. Di luar kontainer, MAKEFUN_INPUT_DIR dan
// MAKEFUN_OUTPUT_DIR menggantikan /input dan /output.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Matikan incremental marking sebelum solve.js dimuat, supaya seluruh kerja
// parser berjalan di bawah pengaturan GC yang sama seperti baseline rumah.
setFlagsFromString('--no-incremental-marking');

// Impor dinamis: solve.js baru boleh dimuat setelah flag V8 di atas terpasang.
const { run } = await import(new URL('./solve.js', import.meta.url).href);

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Baca semua kasus sekaligus, jawab berurutan (urutan answers.json harus sama
// dengan urutan cases.json), lalu tulis sekali di akhir.
const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8'));
const answers = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  answers[i] = run(cases[i].input);
}
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
