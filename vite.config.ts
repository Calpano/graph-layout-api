import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { runnerPlugin } from './viewer/runner-plugin.js';

// The viewer lives in `viewer/` and imports the shared renderer from `src/`.
// Only `GraleElement.svelte` is compiled to a custom element (<grale-view>);
// every other component stays a normal Svelte component. `runnerPlugin` adds the
// /api backend that runs engines and serves snapshot run dirs.
export default defineConfig({
  root: 'viewer',
  plugins: [
    svelte({
      dynamicCompileOptions({ filename }) {
        if (filename.includes('GraleElement')) return { customElement: true };
      },
    }),
    runnerPlugin(),
  ],
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../dist-viewer', emptyOutDir: true },
});
