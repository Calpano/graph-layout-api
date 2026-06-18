/**
 * Layout run core — shared by the `compare` CLI and the viewer's dev-server
 * backend. A *run* lays one engine out over a set of input graphs and writes a
 * timestamped snapshot directory:
 *
 *   examples/runs/<id>/
 *     manifest.json          run metadata + per-graph metrics
 *     <graph>.json           the laid-out grale output (loaded by the viewer)
 *     _input/<graph>.json    the exact grale fed to the engine
 *
 * dagre is the built-in engine (command null / "dagre"); any other engine is a
 * command reading grale JSON on stdin (or `{}` = input file path) and writing
 * grale JSON on stdout. Non-grale inputs are converted via GRAPHINOUT.
 */
import dagre from '@dagrejs/dagre';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { computeMetrics } from '../dist/grale/metrics/index.js';

// Where snapshot runs are persisted. On disk, gitignored, and read fresh on
// every request, so runs survive server restarts. Point it at any persistent
// location with GRALE_RUNS.
export const RUNS_ROOT = process.env.GRALE_RUNS ?? 'examples/runs';
export const DEFAULT_INPUTS =
  process.env.GRAPH_TEST_DATA ?? '../graph-test-data/json/grale/grale-1.0.0';
// graph-test-data repo root (for browsing) and the graphinout `gio` launcher.
export const BROWSE_ROOT = process.env.GRAPH_TEST_DATA_ROOT ?? '../graph-test-data';
const GIO = process.env.GIO ?? '../../GitHubOld/graphinout/cli/bin/gio';
const CATEGORIES = new Set(['json', 'xml', 'text', 'binary']);

// --- format from path (graph-test-data convention) -------------------------

/** The format *family* from a graph-test-data path `/<category>/<family>/…`,
 * e.g. `xml/graphml/foo.graphml` → `graphml`, `json/grale/grale-1.0.0/x.json`
 * → `grale`. null when the path doesn't follow the convention. */
export function formatFamily(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  const ci = parts.findIndex((s) => CATEGORIES.has(s));
  return ci >= 0 && parts[ci + 1] ? parts[ci + 1] : null;
}

function isNativeGrale(p) {
  const fam = formatFamily(p);
  if (fam) return fam === 'grale' || fam.startsWith('grale-');
  const lp = p.toLowerCase();
  return lp.endsWith('.grale') || lp.endsWith('.grale.json') || lp.endsWith('.json');
}

const hasConverter = () => !!process.env.GRAPHINOUT || existsSync(GIO);

// --- input discovery & loading ---------------------------------------------

function listInputFiles(p) {
  if (statSync(p).isFile()) return [p];
  const conv = hasConverter();
  return readdirSync(p)
    .filter((f) => !(f.startsWith('.') || f === 'manifest.json' || f === 'meta.ddot' || f.endsWith('.ddot') || f.endsWith('.adoc') || f.endsWith('.md')))
    .filter((f) => !/--INVALID/i.test(f)) // skip intentionally-broken test files
    .map((f) => join(p, f))
    .filter((fp) => statSync(fp).isFile() && (isNativeGrale(fp) || conv))
    .sort();
}

/** Convert a non-grale file to grale JSON text via graphinout. GRAPHINOUT (a
 * `cmd {}`/stdin converter) overrides the default `gio convert {} --to grale`. */
function convertToGrale(path) {
  const conv = process.env.GRAPHINOUT;
  if (conv) {
    const cmd = conv.includes('{}') ? conv.replaceAll('{}', `'${path}'`) : `${conv} '${path}'`;
    const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', maxBuffer: 128 << 20 });
    if (r.status !== 0) throw new Error(`convert failed: ${(r.stderr || '').trim().split('\n').slice(-2).join(' ')}`);
    return r.stdout;
  }
  const r = spawnSync(GIO, ['convert', path, '--to', 'grale'], { encoding: 'utf8', maxBuffer: 128 << 20 });
  if (r.status !== 0) throw new Error(`gio convert failed: ${(r.stderr || '').trim().split('\n').slice(-2).join(' ')}`);
  return r.stdout;
}

/** Converted graphs often lack layout sizes; give every node a width/height
 * (and surface a `label` to the renderer) so engines have something to lay out. */
