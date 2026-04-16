/**
 * Generate observation snapshots for entry-based ground-truth fixtures.
 *
 * For each fixture, runs the parser pipeline (analyzeReactFile, extractJsxObservations,
 * analyzeTestFile) and writes the intermediate observations to observations.json
 * alongside the manifest. The accuracy tests then deserialize these snapshots
 * instead of re-parsing, eliminating ts-morph overhead from the timed test.
 *
 * Usage: npx tsx scripts/AST/__tests__/snapshot-observations.ts [--check]
 *   --check: verify snapshots are fresh (exit 1 if stale), do not write
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { analyzeReactFile } from '../ast-react-inventory';
import { extractJsxObservations } from '../ast-jsx-analysis';
import { analyzeTestFile } from '../ast-test-analysis';

const FIXTURES_DIR = path.resolve(__dirname, '../ground-truth/fixtures');

type EntryTool = 'effects' | 'hooks' | 'ownership' | 'template' | 'test-quality' | 'dead-code';

interface EntryManifest {
  tool: EntryTool;
  files: string[];
}

// Tools that use ts-morph parsing and benefit from observation snapshots.
// dead-code uses import graphs (not easily serializable) and is fast enough.
const SNAPSHOT_TOOLS = new Set<EntryTool>(['effects', 'hooks', 'ownership', 'template', 'test-quality']);

function isTestFilePath(filePath: string): boolean {
  return /\.(spec|test)\.(ts|tsx)$/.test(filePath);
}

interface ObservationSnapshot {
  generatedAt: string;
  tool: EntryTool;
  files: Record<string, unknown>;
}

/** Replace absolute temp dir paths with a stable placeholder in observation data. */
function relativizePaths(data: unknown, tmpDir: string): unknown {
  const json = JSON.stringify(data);
  const escaped = tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return JSON.parse(json.replace(new RegExp(escaped + '/', 'g'), '<fixture>/'));
}

function generateSnapshot(fixtureDir: string, manifest: EntryManifest): ObservationSnapshot {
  const basePath = path.join(FIXTURES_DIR, fixtureDir);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `ast-snapshot-${fixtureDir}-`));

  try {
    // Copy fixture files to temp dir
    for (const f of manifest.files) {
      const targetPath = path.join(tmpDir, f);
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.copyFileSync(path.join(basePath, f), targetPath);
    }

    const filesToAnalyze =
      manifest.tool === 'test-quality' ? manifest.files.filter(f => isTestFilePath(f)) : manifest.files;

    const files: Record<string, unknown> = {};

    for (const f of filesToAnalyze) {
      const filePath = path.join(tmpDir, f);

      switch (manifest.tool) {
        case 'effects': {
          const inventory = analyzeReactFile(filePath);
          files[f] = {
            effectObservations: inventory.components.flatMap(c => c.effectObservations),
          };
          break;
        }
        case 'hooks': {
          const inventory = analyzeReactFile(filePath);
          files[f] = {
            hookObservations: inventory.hookObservations,
          };
          break;
        }
        case 'ownership': {
          const inventory = analyzeReactFile(filePath);
          files[f] = {
            hookObservations: inventory.hookObservations,
            componentObservations: inventory.componentObservations,
          };
          break;
        }
        case 'template': {
          const observations = extractJsxObservations(filePath);
          files[f] = { observations };
          break;
        }
        case 'test-quality': {
          const analysis = analyzeTestFile(filePath);
          files[f] = {
            observations: analysis.observations,
            subjectPath: analysis.subjectPath,
            subjectExists: analysis.subjectExists,
          };
          break;
        }
      }
    }

    return {
      generatedAt: new Date().toISOString().slice(0, 10),
      tool: manifest.tool,
      files: relativizePaths(files, tmpDir) as Record<string, unknown>,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main(): void {
  const checkOnly = process.argv.includes('--check');
  let staleCount = 0;
  let generatedCount = 0;

  const dirs = fs.readdirSync(FIXTURES_DIR).filter(d => {
    const manifestPath = path.join(FIXTURES_DIR, d, 'manifest.json');
    return fs.existsSync(manifestPath);
  });

  for (const d of dirs) {
    const manifestPath = path.join(FIXTURES_DIR, d, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as EntryManifest;

    if (!SNAPSHOT_TOOLS.has(manifest.tool)) continue;

    const snapshotPath = path.join(FIXTURES_DIR, d, 'observations.json');
    const snapshot = generateSnapshot(d, manifest);

    if (checkOnly) {
      if (!fs.existsSync(snapshotPath)) {
        console.error(`MISSING: ${d}/observations.json`);
        staleCount++;
        continue;
      }
      const existing = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as ObservationSnapshot;
      // Compare file entries (ignore generatedAt)
      const existingKeys = Object.keys(existing.files).sort().join(',');
      const newKeys = Object.keys(snapshot.files).sort().join(',');
      if (existingKeys !== newKeys) {
        console.error(`STALE (files changed): ${d}/observations.json`);
        staleCount++;
      } else {
        // Deep compare observations
        const existingJson = JSON.stringify(existing.files);
        const newJson = JSON.stringify(snapshot.files);
        if (existingJson !== newJson) {
          console.error(`STALE (observations changed): ${d}/observations.json`);
          staleCount++;
        }
      }
    } else {
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n');
      generatedCount++;
      console.log(`Generated: ${d}/observations.json`);
    }
  }

  if (checkOnly) {
    if (staleCount > 0) {
      console.error(`\n${staleCount} stale snapshot(s). Run: npx tsx scripts/AST/__tests__/snapshot-observations.ts`);
      process.exit(1);
    }
    console.log('All observation snapshots are fresh.');
  } else {
    console.log(`\nGenerated ${generatedCount} observation snapshot(s).`);
  }
}

main();
