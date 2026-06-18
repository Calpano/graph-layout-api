/**
 * grale layout-quality metrics — score a result graph's geometry.
 *
 * Framework-agnostic and DOM-free; backs the `grale-metrics` CLI and can run
 * in the browser alongside the renderer.
 */
export { computeMetrics } from './metrics.js';
export type { LayoutMetrics, MetricsOptions, EdgeLengthStats } from './metrics.js';