function normalizeGrale(text) {
  const g = JSON.parse(text);
  if (!g.value || typeof g.value !== 'object') g.value = {}; // engines need a graph label
  for (const n of g.nodes ?? []) {
    const v = (n.value ??= {});
    if (v.label != null && v.meta?.label == null) v.meta = { ...(v.meta || {}), label: String(v.label) };
    if (typeof v.width !== 'number' || typeof v.height !== 'number') {
      const lab = String(v.label ?? n.v ?? '');
      v.width ??= Math.max(40, Math.min(240, lab.length * 8 + 16));
      v.height ??= 36;
    }
  }
  return JSON.stringify(g);
}

/** Expand paths (files or dirs) into [{ name, graleText }] — native grale read
 * as-is, every other registry format converted to grale and size-normalised. */
export function discoverInputs(paths) {
  const files = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    files.push(...listInputFiles(p));
  }
  files.sort();
  const out = [];
  for (const file of files) {
    const name = basename(file).replace(/\.[^.]+$/, '');
    try {
      const text = isNativeGrale(file) ? readFileSync(file, 'utf8') : normalizeGrale(convertToGrale(file));
      out.push({ name, graleText: text, path: resolve(file) });
    } catch { /* skip unconvertible / broken */ }
  }
  return out;
}

/** Engines bundled with this repo, always selectable in the app. */
export function builtinEngines() {
  return [
    { name: 'dagre', command: 'dagre' },                      // built into the runner (in-process)
    { name: 'dagre-cli', command: 'node dist/cli/grale-dagre.js' }, // same dagre, as a subprocess — exposes spawn cost
    { name: 'elk', command: 'node dist/cli/grale-elk.js' },   // elk.js adapter (built to dist)
  ];
}

/** Engine presets from the gitignored `compare.engines.json` ({ name: command }),
 * surfaced in the app's run form and used by the CLI when no engine is passed. */
export function loadEngineConfig(file = 'compare.engines.json') {
  if (!existsSync(file)) return [];
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    return Object.entries(cfg).map(([name, command]) => ({ name, command: String(command) }));
  } catch {
    return [];
  }
}

