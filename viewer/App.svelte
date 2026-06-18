<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import GraleView from './GraleView.svelte';

  type Metrics = any;
  interface GraphEntry { name: string; path?: string; ms?: number; algoMs?: number; metrics: Metrics | null; ok: boolean; error?: string }
  interface Run { id: string; label: string | null; engine: { name: string; command: string }; config: Record<string, unknown> | null; createdAt: string; graphs: GraphEntry[] }

  // metric, label, accessor, better-direction, tooltip description
  const COLS: [string, (m: Metrics) => number, 'lo' | 'hi', string][] = [
    ['cross', (m) => m.crossings.count, 'lo', 'Edge crossings — how many times links cross one another. Lower is better.'],
    ['nOverlap', (m) => m.nodeOverlap.area, 'lo', 'Node overlap — total overlapping area of node boxes, in px². Lower is better (0 = no nodes overlap).'],
    ['eLen', (m) => m.edgeLength.total, 'lo', 'Total edge length — sum of all link path lengths, in px. Lower is better.'],
    ['enOver', (m) => m.edgeNodeOverlap.length, 'lo', 'Edge–node overlap — total length of links that pass through node boxes, in px. Lower is better.'],
    ['bends', (m) => m.bends.total, 'lo', 'Bends — total number of bend points across all links. Lower is better (straighter links).'],
    ['area', (m) => m.boundingBox.area, 'lo', 'Diagram area — bounding-box area of the whole layout, in px². Lower is more compact.'],
    ['fwd%', (m) => (m.flow ? m.flow.forwardRatio * 100 : 0), 'hi', 'Flow consistency — percent of directed edges that point in the dominant flow direction. Higher is better (100% = all edges flow the same way).'],
  ];
  const ALGO_DESC = 'Algorithm time — the engine\'s self-reported pure layout time (diagnostics.elapsedMicros), in ms. Excludes process spawn / startup / IO, so it is comparable across engines regardless of how they are invoked.';
  const MS_DESC = 'Total runtime — wall-clock time to process this graph, in ms. For external engines this includes subprocess spawn + interpreter/JVM startup; for in-process dagre it does not. (total − algo ≈ spawn overhead.)';
  const ms1 = (n?: number) => (n != null ? n.toFixed(1) : '–');
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(0));

  let runs = $state<Run[]>([]);
  let aId = $state('');
  let bId = $state('');

  // new-run form
  let fName = $state('dagre');
  let fCommand = $state('dagre');
  let fLabel = $state('');
  let fPaths = $state('');
  // engine config (read by elk via value.meta.engine; persisted with the run)
  let fAlgorithm = $state('');
  let fRouting = $state('');
  let fOptions = $state(''); // free-form config JSON (engine-specific keys), merged into value.meta.engine
  const ELK_ALGOS = ['layered', 'force', 'stress', 'mrtree', 'radial', 'rectpacking'];
  const ELK_ROUTING = ['orthogonal', 'polyline', 'spline'];
  let busy = $state(false);
  let error = $state('');

  // engine presets from compare.engines.json (seeded by the launch script)
  let presets = $state<{ name: string; command: string }[]>([]);
  function usePreset(p: { name: string; command: string }) {
    fName = p.name;
    fCommand = p.command;
  }

  // graph-test-data browser
  interface Entry { name: string; dir: boolean; format: string | null }
  let browseOpen = $state(false);
  let browseRel = $state('');
  let browsePath = $state('');
  let browseEntries = $state<Entry[]>([]);

  async function browse(rel: string) {
    try {
      const d = await (await fetch(`/api/browse?rel=${encodeURIComponent(rel)}`)).json();
      browseRel = d.rel;
      browsePath = d.path;
      browseEntries = d.entries;
    } catch (e) {
      error = String(e);
    }
  }
  function openBrowse() {
    browseOpen = !browseOpen;
    if (browseOpen && !browseEntries.length) browse('');
  }
  const parentRel = (rel: string) => rel.split('/').slice(0, -1).join('/');
  function useFolder() {
    fPaths = browsePath;
    browseOpen = false;
  }

  const aRun = $derived(runs.find((r) => r.id === aId) ?? null);
  const bRun = $derived(runs.find((r) => r.id === bId) ?? null);
  const names = $derived(
    [...new Set([...(aRun?.graphs ?? []), ...(bRun?.graphs ?? [])].map((g) => g.name))].sort(),
  );

  const graphCache = new SvelteMap<string, unknown>();
  const keyOf = (id: string, name: string) => `${id}::${name}`;

  async function loadRuns() {
    try {
      runs = await (await fetch('/api/runs')).json();
      if (!bId && runs[0]) bId = runs[0].id;
      if (!aId) aId = (runs[1] ?? runs[0])?.id ?? '';
    } catch (e) {
      error = `cannot reach backend (run \`npm run dev\`): ${e}`;
    }
  }

  async function loadPresets() {
    try {
      presets = await (await fetch('/api/engines')).json();
      if (presets[0]) usePreset(presets[0]); // prefill the form with the first preset
    } catch { /* none configured */ }
  }

  async function startRun() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const paths = fPaths.trim() ? fPaths.trim().split(/\s+/) : [];
      const cfg: Record<string, unknown> = {};
      if (fAlgorithm) cfg.algorithm = fAlgorithm;
      if (fRouting) cfg.edgeRouting = fRouting;
      if (fOptions.trim()) {
        try { Object.assign(cfg, JSON.parse(fOptions)); }
        catch { error = 'config JSON is invalid'; busy = false; return; }
      }
      const config = Object.keys(cfg).length ? cfg : undefined;
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: fName, command: fCommand, label: fLabel, paths, config }),
      });
      const m = await res.json();
      if (!res.ok) throw new Error(m.error || res.statusText);
      await loadRuns();
      aId = bId; // shift current B to A …
      bId = m.id; //  … and show the new run as B
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function removeRun(id: string) {
    if (!id || !confirm('Delete this run permanently?')) return;
    try {
      await fetch(`/api/runs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (aId === id) aId = '';
      if (bId === id) bId = '';
      await loadRuns();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // prefetch the laid-out graphs of both selected runs
  $effect(() => {
    for (const run of [aRun, bRun]) {
      if (!run) continue;
      for (const g of run.graphs) {
        if (!g.ok) continue;
        const key = keyOf(run.id, g.name);
        if (graphCache.has(key)) continue;
        graphCache.set(key, null);
        fetch(`/api/runs/${encodeURIComponent(run.id)}/graph/${encodeURIComponent(g.name)}`)
          .then((r) => r.json())
          .then((j) => graphCache.set(key, j))
          .catch(() => graphCache.set(key, undefined));
      }
    }
  });

  const entryOf = (run: Run | null, name: string): GraphEntry | null =>
    run?.graphs.find((g) => g.name === name) ?? null;
  const metricOf = (run: Run | null, name: string): Metrics | null => entryOf(run, name)?.metrics ?? null;
  const pathOf = (name: string): string =>
    aRun?.graphs.find((g) => g.name === name)?.path ?? bRun?.graphs.find((g) => g.name === name)?.path ?? '';

  // overall win/loss/tie of B vs A
  const tally = $derived.by(() => {
    let win = 0, loss = 0, tie = 0;
    if (!aRun || !bRun) return { win, loss, tie };
    for (const name of names) {
      const a = metricOf(aRun, name), b = metricOf(bRun, name);
      if (!a || !b) continue;
      for (const [, get, dir] of COLS) {
        const av = get(a), bv = get(b), better = dir === 'lo' ? bv < av : bv > av, worse = dir === 'lo' ? bv > av : bv < av;
        if (better) win++; else if (worse) loss++; else tie++;
      }
    }
    return { win, loss, tie };
  });

  const cfgSummary = (c: Record<string, unknown> | null) =>
    (c ? ' · ' + Object.entries(c).map(([k, v]) => (v && typeof v === 'object' ? k : String(v))).join('/') : '');
  const label = (r: Run | null) => (r ? `${r.engine.name}${r.label ? ' · ' + r.label : ''}${cfgSummary(r.config)} · ${r.createdAt.slice(5, 16).replace('T', ' ')}` : '—');
  // compact label for the metrics-table row headers (engine + optional label + HH:MM)
  const shortLabel = (r: Run | null) => (r ? `${r.engine.name}${r.label ? ' ' + r.label : ''} ${r.createdAt.slice(11, 16)}` : '—');

  loadRuns();
  loadPresets();
</script>

<main>
  <header>
    <strong>grale compare</strong>
    {#if presets.length}
      <span class="presets">
        {#each presets as p (p.name)}
          <button type="button" class="chip" onclick={() => usePreset(p)} title={p.command}>{p.name}</button>
        {/each}
      </span>
    {/if}
    <form class="runform" onsubmit={(e) => { e.preventDefault(); startRun(); }}>
      <input placeholder="engine name" bind:value={fName} size="8" />
      <input placeholder="command (or 'dagre')" bind:value={fCommand} size="22" />
      <input placeholder="label (optional)" bind:value={fLabel} size="10" />
      <input placeholder="paths (blank = default)" bind:value={fPaths} size="16" />
      <button type="button" class="ghost" onclick={openBrowse}>📁 browse</button>
      <select bind:value={fAlgorithm} title="elk algorithm (engine config)">
        <option value="">algo: default</option>
        {#each ELK_ALGOS as a (a)}<option value={a}>{a}</option>{/each}
      </select>
      <select bind:value={fRouting} title="elk edge routing (engine config)">
        <option value="">routing: default</option>
        {#each ELK_ROUTING as r (r)}<option value={r}>{r}</option>{/each}
      </select>
      <input
        placeholder={'config JSON e.g. {"elk.spacing.nodeNode":"40"}'}
        title={'free-form engine config (merged into value.meta.engine): ELK elk.* keys or a layoutOptions object; dagre rankdir/ranker/nodesep/…; cale substrate'}
        bind:value={fOptions}
        size="22"
      />
      <button disabled={busy}>{busy ? 'running…' : 'Run'}</button>
    </form>
    {#if error}<span class="err">{error}</span>{/if}
  </header>

  {#if browseOpen}
    <div class="browser">
      <div class="bcrumb">
        <button class="ghost" disabled={!browseRel} onclick={() => browse(parentRel(browseRel))}>↑ up</button>
        <code>{browsePath}</code>
        <span class="spacer"></span>
        <button onclick={useFolder}>use this folder as input →</button>
        <button class="ghost" onclick={() => (browseOpen = false)}>✕</button>
      </div>
      <ul class="bentries">
        {#each browseEntries as e (e.name)}
          <li>
            {#if e.dir}
              <button class="bdir" onclick={() => browse(browseRel ? `${browseRel}/${e.name}` : e.name)}>📁 {e.name}</button>
            {:else}
              <span class="bfile">📄 {e.name}{#if e.format}<em class="fmt">{e.format}</em>{/if}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="pickers">
    <label>A <select bind:value={aId}>
      <option value="">—</option>
      {#each runs as r (r.id)}<option value={r.id}>{label(r)}</option>{/each}
    </select></label>
    <button class="ghost" title="delete run A" disabled={!aId} onclick={() => removeRun(aId)}>🗑</button>
    <label>B <select bind:value={bId}>
      <option value="">—</option>
      {#each runs as r (r.id)}<option value={r.id}>{label(r)}</option>{/each}
    </select></label>
    <button class="ghost" title="delete run B" disabled={!bId} onclick={() => removeRun(bId)}>🗑</button>
    <span class="tally">B vs A — <b style="color:#16a34a">{tally.win}W</b> / <b style="color:#dc2626">{tally.loss}L</b> / {tally.tie}T</span>
    <span class="spacer"></span>
    <button class="ghost" onclick={loadRuns}>↻ refresh</button>
  </div>

  {#if !runs.length}
    <div class="empty">No runs yet. Use the form above to run an engine (try name <code>dagre</code>, command <code>dagre</code>).</div>
  {:else}
    <div class="grid">
      {#each names as name (name)}
        {@const a = metricOf(aRun, name)}
        {@const b = metricOf(bRun, name)}
        {@const aMs = entryOf(aRun, name)?.ms}
        {@const bMs = entryOf(bRun, name)?.ms}
        {@const aAlgo = entryOf(aRun, name)?.algoMs}
        {@const bAlgo = entryOf(bRun, name)?.algoMs}
        <section class="card">
          <h3>{name}</h3>
          {#if pathOf(name)}<div class="path">{pathOf(name)}</div>{/if}
          <table class="metrics">
            <thead><tr><th></th>{#each COLS as [h, , , desc] (h)}<th title={desc}>{h}</th>{/each}<th title={ALGO_DESC}>algo</th><th title={MS_DESC}>total</th></tr></thead>
            <tbody>
              <tr><td class="rlabel" title={label(aRun)}>{shortLabel(aRun)}</td>{#each COLS as [h, get] (h)}<td>{a ? fmt(get(a)) : '–'}</td>{/each}<td class="t">{ms1(aAlgo)}</td><td class="t">{ms1(aMs)}</td></tr>
              <tr><td class="rlabel" title={label(bRun)}>{shortLabel(bRun)}</td>
                {#each COLS as [h, get, dir] (h)}
                  {@const av = a ? get(a) : null}
                  {@const bv = b ? get(b) : null}
                  {@const cls = av == null || bv == null || av === bv ? '' : (dir === 'lo' ? bv < av : bv > av) ? 'good' : 'bad'}
                  <td class={cls}>{b ? fmt(bv!) : '–'}</td>
                {/each}
                <td class="t {bAlgo == null || aAlgo == null || bAlgo === aAlgo ? '' : bAlgo < aAlgo ? 'good' : 'bad'}">{ms1(bAlgo)}</td>
                <td class="t {aMs == null || bMs == null || aMs === bMs ? '' : bMs < aMs ? 'good' : 'bad'}">{ms1(bMs)}</td>
              </tr>
            </tbody>
          </table>
          <div class="panes">
            {#each [['A', aRun], ['B', bRun]] as [side, run] (side)}
              {@const g = run ? graphCache.get(keyOf(run.id, name)) : undefined}
              <figure>
                <figcaption>{side}: {label(run as Run | null)}</figcaption>
                <div class="pane">
                  {#if g}<GraleView graph={g} />
                  {:else}<div class="ph">{run ? 'loading…' : 'no run'}</div>{/if}
                </div>
              </figure>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</main>

<style>
  main { height: 100vh; display: flex; flex-direction: column; font-family: system-ui, sans-serif; color: #1e293b; }
  header { display: flex; gap: 12px; align-items: center; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
  .runform { display: flex; gap: 6px; align-items: center; }
  .runform input { padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font: 12px system-ui; }
  button { padding: 3px 10px; border: 1px solid #cbd5e1; border-radius: 4px; background: #f8fafc; cursor: pointer; font: 12px system-ui; }
  button:hover { background: #eef2ff; }
  .ghost { border-color: transparent; background: transparent; color: #475569; }
  .presets { display: flex; gap: 4px; }
  .chip { padding: 2px 9px; border: 1px solid #c7d2fe; border-radius: 12px; background: #eef2ff; color: #4338ca; cursor: pointer; font: 11px system-ui; }
  .chip:hover { background: #e0e7ff; }
  .err { color: #dc2626; font-size: 12px; }
  .pickers { display: flex; gap: 14px; align-items: center; padding: 6px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; flex-wrap: wrap; }
  .pickers select { font: 12px system-ui; padding: 2px 4px; max-width: 320px; }
  .tally { font-size: 12px; color: #475569; }
  .dbg { display: flex; gap: 5px; align-items: center; }
  .spacer { flex: 1; }
  .browser { border-bottom: 1px solid #e2e8f0; background: #f8fafc; max-height: 280px; display: flex; flex-direction: column; }
  .bcrumb { display: flex; gap: 8px; align-items: center; padding: 6px 12px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
  .bcrumb code { color: #475569; }
  .bentries { list-style: none; margin: 0; padding: 6px 12px; overflow: auto; columns: 3; }
  .bentries li { break-inside: avoid; }
  .bdir { border: none; background: none; cursor: pointer; color: #1d4ed8; font: 12px system-ui; padding: 2px 0; }
  .bdir:hover { text-decoration: underline; }
  .bfile { font: 12px system-ui; color: #475569; }
  .fmt { margin-left: 6px; color: #94a3b8; font-style: normal; font-size: 10px; background: #e2e8f0; padding: 0 5px; border-radius: 8px; }
  .empty { padding: 40px; color: #64748b; text-align: center; }
  .grid { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 16px; }
  .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
  .card h3 { margin: 0 0 2px; font-size: 14px; }
  .path { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #64748b; margin-bottom: 8px; word-break: break-all; user-select: all; }
  .metrics { border-collapse: collapse; font: 11px ui-monospace, monospace; margin-bottom: 8px; }
  .metrics th, .metrics td { padding: 1px 8px; text-align: right; }
  .metrics th:first-child, .metrics td:first-child { text-align: left; color: #94a3b8; }
  .metrics th[title] { cursor: help; text-decoration: underline dotted #cbd5e1; text-underline-offset: 2px; }
  .metrics td.rlabel { color: #475569; font-weight: 600; white-space: nowrap; }
  .metrics th:nth-last-child(2) { border-left: 1px solid #e2e8f0; } /* 'algo' header — start of timing group */
  .metrics td.t { color: #64748b; }
  .metrics td.t:nth-last-child(2) { border-left: 1px solid #e2e8f0; } /* algo cell — start of timing group */
  .metrics .good { color: #16a34a; font-weight: 600; }
  .metrics .bad { color: #dc2626; font-weight: 600; }
  .panes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  figure { margin: 0; }
  figcaption { font-size: 11px; color: #64748b; margin-bottom: 3px; }
  .pane { height: 260px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
  .ph { height: 100%; display: grid; place-items: center; color: #94a3b8; font-size: 12px; }
</style>
