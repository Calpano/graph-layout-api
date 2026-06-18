<svelte:options
  customElement={{
    tag: 'grale-view',
    props: {
      graph: { type: 'Object' },
      debug: { type: 'Boolean' },
      padding: { type: 'Number' },
    },
  }}
/>

<script lang="ts">
  import GraleView from './GraleView.svelte';

  // Standalone web component: <grale-view> with a `graph` JSON property,
  // a boolean `debug` attribute and a numeric `padding`. Delegates rendering
  // and pan/zoom to the shared GraleView component.
  let {
    graph = null,
    debug = false,
    padding = 24,
  }: { graph?: unknown; debug?: boolean; padding?: number } = $props();
</script>

<GraleView {graph} {debug} {padding} />

<style>
  :host {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