/** One level of the graph-test-data tree, for the app's browser. */
export function browseDir(rel = '') {
  const safe = rel.split('/').filter((s) => s && s !== '..').join('/');
  const dir = safe ? join(BROWSE_ROOT, safe) : BROWSE_ROOT;
  if (!existsSync(dir)) return { root: BROWSE_ROOT, rel: safe, path: dir, entries: [] };
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.') && d.name !== 'meta.ddot' && !/\.(ddot|adoc|md|iml)$/i.test(d.name))
    .map((d) => ({ name: d.name, dir: d.isDirectory(), format: d.isDirectory() ? null : formatFamily(join(dir, d.name)) }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { root: BROWSE_ROOT, rel: safe, path: dir, entries };
}

// --- engines ---------------------------------------------------------------

const DAGRE_OPTS = ['rankdir', 'align', 'nodesep', 'edgesep', 'ranksep', 'marginx', 'marginy', 'acyclicer', 'ranker'];

export function dagreLayout(input) {
  const g = dagre.graphlib.json.read(structuredClone(input));
  // grale labels are optional, but dagre needs a label object on each element.
  const gl = g.graph() ?? {};
  // honour dagre options passed via the run config (value.meta.engine.*)
  const ge = input.value?.meta?.engine;
  if (ge) for (const k of DAGRE_OPTS) if (ge[k] != null) gl[k] = ge[k];
  g.setGraph(gl);
  for (const v of g.nodes()) if (!g.node(v)) g.setNode(v, {});
  for (const e of g.edges()) if (!g.edge(e)) g.setEdge(e, {});
  // time *only* the layout algorithm, so it's comparable to other engines'
  // self-reported `diagnostics.elapsedMicros` (excludes parse/serialise/spawn).
  const t = process.hrtime.bigint();
  dagre.layout(g);
  const elapsedMicros = Number(process.hrtime.bigint() - t) / 1e3;
  const out = dagre.graphlib.json.write(g);
  out.diagnostics = { elapsedMicros, warnings: [] };
  return out;
}

function runCommand(command, inputPath, inputText) {
  const usesFile = command.includes('{}');
  const cmd = usesFile ? command.replaceAll('{}', `'${inputPath}'`) : command;
  const res = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', maxBuffer: 128 << 20, input: usesFile ? undefined : inputText });
  if (res.error) throw new Error(res.error.message);
  if (res.status !== 0) throw new Error(`exit ${res.status}: ${(res.stderr || '').trim().split('\n').slice(-2).join(' ')}`);
  return JSON.parse(res.stdout);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function makeId(name, label, now) {
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 23); // 2026-06-17T15-30-12-388
  return `${ts}_${slug(name) || 'engine'}${label ? '_' + slug(label) : ''}`;
}

const isBuiltinDagre = (command) => !command || command === 'dagre';

/** Merge a run's engine config into a grale graph's `value.meta.engine` (where
 *  engines like the elk adapter read their options) so it travels with the input. */
function injectConfig(graleText, config) {
  if (!config || typeof config !== 'object' || !Object.keys(config).length) return graleText;
  const g = JSON.parse(graleText);
  const v = (g.value ??= {});
  const meta = (v.meta ??= {});
  meta.engine = { ...(meta.engine ?? {}), ...config };
  return JSON.stringify(g);
}

/**
 * Run one engine over the given input paths; write a snapshot dir; return its
 * manifest. `engine` = { name, command?, label?, config? }. The config is
 * injected into each input's `value.meta.engine` and persisted in the manifest.
 */
export function runEngine(engine, paths, runsRoot = RUNS_ROOT, now = new Date()) {
  const { name, command, label, config } = engine;
  const inputs = discoverInputs(paths.length ? paths : [DEFAULT_INPUTS]);
  const id = makeId(name, label, now);
  const dir = join(runsRoot, id);
  mkdirSync(join(dir, '_input'), { recursive: true });

  const graphs = [];
  for (const { name: gname, graleText: rawText, path: sourcePath } of inputs) {
    const graleText = injectConfig(rawText, config);
    const inputPath = join(dir, '_input', `${gname}.json`);
    writeFileSync(inputPath, graleText);
    let metrics = null, ok = false, error = null, algoMs = null;
    const t0 = process.hrtime.bigint();
    try {
      const out = isBuiltinDagre(command) ? dagreLayout(JSON.parse(graleText)) : runCommand(command, inputPath, graleText);
      writeFileSync(join(dir, `${gname}.json`), JSON.stringify(out));
      // pure layout time the engine reports (µs → ms); excludes process spawn & IO
      if (typeof out?.diagnostics?.elapsedMicros === 'number') algoMs = out.diagnostics.elapsedMicros / 1e3;
      metrics = computeMetrics(out);
      ok = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    // `ms` = total wall-clock (includes subprocess spawn for external engines);
    // `algoMs` = engine-reported pure layout time (apples-to-apples across engines).
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    graphs.push({ name: gname, path: sourcePath, ms, algoMs, metrics, ok, error });
  }

  const manifest = {
    id,
    label: label || null,
    engine: { name, command: command || 'dagre' },
    config: config && Object.keys(config).length ? config : null,
    createdAt: now.toISOString(),
    inputs: paths,
    graphs,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

// --- reading runs ----------------------------------------------------------

export function listRuns(runsRoot = RUNS_ROOT) {
  if (!existsSync(runsRoot)) return [];
  const out = [];
  for (const d of readdirSync(runsRoot)) {
    const mf = join(runsRoot, d, 'manifest.json');
    if (!existsSync(mf)) continue;
    try { out.push(JSON.parse(readFileSync(mf, 'utf8'))); } catch { /* skip partial/corrupt run */ }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
}

export function loadRunGraph(id, name, runsRoot = RUNS_ROOT) {
  return readFileSync(join(runsRoot, id, `${name}.json`), 'utf8');
}

/** Delete a persisted run by id (only a real run dir; no path traversal). */
export function deleteRun(id, runsRoot = RUNS_ROOT) {
  const safe = String(id).replace(/[/\\]/g, '');
  const dir = join(runsRoot, safe);
  if (!safe || !existsSync(join(dir, 'manifest.json'))) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
