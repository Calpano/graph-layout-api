/**
 * Generate varied grale test inputs, each exercising specific grale features,
 * into the graph-test-data repo at json/grale/grale-1.0.0/features/.
 *
 *   node scripts/gen-feature-data.mjs   [DEST=/path/to/grale-1.0.0/features]
 *
 * These are grale *requests* (no x/y/points). Engines lay them out; features
 * the engine doesn't honour are echoed and survive to the output for renderers.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DEST = process.env.DEST ?? '../graph-test-data/json/grale/grale-1.0.0/features';

const N = (id, value = {}) => ({ v: id, value: { width: 60, height: 36, ...value } });
const E = (v, w, value, extra = {}) => ({ v, w, ...extra, ...(value ? { value } : {}) });
const graph = (opts, value, nodes, edges, hyperedges) => ({
  options: { directed: true, multigraph: false, compound: false, ...opts },
  value: { rankdir: 'TB', ...value },
  nodes,
  edges,
  ...(hyperedges ? { hyperedges } : {}),
});

const files = {
  // hard-pinned nodes at fixed coordinates
  'pinned': graph({}, {}, [
    N('ceo', { x: 200, y: 40, pinned: true, meta: { label: 'CEO (pinned)' } }),
    N('cto'), N('cfo'), N('eng'), N('fin'),
  ], [E('ceo', 'cto'), E('ceo', 'cfo'), E('cto', 'eng'), E('cfo', 'fin')]),

  // focus node the layout organises around
  'focus': graph({}, { focus: 'core' }, [
    N('core', { meta: { label: 'focus' } }), N('a'), N('b'), N('c'), N('d'), N('e'),
  ], [E('core', 'a'), E('core', 'b'), E('core', 'c'), E('a', 'd'), E('b', 'e')]),

  // per-edge preferred directions (authored in the TB frame)
  'prefdir': graph({}, {}, [N('a'), N('b'), N('c'), N('d'), N('e')], [
    E('a', 'b', { prefDir: 'right', meta: { label: 'right' } }),
    E('a', 'c', { prefDir: 'down', meta: { label: 'down' } }),
    E('d', 'a', { prefDir: 'up', meta: { label: 'up' } }),
    E('a', 'e', { prefDir: 'left', meta: { label: 'left' } }),
  ]),

  // hidden constraint links (shape layout, not drawn) + weight:0 (drawn, no constraint)
  'hidden-and-weight0': graph({}, {}, [N('yes'), N('no'), N('q'), N('end')], [
    E('q', 'yes'), E('q', 'no'),
    E('yes', 'no', { hidden: true, prefDir: 'right', meta: { label: 'hidden: yes left of no' } }),
    E('yes', 'end', { weight: 0, meta: { label: 'weight 0', dashed: true } }),
    E('no', 'end'),
  ]),

  // edge importance (weight) and reserved corridor (lineWidth)
  'weight-linewidth': graph({}, {}, [N('a'), N('b'), N('c'), N('d')], [
    E('a', 'b', { weight: 10, lineWidth: 5, meta: { label: 'w10 lw5', color: '#dc2626' } }),
    E('a', 'c', { weight: 1, lineWidth: 1 }),
    E('b', 'd'), E('c', 'd'),
  ]),

  // node ports (per side) + fromPort / toPort
  'ports': graph({}, {}, [
    N('fn', { ports: { top: 1, bottom: 2, left: 1, right: 1 }, meta: { label: 'fn' } }),
    N('in'), N('out0'), N('out1'),
  ], [
    E('in', 'fn', undefined, { value: { toPort: { side: 'top', index: 0 } } }),
    E('fn', 'out0', { fromPort: { side: 'bottom', index: 0 } }),
    E('fn', 'out1', { fromPort: { side: 'bottom', index: 1 } }),
  ]),

  // reusable edge markers (registry) referenced by id
  'markers': graph({}, {
    markers: { arrow: { width: 12, height: 9 }, dot: { width: 8, height: 8 }, diamond: { width: 10, height: 10 } },
  }, [N('a'), N('b'), N('c'), N('d')], [
    E('a', 'b', { endMarker: 'arrow', meta: { label: 'arrow' } }),
    E('a', 'c', { startMarker: 'dot', endMarker: 'arrow', meta: { label: 'dot→arrow' } }),
    E('b', 'd', { endMarker: 'diamond', meta: { label: 'diamond' } }),
  ]),

  // a spread of link widths (lineWidth), thin to thick
  'line-widths': graph({}, { markers: { arrow: { width: 11, height: 8 } } },
    [N('hub', { width: 70, height: 40, meta: { label: 'hub' } }), N('w1'), N('w2'), N('w3'), N('w5'), N('w8'), N('w12')], [
      E('hub', 'w1', { lineWidth: 1, endMarker: 'arrow', meta: { label: 'lw 1' } }),
      E('hub', 'w2', { lineWidth: 2, endMarker: 'arrow', meta: { label: 'lw 2' } }),
      E('hub', 'w3', { lineWidth: 3, endMarker: 'arrow', meta: { label: 'lw 3' } }),
      E('hub', 'w5', { lineWidth: 5, endMarker: 'arrow', meta: { label: 'lw 5', color: '#ea580c' } }),
      E('hub', 'w8', { lineWidth: 8, endMarker: 'arrow', meta: { label: 'lw 8', color: '#dc2626' } }),
      E('hub', 'w12', { lineWidth: 12, endMarker: 'arrow', meta: { label: 'lw 12', color: '#9333ea' } }),
    ]),

  // a gallery of markers: varied sizes, dock, and start/end combinations
  'markers-gallery': graph({}, {
    markers: {
      arrow: { width: 12, height: 9 },
      arrowBig: { width: 22, height: 16 },
      arrowSmall: { width: 7, height: 5 },
      arrowFlat: { width: 10, height: 16 },
      dot: { width: 8, height: 8 },
      dotBig: { width: 15, height: 15 },
      circle: { width: 12, height: 12, dock: 'left' },
    },
  }, [N('a'), N('b'), N('c'), N('d'), N('e'), N('f'), N('g'), N('h')], [
    E('a', 'b', { endMarker: 'arrow', meta: { label: 'arrow' } }),
    E('a', 'c', { endMarker: 'arrowBig', meta: { label: 'arrowBig' } }),
    E('a', 'd', { endMarker: 'arrowSmall', meta: { label: 'arrowSmall' } }),
    E('a', 'e', { endMarker: 'arrowFlat', meta: { label: 'arrowFlat' } }),
    E('a', 'f', { startMarker: 'dot', endMarker: 'arrow', meta: { label: 'dot→arrow' } }),
    E('a', 'g', { startMarker: 'circle', endMarker: 'dotBig', meta: { label: 'circle→dotBig' } }),
    E('a', 'h', { startMarker: 'dotBig', endMarker: 'dotBig', lineWidth: 3, meta: { label: 'dot…dot, lw3' } }),
  ]),

  // n-ary hyperedge connecting a set of nodes, with per-endpoint markers/ports
  'hyperedge': graph({}, {
    markers: { arrow: { width: 12, height: 9 }, dot: { width: 8, height: 8 } },
  }, [N('traveler'), N('london'), N('paris'), N('rome')],
    [E('traveler', 'london'), E('traveler', 'paris')],
    [{
      id: 'booking',
      endpoints: [{ node: 'traveler', marker: 'arrow' }, { node: 'london' }, { node: 'paris', marker: 'dot' }, { node: 'rome' }],
      value: { weight: 2, lineWidth: 2, prefDir: 'right', meta: { label: 'booking', color: '#9333ea' } },
    }]),

  // self-loops (v === w) alongside normal edges
  'self-loops': graph({}, {}, [N('a'), N('b'), N('c')], [
    E('a', 'a', { meta: { label: 'loop a' } }),
    E('a', 'b'), E('b', 'b', { meta: { label: 'loop b' } }), E('b', 'c'),
  ]),

  // compound graph with cross-cluster and child↔parent edges
  'compound': graph({ compound: true }, {}, [
    N('cluster_1', { meta: { label: 'group 1' } }), N('cluster_2', { meta: { label: 'group 2' } }),
    { ...N('a'), parent: 'cluster_1' }, { ...N('b'), parent: 'cluster_1' },
    { ...N('c'), parent: 'cluster_2' }, { ...N('d'), parent: 'cluster_2' },
  ], [
    E('a', 'b'), E('c', 'd'),
    E('b', 'c', { meta: { label: 'cross-cluster' } }),
    E('a', 'cluster_2', { meta: { label: 'child↔parent' } }),
  ]),

  // parallel edges (multigraph) distinguished by name
  'multigraph': graph({ multigraph: true }, {}, [N('p'), N('q')], [
    E('p', 'q', { meta: { label: 'e1' } }, { name: 'e1' }),
    E('p', 'q', { meta: { label: 'e2', color: '#16a34a' } }, { name: 'e2' }),
    E('p', 'q', { meta: { label: 'e3', color: '#ea580c' } }, { name: 'e3' }),
  ]),

  // one node with ~20 attached links (high-degree hub: 12 out + 8 in)
  'high-degree': graph({}, {}, [
    N('hub', { width: 84, height: 46, meta: { label: 'hub (deg 20)', fill: '#fef9c3' } }),
    ...Array.from({ length: 20 }, (_, i) => N('n' + i, { width: 44, height: 28 })),
  ], [
    ...Array.from({ length: 12 }, (_, i) => E('hub', 'n' + i)),
    ...Array.from({ length: 8 }, (_, i) => E('n' + (12 + i), 'hub')),
  ]),

  // corner rounding + z-order + opaque meta + edge ids
  'corner-zindex-meta': graph({}, { cornerRadius: 10 }, [
    N('a', { zIndex: 2, meta: { fill: '#fef9c3', label: 'top' } }), N('b'), N('c'), N('d'),
  ], [
    E('a', 'd', { zIndex: 3, meta: { label: 'over', color: '#dc2626' } }, { id: 'e_over' }),
    E('a', 'b', undefined, { id: 'e_ab' }), E('b', 'c', undefined, { id: 'e_bc' }), E('c', 'd', undefined, { id: 'e_cd' }),
  ]),
};

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
for (const [name, doc] of Object.entries(files)) {
  writeFileSync(join(DEST, `${name}.json`), JSON.stringify(doc, null, 2) + '\n');
  console.log(`  ${name}.json`);
}
const meta = `Synthetic grale inputs exercising individual grale features (pinned nodes,
focus, prefDir, hidden links, weight/lineWidth, ports, markers, hyperedges,
self-loops, compound/cross-cluster, multigraph, cornerRadius/zIndex/meta).

ddot.it/this ..kind.. synthetic
ddot.it/this ..authored by.. Calpano (graph-layout-api project)
ddot.it/this ..format.. format:grale-1.0.0
ddot.it/this ..content.. ${Object.keys(files).length} feature-focused grale request graphs
ddot.it/this ..tests.. per-feature handling by grale layout engines and renderers
ddot.it/this ..license.. MIT License, Copyright (c) Calpano (graph-layout-api project)
`;
writeFileSync(join(DEST, 'meta.ddot'), meta);
console.log(`\n${Object.keys(files).length} feature files + meta.ddot in ${DEST}/`);
