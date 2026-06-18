#!/usr/bin/env node
/**
 * grale-metrics — measure layout quality of one or more grale result JSONs.
 *
 *   grale-metrics <file...> [--json]
 *
 * One file  : prints the full metrics object (pretty).
 * Many files: prints a comparison table of the headline metrics.
 * --json    : always emit machine-readable JSON ({ file, metrics }[]).
 */
import { readFileSync } from 'node:fs';
import { computeMetrics, type LayoutMetrics } from '../grale/metrics/index.js';
import type { graleGraph } from '../grale/types.js';

function load(file: string): LayoutMetrics {
  return computeMetrics(JSON.parse(readFileSync(file, 'utf8')) as graleGraph);
}

const r = (n: number, d = 0): string => (Number.isFinite(n) ? n.toFixed(d) : '–');
const pad = (s: string, n: number): string => s.padStart(n);

function table(rows: { file: string; m: LayoutMetrics }[]): string {
  const cols: [string, number, (m: LayoutMetrics) => string][] = [
    ['nodes', 5, (m) => String(m.nodes)],
    ['edges', 5, (m) => String(m.edges)],
    ['hyp', 4, (m) => String(m.hyperedges)],
    ['cross', 6, (m) => String(m.crossings.count)],
    ['nOver', 8, (m) => r(m.nodeOverlap.area)],
    ['eLen', 8, (m) => r(m.edgeLength.total)],
    ['enOv', 7, (m) => r(m.edgeNodeOverlap.length)],
    ['bends', 6, (m) => String(m.bends.total)],
    ['area', 9, (m) => r(m.boundingBox.area)],
    ['ar', 5, (m) => r(m.boundingBox.aspectRatio, 2)],
    ['fwd%', 5, (m) => (m.flow ? r(m.flow.forwardRatio * 100) : '–')],
  ];
  const name = Math.max(4, ...rows.map((x) => x.file.length));
  const head = pad('file', name) + '  ' + cols.map(([h, w]) => pad(h, w)).join(' ');
  const body = rows.map(({ file, m }) => pad(file, name) + '  ' + cols.map(([, w, fn]) => pad(fn(m), w)).join(' '));
  return [head, '-'.repeat(head.length), ...body].join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const files = args.filter((a) => !a.startsWith('-'));
  if (!files.length) { process.stderr.write('usage: grale-metrics <file...> [--json]\n'); process.exit(1); }

  const rows = files.map((file) => {
    try { return { file: file.replace(/.*\//, ''), m: load(file) }; }
    catch (e) { console.error(`error: ${file}: ${e instanceof Error ? e.message : String(e)}`); return null; }
  }).filter((x): x is { file: string; m: LayoutMetrics } => x !== null);

  if (asJson) { process.stdout.write(JSON.stringify(rows.map(({ file, m }) => ({ file, metrics: m })), null, 2) + '\n'); return; }
  if (rows.length === 1) { process.stdout.write(JSON.stringify(rows[0].m, null, 2) + '\n'); return; }
  process.stdout.write(table(rows) + '\n');
}

main();
