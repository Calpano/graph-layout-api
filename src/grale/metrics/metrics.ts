/**
 * Layout quality metrics for a grale *result* graph.
 *
 * Pure and DOM-free (like the renderer): reads only the output geometry
 * (`x`/`y`/`width`/`height` on nodes, `points` on edges, hyperedge `tree`s,
 * `rankdir` on the graph) and returns a structured score sheet. Lower is better
 * for the "cost" metrics (overlap, crossings, length, bends); the report also
 * carries a few descriptive ratios where higher or "closer to a target" is
 * better.
 *
 * Binary edges and hyperedges are measured together as *links*: a binary edge
 * is a polyline, a hyperedge is its routed point-`tree`. Both feed length,
 * crossings, edge–node overlap, bends and angular resolution. Flow stays
 * binary-only — a hyperedge's endpoint set is unordered, so it has no direction.
 *
 * Compound graphs: cluster/parent nodes (any id used as a node `parent`) are
 * excluded from node–node overlap and edge–node overlap by default, since a
 * child sitting inside its own cluster is not a defect. Pass
 * `includeContainers: true` to measure them too.
 */

import type { graleGraph } from '../types';

export interface MetricsOptions {
  /** Count compound parent (cluster) nodes in overlap metrics. Default false. */
  includeContainers?: boolean;
}

export interface EdgeLengthStats {
  total: number;
  mean: number;
  min: number;
  max: number;
  stdDev: number;
  /** Coefficient of variation (stdDev / mean) — length uniformity, lower is more uniform. */
  cv: number;
}

export interface LayoutMetrics {
  nodes: number;
  /** Drawn binary edges. */
  edges: number;
  /** Drawn hyperedges (routed as point-trees). */
  hyperedges: number;

  /** Drawing extent. */
  boundingBox: { width: number; height: number; area: number; aspectRatio: number };
  /** Convex hull of node boxes; `compactness` = hullArea / bboxArea (0..1, higher = tighter). */
  hull: { area: number; compactness: number };
  /** Σ node-box areas. */
  nodeAreaSum: number;
  /** nodeAreaSum / boundingBox.area — ink density (0..1). */
  areaUtilization: number;

  /** Node–node overlap: total intersection area (px²), number of overlapping pairs, worst pair. */
  nodeOverlap: { area: number; pairs: number; maxPairArea: number };
  /** Smallest gap between node boxes (px); 0 when any two touch or overlap. */
  minNodeGap: number;

  /** Per-link path length (a hyperedge's length is its whole tree); stats over all links. */
  edgeLength: EdgeLengthStats;
  /** Link length running through unrelated node boxes (px) and its share of total length. */
  edgeNodeOverlap: { length: number; ratio: number };
  /** Real corners (turn > 1°) across links: total, mean per link, worst link, summed turning angle (deg). */
  bends: { total: number; meanPerEdge: number; max: number; totalTurningDeg: number };

  /** Crossings (geometric, between segments of distinct links — edges and hyperedges alike). */
  crossings: {
    count: number;
    /** Crossings divided by the number of drawn links. */
    perEdge: number;
    /** Mean acute crossing angle (deg); closer to 90 is more readable. */
    meanAngleDeg: number;
    /** Mean |90 − angle| (deg); lower is better. */
    meanDeviationFrom90Deg: number;
  };

  /** Minimum angle between links meeting at a node (deg); larger = less clutter. */
  angularResolution: { minDeg: number; meanMinPerNodeDeg: number };

  /** Directed-flow consistency w.r.t. rankdir (binary edges only); null for undirected graphs. */
  flow: {
    rankdir: 'TB' | 'BT' | 'LR' | 'RL';
    axis: 'x' | 'y';
    forward: number;
    backward: number;
    tied: number;
    forwardRatio: number;
  } | null;
}

// --- geometry helpers ------------------------------------------------------

type Pt = { x: number; y: number };
interface Rect { minX: number; minY: number; maxX: number; maxY: number; }

const numv = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const DEG = 180 / Math.PI;
const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

const rectOf = (cx: number, cy: number, w: number, h: number): Rect => ({
  minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2,
});

function intersectArea(a: Rect, b: Rect): number {
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
  return Math.hypot(dx, dy); // 0 when boxes overlap on both axes
}

