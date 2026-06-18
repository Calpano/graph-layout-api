/**
 * Vite dev-server backend for the compare app. Exposes a tiny JSON API over the
 * shared run core (scripts/runner.mjs):
 *
 *   GET  /api/runs                       list run manifests (newest first)
 *   GET  /api/inputs                     default input path(s)
 *   GET  /api/runs/:id/graph/:name       a run's laid-out grale graph (JSON)
 *   POST /api/run   { name, command, label, paths }   run an engine → new snapshot
 *
 * Runs in Vite's Node process (cwd = repo root), so it can spawn engines and
 * write under examples/runs/.
 */
import { listRuns, runEngine, loadRunGraph, deleteRun, browseDir, loadEngineConfig, builtinEngines, DEFAULT_INPUTS } from '../scripts/runner.mjs';

const send = (res, body, status = 200) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });

export function runnerPlugin() {
  return {
    name: 'grale-runner',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const full = req.url || '';
        const url = full.split('?')[0];
        if (!url.startsWith('/api/')) return next();
        try {
          if (req.method === 'GET' && url === '/api/runs') return send(res, listRuns());
          if (req.method === 'GET' && url === '/api/inputs') return send(res, { paths: [DEFAULT_INPUTS] });
          if (req.method === 'GET' && url === '/api/engines') {
            const builtin = builtinEngines();
            const extra = loadEngineConfig().filter((e) => !builtin.some((b) => b.name === e.name));
            return send(res, [...builtin, ...extra]);
          }
          if (req.method === 'GET' && url === '/api/browse') {
            const rel = new URLSearchParams(full.split('?')[1] || '').get('rel') || '';
            return send(res, browseDir(rel));
          }

          const g = url.match(/^\/api\/runs\/([^/]+)\/graph\/([^/]+)$/);
          if (req.method === 'GET' && g) {
            return send(res, loadRunGraph(decodeURIComponent(g[1]), decodeURIComponent(g[2])));
          }

          const del = url.match(/^\/api\/runs\/([^/]+)$/);
          if (req.method === 'DELETE' && del) {
            const ok = deleteRun(decodeURIComponent(del[1]));
            return send(res, { deleted: ok }, ok ? 200 : 404);
          }

          if (req.method === 'POST' && url === '/api/run') {
            const { name, command, label, paths, config } = JSON.parse((await readBody(req)) || '{}');
            if (!name) return send(res, { error: 'name required' }, 400);
            const manifest = runEngine({ name, command, label, config }, Array.isArray(paths) ? paths : []);
            return send(res, manifest);
          }
          return send(res, { error: `no route: ${req.method} ${url}` }, 404);
        } catch (e) {
          return send(res, { error: e instanceof Error ? e.message : String(e) }, 500);
        }
      });
    },
  };
}
