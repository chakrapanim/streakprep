#!/usr/bin/env node
/**
 * Imports active non-pictorial questions from dqi.db into Cloudflare D1.
 * Run: node scripts/import-questions.mjs
 * Requires: wrangler authenticated, dqi.db at ../dqi.db (relative to /website)
 */
import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DQI_DB    = path.resolve(__dirname, '../../dqi.db');
const TMP_DIR   = path.resolve(__dirname, '../.tmp-import');
const BATCH_SIZE = 400;

const CANONICAL = {
  mathematics:              'mathematics',
  mathematics_part1:        'mathematics',
  mathematics_part2:        'mathematics',
  science:                  'science',
  english:                  'english',
  english_first_flight:     'english',
  english_footprints:       'english',
  english_words_and_expr:   'english',
  hindi:                    'hindi',
  hindi_kritika:            'hindi',
  hindi_kshitij:            'hindi',
  hindi_sanchayan:          'hindi',
  hindi_sparsh:             'hindi',
  social_science_part1:     'social_science',
  social_science_part2:     'social_science',
  civics:                   'social_science',
  economics:                'social_science',
  geography:                'social_science',
  history:                  'social_science',
  // _hi variants excluded (Hindi-medium SS textbooks, not the Hindi language subject)
};

function esc(s) {
  if (s == null) return "''";
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function main() {
  if (!fs.existsSync(DQI_DB)) {
    console.error('dqi.db not found at', DQI_DB);
    process.exit(1);
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });

  console.log('Exporting questions from dqi.db…');
  const tmpJson = path.join(TMP_DIR, 'questions.json');
  execSync(
    `sqlite3 -json "${DQI_DB}" "SELECT id, grade, class_label, subject, chapter_key, concept, question_text, options_json, correct, explanation, difficulty FROM quiz_questions WHERE is_active=1 AND is_pictorial=0" > "${tmpJson}"`,
    { shell: true, maxBuffer: 256 * 1024 * 1024 }
  );

  const rows = JSON.parse(fs.readFileSync(tmpJson, 'utf8'));
  fs.unlinkSync(tmpJson);
  console.log(`Got ${rows.length} rows from dqi.db`);

  // Filter to only subjects we can map
  const mappable = rows.filter(r => CANONICAL[r.subject] != null);
  console.log(`Mappable rows: ${mappable.length}`);

  // Group into batches
  const batches = [];
  for (let i = 0; i < mappable.length; i += BATCH_SIZE) {
    batches.push(mappable.slice(i, i + BATCH_SIZE));
  }
  console.log(`Will run ${batches.length} batches of up to ${BATCH_SIZE} rows`);

  const batchFiles = [];
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    let sql = '';
    for (const r of batch) {
      const opts = JSON.parse(r.options_json || '{}');
      const canon = CANONICAL[r.subject];
      sql += `INSERT OR IGNORE INTO questions VALUES(` +
        [
          esc(r.id),
          r.grade,
          esc(r.class_label),
          esc(r.subject),
          esc(canon),
          esc(r.chapter_key),
          esc(r.concept),
          esc(r.question_text),
          esc(opts.A),
          esc(opts.B),
          esc(opts.C),
          esc(opts.D),
          esc(r.correct),
          esc(r.explanation),
          esc(r.difficulty),
        ].join(',') +
      `);\n`;
    }
    const filePath = path.join(TMP_DIR, `batch_${String(bi).padStart(4,'0')}.sql`);
    fs.writeFileSync(filePath, sql);
    batchFiles.push(filePath);
  }

  console.log(`Batch files written to ${TMP_DIR}`);
  console.log('Uploading to D1…');

  let done = 0;
  for (const file of batchFiles) {
    try {
      execSync(
        `npx wrangler d1 execute streakprep-db --remote --file="${file}"`,
        { stdio: 'pipe', cwd: path.resolve(__dirname, '..') }
      );
      done++;
      if (done % 10 === 0 || done === batchFiles.length) {
        console.log(`  ${done}/${batchFiles.length} batches done`);
      }
    } catch (err) {
      console.error(`Failed on ${file}:`, err.stderr?.toString() || err.message);
      process.exit(1);
    }
  }

  // Cleanup
  for (const f of batchFiles) fs.unlinkSync(f);
  fs.rmdirSync(TMP_DIR, { recursive: true });

  console.log(`\nDone! Imported ${mappable.length} questions into D1.`);
}

main();