/** Length of segment p1→p2 lying inside rect (Liang–Barsky). */
function clipLenInRect(p1: Pt, p2: Pt, r: Rect): number {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const p = [-dx, dx, -dy, dy];
  const q = [p1.x - r.minX, r.maxX - p1.x, p1.y - r.minY, r.maxY - p1.y];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return 0; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return 0; if (t > t0) t0 = t; }
      else { if (t < t0) return 0; if (t < t1) t1 = t; }
    }
  }
  return t1 > t0 ? Math.hypot(dx, dy) * (t1 - t0) : 0;
}

/** Acute angle (deg, 0..90) between two direction vectors. */
function acuteAngle(u: Pt, v: Pt): number {
  const a = Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y) * DEG;
  return a > 90 ? 180 - a : a;
}

/** Turn angle (deg, 0 straight .. 180 reverse) at vertex b between a→b and b→c. */
function turnDeg(a: Pt, b: Pt, c: Pt): number {
  const u = { x: b.x - a.x, y: b.y - a.y };
  const v = { x: c.x - b.x, y: c.y - b.y };
  return Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y) * DEG;
}

/** Proper crossing of segments a–b and c–d (interior of both), with its acute angle. */
function properCross(a: Pt, b: Pt, c: Pt, d: Pt): { angleDeg: number } | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (denom === 0) return null; // parallel / collinear: not a proper crossing
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  const e = 1e-9;
  if (t > e && t < 1 - e && u > e && u < 1 - e) return { angleDeg: acuteAngle(r, s) };
  return null;
}

function convexHullArea(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let area = 0;
  for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; area += a.x * b.y - b.x * a.y; }
  return Math.abs(area) / 2;
}

// --- links (binary edges + hyperedges, unified) ----------------------------

interface Link {
  endpoints: Set<string>;             // own node ids — excluded from edge–node overlap
  segs: [Pt, Pt][];                   // geometry segments
  length: number;
  bends: number;                      // real corners (turn > 1°)
  turningDeg: number;
  spokeDirs: { node: string; dir: Pt }[]; // direction leaving each endpoint node
}

function binaryLink(v: string, w: string, pts: Pt[]): Link {
  const segs: [Pt, Pt][] = [];
  let length = 0;
  for (let i = 1; i < pts.length; i++) { segs.push([pts[i - 1], pts[i]]); length += dist(pts[i - 1], pts[i]); }
  let bends = 0, turningDeg = 0;
  for (let i = 1; i < pts.length - 1; i++) { const t = turnDeg(pts[i - 1], pts[i], pts[i + 1]); if (t > 1) { bends++; turningDeg += t; } }
  const spokeDirs = v === w ? [] : [   // skip self-loops in angular resolution
    { node: v, dir: { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y } },
    { node: w, dir: { x: pts[pts.length - 2].x - pts[pts.length - 1].x, y: pts[pts.length - 2].y - pts[pts.length - 1].y } },
  ];
  return { endpoints: new Set([v, w]), segs, length, bends, turningDeg, spokeDirs };
}

type TreePt = Pt & { kind?: string; node?: string };
function hyperLink(endpoints: { node?: string }[], pts: TreePt[], ends: [number, number][]): Link {
  const adj: number[][] = pts.map(() => []);
  const segs: [Pt, Pt][] = [];
  let length = 0;
  for (const [i, j] of ends) {
    if (!pts[i] || !pts[j]) continue;
    adj[i].push(j); adj[j].push(i);
    segs.push([pts[i], pts[j]]); length += dist(pts[i], pts[j]);
  }
  let bends = 0, turningDeg = 0;
  const spokeDirs: { node: string; dir: Pt }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.kind === 'bend' && adj[i].length === 2) {
      const t = turnDeg(pts[adj[i][0]], p, pts[adj[i][1]]);
      if (t > 1) { bends++; turningDeg += t; }
    } else if (p.kind === 'endpoint' && p.node && adj[i].length >= 1) {
      const nb = pts[adj[i][0]];
      spokeDirs.push({ node: p.node, dir: { x: nb.x - p.x, y: nb.y - p.y } });
    }
  }
  const own = new Set<string>();
  for (const ep of endpoints) if (ep.node) own.add(ep.node);
  for (const p of pts) if (p.kind === 'endpoint' && p.node) own.add(p.node);
  return { endpoints: own, segs, length, bends, turningDeg, spokeDirs };
}

