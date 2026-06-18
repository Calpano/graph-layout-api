/**
 * Convert a curated selection of kviz test graphs (ddot.it triple-text) to grale
 * via graphinout, into graph-test-data/json/grale/grale-1.0.0/kviz/.
 *
 *   node scripts/convert-kviz.mjs
 *
 * Public, well-known datasets keep their labels. Graphs with personal,
 * private, or opinionated real-world content are *anonymised*: node ids are
 * remapped to n0,n1,…, every label / attribute / edge predicate is dropped, and
 * the file is written under a generic `anon-N` name — only the graph structure
 * (degrees, shape) survives, nothing identifying.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const KVIZ = process.env.KVIZ ?? '/Users/maxvolkel/_data_/_git/GitHub/kviz/test-data/ddot.it';
const GIO = process.env.GIO ?? '/Users/maxvolkel/_data_/_git/GitHubOld/graphinout/cli/bin/gio';
const DEST = process.env.DEST ?? '../graph-test-data/json/grale/grale-1.0.0/kviz';

// keep labels — public / standard datasets and tech demos
const PUBLIC = ['zachary-karate', 'southern-women', 'dagre-tcp-state', 'dagre-sentence-tok', 'sigstore'];
// anonymise — personal, private, or opinionated real-world content
const ANON = ['max-mail', 'familen-unternehmen', 'musk', 'netflix', 'uber', 'pipeline', 'cose'];

function convert(name) {
  const r = spawnSync(GIO, ['convert', join(KVIZ, `${name}.ddot`), '--from', 'ddot', '--to', 'grale'], { encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error((r.stderr || 'empty output').trim().split('\n').slice(-1)[0]);
  return JSON.parse(r.stdout);
}

/** Mask text to its shape: A→X, a→x, 0→0; spaces/hyphens/dots/etc. kept. So
 *  "Short-lived Cert" → "Xxxxx-xxxxx Xxxx". Reveals nothing but the structure. */
const maskStr = (s) => String(s).replace(/[A-Z]/g, 'X').replace(/[a-z]/g, 'x').replace(/[0-9]/g, '0');
const labelOf = (v, fallback) => (v && ((v.meta && v.meta.label) ?? v.label)) ?? fallback;

/** Anonymise: remap ids to n#, and mask every label to its `Xxxx` shape
 *  (keeping length/word breaks so layouts stay realistic). */
function anonymise(g) {
  const map = new Map();
  g.nodes.forEach((n, i) => map.set(n.v, 'n' + i));
  for (const n of g.nodes) {
    const masked = maskStr(labelOf(n.value, n.v));
    n.v = map.get(n.v);
    if (n.parent && map.has(n.parent)) n.parent = map.get(n.parent);
    n.value = { meta: { label: masked } };
  }
  for (const e of g.edges) {
    e.v = map.get(e.v) ?? e.v; e.w = map.get(e.w) ?? e.w; delete e.id;
    const lbl = labelOf(e.value, null);
    e.value = lbl != null ? { meta: { label: maskStr(lbl) } } : {};
  }
  g.value = { rankdir: (g.value && g.value.rankdir) || 'TB' };
  return g;
}

/** Make a converted graph layout-ready: a graph label and node sizes (sized to
 *  the visible label, masked or not). */
function normalize(g) {
  if (!g.value || typeof g.value !== 'object') g.value = {};
  for (const n of g.nodes) {
    const v = (n.value ??= {});
    if (typeof v.width !== 'number' || typeof v.height !== 'number') {
      const len = String(labelOf(v, n.v)).length;
      v.width ??= Math.max(40, Math.min(220, len * 7 + 14));
      v.height ??= 30;
    }
  }
  return g;
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

let anonIdx = 0;
const written = [];
for (const name of PUBLIC) {
  try {
    const g = normalize(convert(name));
    writeFileSync(join(DEST, `${name}.json`), JSON.stringify(g, null, 2) + '\n');
    written.push(`${name}.json  (${g.nodes.length}n ${g.edges.length}e, labels kept)`);
  } catch (e) { console.error(`  skip ${name}: ${e.message}`); }
}
for (const name of ANON) {
  try {
    const g = normalize(anonymise(convert(name)));
    const out = `anon-${++anonIdx}.json`;
    writeFileSync(join(DEST, out), JSON.stringify(g, null, 2) + '\n');
    written.push(`${out}  (${g.nodes.length}n ${g.edges.length}e, anonymised)`);
  } catch (e) { console.error(`  skip ${name}: ${e.message}`); }
}

writeFileSync(join(DEST, 'meta.ddot'),
  `Real-world graphs collected from the kviz project's test set, converted to grale\n` +
  `via graphinout. Well-known public datasets keep their labels; graphs with\n` +
  `personal/private/opinionated content are anonymised: node ids remapped to\n` +
  `n0,n1,…, and every label masked to its shape (A→X, a→x, 0→0; spaces/hyphens\n` +
  `kept), so layouts stay realistic but nothing identifying remains.\n\n` +
  `ddot.it/this ..kind.. collected\n` +
  `ddot.it/this ..source.. kviz project test-data (ddot.it format)\n` +
  `ddot.it/this ..format.. format:grale-1.0.0\n` +
  `ddot.it/this ..note.. anon-*.json are anonymised; labels masked to Xxxx shape\n` +
  `ddot.it/this ..license.. dataset-dependent; anonymised files carry no source content\n`);

console.log(written.map((w) => '  ' + w).join('\n'));
console.log(`\n${written.length} graphs in ${DEST}/`);
