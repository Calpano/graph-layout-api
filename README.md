# grale - a Graph Layout Engine API

grale is a **gra**ph **l**ayout **e**ngine API, defined as JSON input and output specifications.

It takes the serialised form of a
dagre graph (graphlib's `json.write` format) and returns the same structure with positions
filled in — plus a set of capabilities dagre lacks. Any dagre graph is a valid grale request
**unchanged**; grale only adds optional fields.

```ts
import { layout } from 'grale';

const out = layout(graphJson);   // graleGraph -> graleGraph (positions filled in)
```

> **Status: specification — version 1.0.0.** This repository defines the API. The full normative
> spec lives in [`doc/spec-grale-api.adoc`](doc/spec-grale-api.adoc); the dagre baseline it
> supersets is in [`doc/dagre-js.adoc`](doc/dagre-js.adoc). See
> [`CHANGELOG.md`](CHANGELOG.md) for the release history.

---

## Why

dagre is the de-facto layered graph layout for JS, but its open issues has some things it
can't yet do: pinning nodes, keeping a layout stable as the graph changes, controlling edge
direction, ports, reporting crossings, returning diagnostics. 
grale keeps dagre's exact data
shape so existing code drops in, and adds those capabilities as optional fields.

It is a superset of the **interface**.

## Install

```bash
npm install graph-layout-api
```

## The shape of a request

grale uses the dagre / graphlib serialised envelope — `options`, a graph label `value`, and
`nodes` / `edges` whose `value` is the node/edge label:

```json5
{
  "options": { "directed": true, "multigraph": false, "compound": false },
  "value": { "rankdir": "LR" },
  "nodes": [
    { "v": "a", "value": { "width": 60, "height": 40 } },
    { "v": "b", "value": { "width": 60, "height": 40 } }
  ],
  "edges": [
    { "v": "a", "w": "b", "value": { "minlen": 1, "weight": 1 } }
  ]
}
```

`layout()` returns the same structure with `x`/`y` on nodes, `points` on edges, and
`width`/`height` on the graph label filled in.

## Drop-in for dagre

Any dagre/graphlib graph becomes a grale request by serialising it — no change to how the
graph was built:

```ts
import * as graphlib from '@dagrejs/graphlib';
import { layout } from 'grale';

const out = layout(graphlib.json.write(g));   // serialise dagre graph -> grale
const g2  = graphlib.json.read(out);          // back to a graph, positions in the labels
```

## What grale adds (all optional)

Every addition is an optional field on a label; set none and the request reduces exactly to
dagre.

| Group | Fields |
|---|---|
| **Positioning** | `pinned` (hard-fix a node at its `x`/`y`), `focus` (centre the layout on a node or set) |
| **Stability** | `prevLayouts` + `stability` — keep nodes near where they were across turns, even after a node disappears and returns |
| **Edge direction** | `prefDir` (per-edge, rotates with `rankdir`), `hidden` links (constrain layout, not drawn), `weight: 0` (drawn, doesn't constrain) |
| **Attachment** | `ports` (per-side, counter-clockwise) + `fromPort`/`toPort`; `markers` (reusable, reserve space, SVG-defs style) + `startMarker`/`endMarker` |
| **Edges** | `lineWidth`, `cornerRadius`, self-loops, edges across cluster boundaries, optional `id` |
| **Hyperedges** | n-ary `hyperedges[]` — a set of node endpoints, routed as a point-tree |
| **Output** | per-point `normals`, edge `crossings`, `zIndex`, and a `diagnostics` object (warnings, timing, displacement) — none of which dagre returns |
| **Passthrough** | `meta` on any label for renderer data the layouter ignores |
| **Debug** | `logLevel`, `visualDebug` |

See the [full specification](doc/spec-grale-api.adoc) for every field, its type, default, and
semantics, plus the TypeScript definitions and the compatibility matrix.

## TypeScript types

The JSON input/output types are realised as TypeScript in [`src/grale/`](src/grale) — the
`graleGraph` envelope and the graph / node / edge / hyperedge labels — and re-exported from the
package root:

```ts
import type { graleGraph, GraphLabel, NodeLabel, EdgeLabel, Hyperedge, Diagnostics } from 'grale';
```

## Rendering, CLI & viewer

A grale **result** graph (positions filled in) renders to SVG through one shared, DOM-free
function, so the command line and the browser produce identical output.

```ts
import { renderSvg } from 'grale/render';

const svg = renderSvg(resultGraph, { debug: true });   // -> SVG string
```

**CLI** — convert a result JSON to an `.svg` file, with a live `--watch` mode:

```bash
npx grale-to-svg layout.out.json            # -> layout.out.svg
npx grale-to-svg layout.out.json -d --watch # debug overlays, re-render on change
# options: -o <file>, -w/--watch, -d/--debug, --padding <px>, --bg <color>
```

`--debug` overlays waypoints, per-point `normals`, `crossings`, node centres/coords, the layout
bounding box, and the `diagnostics.warnings`.

**Web component** — a Svelte/Vite viewer exposing a `<grale-view>` custom element with pan/zoom:

```bash
npm run dev          # dev harness: paste/drop JSON, toggle debug overlays
npm run build:viewer # bundle the viewer (and the <grale-view> element)
```

```html
<grale-view debug></grale-view>
<script type="module">
  document.querySelector('grale-view').graph = resultGraph;  // set the JSON property
</script>
```

See [`examples/sample.out.json`](examples/sample.out.json) for a result graph exercising
markers, ports, a hyperedge, crossings and diagnostics.

## Layout quality metrics

Score the geometry of a result graph — to compare layouts or guard against regressions:

```ts
import { computeMetrics } from 'grale/metrics';

const m = computeMetrics(resultGraph);
// m.nodeOverlap.area, m.edgeLength.total, m.crossings.count,
// m.edgeNodeOverlap.length, m.boundingBox.area, m.bends.total,
// m.flow.forwardRatio, m.angularResolution.minDeg, ...
```

| Metric | What it measures (lower is better unless noted) |
|---|---|
| `nodeOverlap` | node-box intersection area (px²), overlapping pairs, worst pair |
| `minNodeGap` | closest gap between node boxes; 0 when any two touch/overlap |
| `edgeLength` | total / mean / min / max / stdDev / `cv` (length uniformity) |
| `crossings` | count, per-edge, mean crossing angle, mean deviation from 90° |
| `edgeNodeOverlap` | edge length running through unrelated node boxes, and its share |
| `bends` | real corners (turn > 1°): total, mean/edge, max, summed turning angle |
| `boundingBox` / `hull` | drawing area, aspect ratio; convex-hull area + compactness |
| `areaUtilization` | Σ node area ÷ bbox area (ink density, higher = denser) |
| `angularResolution` | min angle between edges at a node (deg, higher = clearer) |
| `flow` | directed-edge consistency vs `rankdir`: `forwardRatio`, backward count |

Binary edges and hyperedges are measured together as *links* (a hyperedge contributes its whole
routed point-tree to length, crossings, edge–node overlap, bends and angular resolution); `flow`
stays binary-only. Compound clusters are excluded from the overlap metrics by default. CLI:

```bash
npx grale-metrics layout.out.json                 # full metrics for one file
npx grale-metrics examples/fixtures/*.out.json     # comparison table across files
npx grale-metrics layout.out.json --json           # machine-readable
```

## Comparing layout engines

A *run* lays one engine out over a set of input graphs and writes a timestamped **snapshot
dir** under `examples/runs/<id>/` — the laid-out grale JSON per graph plus a `manifest.json`
of per-graph metrics. You compare any two snapshot dirs (dagre vs cale, or cale PREV vs cale
NOW).

An engine is `dagre` or `elk` (both built in — `elk` wraps [elk.js](https://github.com/kieler/elkjs)
via `src/cli/grale-elk.ts`, see [`doc/grale-elk.adoc`](doc/grale-elk.adoc)), or any command that
reads a grale JSON graph and writes the laid-out grale JSON — stdin → stdout, or with `{}` in the command = the input file path. The
repo hard-codes no engine but dagre. Inputs are **paths** — grale `.json` files or
directories. The test graphs live in the
[graph-test-data](https://github.com/Calpano/graph-test-data) repo under
`json/grale/grale-1.0.0/` (format `grale-1.0.0` in the
[graph-format-registry](https://github.com/Calpano/graph-format-registry)) — common shapes
directly, and a `features/` subfolder exercising individual grale features (pinned, focus,
prefDir, hidden links, weight/lineWidth, ports, markers, hyperedges, self-loops,
cross-cluster compound, multigraph, cornerRadius/zIndex/meta; regenerate with
`node scripts/gen-feature-data.mjs`). Other registry formats drop in when `GRAPHINOUT` is set
to a converter command (e.g. `GRAPHINOUT='graphinout --to grale {}'`).

### Interactive app

```bash
./run            # fresh clone → install, build, launch, open browser
./run-cale       # same, but seed cale as a one-click engine preset (CALE_DIR overrides)
npm run app      # launch (deps already installed)
```

Engines listed in a gitignored `compare.engines.json` (`{ "name": "command" }`) appear as
**preset chips** in the run form (one click prefills name + command); `./run-cale` writes
that file with cale's command. The same file is the CLI's default engine set.

The Svelte app (backed by a Vite dev-server endpoint that spawns engines) lets you **run** an
engine over the graphs from a form — pick a name, command, optional label, paths, and an
**engine config** (elk `algorithm` / `edgeRouting` dropdowns plus a free-form **config JSON**
field for arbitrary keys) — and **compare** any two runs side by side. The config is injected
into each input's `value.meta.engine` and **persisted in the run's manifest**, so every result
records the config that produced it (shown in the run labels). Each engine reads its own keys:
**elk** — `algorithm`, `edgeRouting`, raw `elk.*` keys or a `layoutOptions` map; **dagre** —
`rankdir`, `ranker`, `nodesep`, `edgesep`, `ranksep`, `align`, `marginx/y`, `acyclicer`;
**cale** and any other engine — whatever it chooses to read from `value.meta.engine`: per-graph metric deltas (green = better, red = worse)
and two interactive [`GraleView`](viewer/GraleView.svelte) panes. Each pane has independently
toggleable **overlay categories** — positions, diagram area, box centers, link points (with
*bend points*, *crossings*, *branch points*), normals, and **link ids** (badge every link with
its `id`, or its index when it has none — handy for referring to a specific link in a
screenshot) — plus toggleable engine debug layers (`graph.debug`) and a **⛶ full-screen** button.

Runs persist on disk under `examples/runs/<id>/` (gitignored) and are read fresh on every
request, so they survive server restarts — compare a run from now against one from before. Point
the store elsewhere with `GRALE_RUNS`, and delete a run from the picker with 🗑.

**Browse & convert** — the app's 📁 browse picker navigates the graph-test-data repo; pick a
folder of graphs in any registry format and they're converted to grale on the fly (via the
graphinout `gio` CLI) before layout. Native `grale-1.0.0` files are used directly; everything
else is detected by its path family, converted, and size-normalised. See
[`doc/todo.adoc`](doc/todo.adoc).

### Headless CLI

```bash
npm run compare -- dagre=dagre cale="my-cli" ../graph-test-data/json/grale/grale-1.0.0
npm run compare -- cale="my-cli {}" --label now graph1.json   # tag the run dir
```

Each `name=command` becomes one snapshot dir; the CLI prints a comparison table and the run
paths. Open them in the app to compare visually.

## Documentation

| File                                                 | What                                                       |
|------------------------------------------------------|------------------------------------------------------------|
| [`doc/spec-grale-api.adoc`](doc/spec-grale-api.adoc) | The normative grale API specification                      |
| [`doc/engine-contract.adoc`](doc/engine-contract.adoc) | What a layout engine must do to be a grale engine          |
| [`doc/grale-elk.adoc`](doc/grale-elk.adoc)           | grale ↔ ELK (elk.js) comparison + adapter plan             |
| [`doc/todo.adoc`](doc/todo.adoc)                     | Deferred work (e.g. browse graph-test-data + graphinout conversion) |
| [`doc/dagre-js.adoc`](doc/dagre-js.adoc)             | The dagre serialised-JSON baseline grale supersets         |
| [`doc/dagre-issues.adoc`](doc/dagre-issues.adoc)     | Snapshot of open dagre issues that motivated the additions |
| [`CHANGELOG.md`](CHANGELOG.md)                        | Release history; current version **1.0.0**                 |

## License

[MIT](LICENSE) © Max Völkel