// --- main ------------------------------------------------------------------

interface NodeGeom { id: string; cx: number; cy: number; rect: Rect; container: boolean; }

export function computeMetrics(graph: graleGraph, opts: MetricsOptions = {}): LayoutMetrics {
  const includeContainers = !!opts.includeContainers;

  // node geometry
  const containerIds = new Set<string>();
  for (const n of graph.nodes ?? []) if (n.parent) containerIds.add(n.parent);
  const geoms = new Map<string, NodeGeom>();
  for (const n of graph.nodes ?? []) {
    const v = n.value;
    if (!v || v.x == null || v.y == null) continue;
    geoms.set(n.v, { id: n.v, cx: v.x, cy: v.y, rect: rectOf(v.x, v.y, numv(v.width, 0), numv(v.height, 0)), container: containerIds.has(n.v) });
  }
  const leafs = [...geoms.values()].filter((g) => includeContainers || !g.container);

  // links: binary edges then hyperedges
  let nEdges = 0, nHyper = 0;
  const links: Link[] = [];
  for (const e of graph.edges ?? []) {
    const pts = e.value?.points;
    if (e.value?.hidden || !pts || pts.length < 2) continue;
    nEdges++; links.push(binaryLink(e.v, e.w, pts));
  }
  for (const he of graph.hyperedges ?? []) {
    const tree = he.value?.tree;
    if (he.value?.hidden || !tree || !tree.points || tree.points.length < 2) continue;
    nHyper++; links.push(hyperLink(he.endpoints ?? [], tree.points as TreePt[], tree.segments?.map((s) => s.ends) ?? []));
  }
  const linkCount = links.length;

  // bounding box + hull corners
  const bb: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const corners: Pt[] = [];
  const growPt = (x: number, y: number) => { if (Number.isFinite(x) && Number.isFinite(y)) { bb.minX = Math.min(bb.minX, x); bb.minY = Math.min(bb.minY, y); bb.maxX = Math.max(bb.maxX, x); bb.maxY = Math.max(bb.maxY, y); } };
  for (const g of geoms.values()) { const r = g.rect; growPt(r.minX, r.minY); growPt(r.maxX, r.maxY); corners.push({ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY }, { x: r.minX, y: r.maxY }, { x: r.maxX, y: r.maxY }); }
  for (const lk of links) for (const [a, b] of lk.segs) { growPt(a.x, a.y); growPt(b.x, b.y); }
  if (!Number.isFinite(bb.minX)) { bb.minX = bb.minY = bb.maxX = bb.maxY = 0; }
  const bw = bb.maxX - bb.minX, bh = bb.maxY - bb.minY;
  const bboxArea = bw * bh;
  const hullArea = convexHullArea(corners);

  // node areas
  let nodeAreaSum = 0;
  for (const g of leafs) nodeAreaSum += (g.rect.maxX - g.rect.minX) * (g.rect.maxY - g.rect.minY);

  // node–node overlap + min gap
  let overlapArea = 0, overlapPairs = 0, maxPairArea = 0, minGap = Infinity;
  for (let i = 0; i < leafs.length; i++)
    for (let j = i + 1; j < leafs.length; j++) {
      const a = intersectArea(leafs[i].rect, leafs[j].rect);
      if (a > 0) { overlapArea += a; overlapPairs++; if (a > maxPairArea) maxPairArea = a; }
      const gap = rectGap(leafs[i].rect, leafs[j].rect);
      if (gap < minGap) minGap = gap;
    }
  if (!Number.isFinite(minGap)) minGap = 0;

  // link lengths, bends, edge–node overlap
  const lengths = links.map((l) => l.length);
  let bendTotal = 0, bendMax = 0, turningDeg = 0, enOverlap = 0;
  for (const lk of links) {
    bendTotal += lk.bends; if (lk.bends > bendMax) bendMax = lk.bends; turningDeg += lk.turningDeg;
    for (const [a, b] of lk.segs) for (const g of leafs) { if (lk.endpoints.has(g.id)) continue; enOverlap += clipLenInRect(a, b, g.rect); }
  }
  const totalLen = lengths.reduce((a, b) => a + b, 0);
  const meanLen = lengths.length ? totalLen / lengths.length : 0;
  const variance = lengths.length ? lengths.reduce((a, l) => a + (l - meanLen) ** 2, 0) / lengths.length : 0;
  const stdDev = Math.sqrt(variance);

  // crossings: proper intersections between segments of distinct links
  const segs: { l: number; a: Pt; b: Pt }[] = [];
  links.forEach((lk, li) => { for (const [a, b] of lk.segs) segs.push({ l: li, a, b }); });
  let crossCount = 0, angleSum = 0, devSum = 0;
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].l === segs[j].l) continue;
      const x = properCross(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
      if (x) { crossCount++; angleSum += x.angleDeg; devSum += Math.abs(90 - x.angleDeg); }
    }

  // angular resolution: link directions leaving each node
  const dirs = new Map<string, number[]>();
  for (const lk of links) for (const sp of lk.spokeDirs) {
    if (!geoms.has(sp.node)) continue;
    const list = dirs.get(sp.node) ?? (dirs.set(sp.node, []), dirs.get(sp.node)!);
    list.push(Math.atan2(sp.dir.y, sp.dir.x) * DEG);
  }
  let globalMin = Infinity, perNodeSum = 0, perNodeCount = 0;
  for (const angles of dirs.values()) {
    if (angles.length < 2) continue;
    const s = [...angles].sort((a, b) => a - b);
    let nodeMin = Infinity;
    for (let i = 0; i < s.length; i++) { const gap = i === 0 ? 360 + s[0] - s[s.length - 1] : s[i] - s[i - 1]; if (gap < nodeMin) nodeMin = gap; }
    perNodeSum += nodeMin; perNodeCount++;
    if (nodeMin < globalMin) globalMin = nodeMin;
  }

  // directed flow consistency (binary edges only)
  let flow: LayoutMetrics['flow'] = null;
  if (graph.options?.directed !== false) {
    const rankdir = (graph.value?.rankdir ?? 'TB') as 'TB' | 'BT' | 'LR' | 'RL';
    const axis: 'x' | 'y' = rankdir === 'LR' || rankdir === 'RL' ? 'x' : 'y';
    const sign = rankdir === 'TB' || rankdir === 'LR' ? 1 : -1;
    let forward = 0, backward = 0, tied = 0;
    for (const e of graph.edges ?? []) {
      const a = geoms.get(e.v), b = geoms.get(e.w);
      if (!a || !b || e.v === e.w) continue;
      const delta = (axis === 'x' ? b.cx - a.cx : b.cy - a.cy) * sign;
      if (delta > 1e-6) forward++; else if (delta < -1e-6) backward++; else tied++;
    }
    const considered = forward + backward + tied;
    flow = { rankdir, axis, forward, backward, tied, forwardRatio: considered ? forward / considered : 0 };
  }

  return {
    nodes: geoms.size,
    edges: nEdges,
    hyperedges: nHyper,
    boundingBox: { width: bw, height: bh, area: bboxArea, aspectRatio: bh ? bw / bh : 0 },
    hull: { area: hullArea, compactness: bboxArea ? hullArea / bboxArea : 0 },
    nodeAreaSum,
    areaUtilization: bboxArea ? nodeAreaSum / bboxArea : 0,
    nodeOverlap: { area: overlapArea, pairs: overlapPairs, maxPairArea },
    minNodeGap: minGap,
    edgeLength: { total: totalLen, mean: meanLen, min: lengths.length ? Math.min(...lengths) : 0, max: lengths.length ? Math.max(...lengths) : 0, stdDev, cv: meanLen ? stdDev / meanLen : 0 },
    edgeNodeOverlap: { length: enOverlap, ratio: totalLen ? enOverlap / totalLen : 0 },
    bends: { total: bendTotal, meanPerEdge: linkCount ? bendTotal / linkCount : 0, max: bendMax, totalTurningDeg: turningDeg },
    crossings: { count: crossCount, perEdge: linkCount ? crossCount / linkCount : 0, meanAngleDeg: crossCount ? angleSum / crossCount : 0, meanDeviationFrom90Deg: crossCount ? devSum / crossCount : 0 },
    angularResolution: { minDeg: Number.isFinite(globalMin) ? globalMin : 0, meanMinPerNodeDeg: perNodeCount ? perNodeSum / perNodeCount : 0 },
    flow,
  };
}
