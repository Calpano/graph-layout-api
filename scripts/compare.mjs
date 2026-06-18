/**
 * compare — headless layout-quality runs. Lays each named engine out over the
 * given input paths, writing one timestamped snapshot dir per engine under
 * examples/runs/ (see scripts/runner.mjs), then prints a comparison table.
 *
 *   npm run compare -- dagre=dagre cale="cale-cli" ../graph-test-data/json/grale/grale-1.0.0
 *   npm run compare -- cale="cale-cli {}" --label now graph1.json
 *
 * `name=command` defines an engine (command `dagre` or empty = built-in dagre);
 * bare args are input paths; --label <s> tags the run dirs; --json emits JSON.
 * The interactive app (npm run dev) runs engines and compares any two runs.
 */
import { runEngine, loadEngineConfig } from './runner.mjs';

function parseArgs(argv) {
  const engines = [], paths = [];
  let label = '', asJson = false, config = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label') label = argv[++i];
    else if (a === '--json') asJson = true;
    else if (a === '--config') { try { config = JSON.parse(argv[++i]); } catch { console.error('--config must be JSON'); } }
    else if (a.includes('=')) engines.push({ name: a.slice(0, a.indexOf('=')), command: a.slice(a.indexOf('=') + 1) });
    else if (a.startsWith('-')) console.error(`ignoring unknown flag: ${a}`);
    else paths.push(a);
  }
  return { engines, paths, label, asJson, config };
}

// metric, width, better-direction, accessor
const COLS = [
  ['cross', 6, 'lo', (m) => m.crossings.count],
  ['nOverlap', 9, 'lo', (m) => m.nodeOverlap.area],
  ['eLen', 8, 'lo', (m) => m.edgeLength.total],
  ['enOver', 8, 'lo', (m) => m.edgeNodeOverlap.length],
  ['bends', 6, 'lo', (m) => m.bends.total],
  ['area', 9, 'lo', (m) => m.boundingBox.area],
  ['fwd%', 6, 'hi', (m) => (m.flow ? m.flow.forwardRatio * 100 : 0)],
];
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(0));
const pad = (s, n) => String(s).padStart(n);

function main() {
  const { engines: argEngines, paths, label, asJson, config } = parseArgs(process.argv.slice(2));
  const engines = argEngines.length ? argEngines : loadEngineConfig(); // fall back to compare.engines.json
  if (!engines.length) { console.error('usage: compare.mjs <name=command>... <path>... [--label s] [--config json] [--json]  (or configure compare.engines.json)'); process.exit(1); }

  const runs = engines.map((e) => runEngine({ ...e, label, config }, paths));
  if (asJson) { process.stdout.write(JSON.stringify(runs, null, 2) + '\n'); return; }

  // align graphs by name across runs
  const names = [...new Set(runs.flatMap((r) => r.graphs.map((g) => g.name)))].sort();
  const metricOf = (run, name) => run.graphs.find((g) => g.name === name)?.metrics ?? null;

  const nameW = Math.max(8, ...names.map((n) => n.length));
  const engW = Math.max(6, ...runs.map((r) => r.engine.name.length));
  const header = pad('graph', nameW) + ' ' + pad('engine', engW) + '  ' + COLS.map(([h, w]) => pad(h, w)).join(' ');
  console.log('\n' + header);
  console.log('-'.repeat(header.length));
  for (const name of names) {
    runs.forEach((run, idx) => {
      const m = metricOf(run, name);
      console.log(pad(idx === 0 ? name : '', nameW) + ' ' + pad(run.engine.name, engW) + '  ' + COLS.map(([, w, , fn]) => pad(m ? fmt(fn(m)) : '–', w)).join(' '));
    });
  }

  // win/loss/tie of each run vs the first
  if (runs.length > 1) {
    console.log('-'.repeat(header.length));
    const base = runs[0];
    for (const run of runs.slice(1)) {
      const w = COLS.map(() => 0), l = COLS.map(() => 0), t = COLS.map(() => 0);
      for (const name of names) {
        const mb = metricOf(base, name), me = metricOf(run, name);
        if (!mb || !me) continue;
        COLS.forEach(([, , dir, fn], i) => { const b = fn(mb), x = fn(me), better = dir === 'lo' ? x < b : x > b, worse = dir === 'lo' ? x > b : x < b; if (better) w[i]++; else if (worse) l[i]++; else t[i]++; });
      }
      const line = (lbl, arr) => pad(run.engine.name, nameW) + ' ' + pad(lbl, engW) + '  ' + COLS.map(([, cw], i) => pad(arr[i], cw)).join(' ');
      console.log(line('wins', w), '\n' + line('losses', l), '\n' + line('ties', t));
    }
    console.log(`\n(win/loss/tie vs ${base.engine.name})`);
  }

  console.log('\nruns:');
  for (const r of runs) console.log(`  examples/runs/${r.id}`);
  console.log('compare them interactively: npm run dev');
}

main();
