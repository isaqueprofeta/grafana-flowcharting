/**
 * SpikePanel — throwaway React harness for the Task 3 maxGraph rendering-parity
 * SPIKE (RISK GATE). It mounts a DOM container through a React ref and renders a
 * draw.io / mxGraph diagram into it via `@maxgraph/core` using the spike's
 * `renderDiagram`.
 *
 * Purpose: prove that a sample diagram renders STATICALLY inside a panel-mounted
 * React container with:
 *   - an ESM `@maxgraph/core` import (via renderSpike),
 *   - NO `eval`,
 *   - NO global / `globalThis` / `mx*` namespace mutation,
 *   - React-conventional mount/unmount lifecycle (effect sets up the Graph,
 *     cleanup calls `graph.destroy()` and releases the container).
 *
 * This module is intentionally disposable. The production panel + engine land in
 * `components/FlowchartingPanel.tsx` and `engine/XGraph.ts` (Tasks 7-8). Nothing
 * here mutates globals or calls `eval`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Graph } from '@maxgraph/core';
import { renderDiagram, SAMPLE_INFRA_TOPOLOGY_XML } from './renderSpike';

export interface SpikePanelProps {
  /** mxGraph XML, or a pako/base64-encoded diagram. Defaults to the sample topology. */
  source?: string;
  width?: number;
  height?: number;
}

/**
 * Render a diagram statically inside a React-managed container using maxGraph.
 * Reports a decode/render failure through an inline message rather than throwing
 * out of render (the production path routes this to a `@grafana/ui` Alert in
 * Task 8).
 */
export function SpikePanel({ source = SAMPLE_INFRA_TOPOLOGY_XML, width = 800, height = 600 }: SpikePanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    let graph: Graph | undefined;
    try {
      setError(null);
      graph = renderDiagram(container, source);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // React-conventional teardown: release the engine + its DOM on unmount or
    // when the source changes. Mirrors the Panel_Component cleanup contract
    // (Requirement 7.8).
    return () => {
      graph?.destroy();
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [source]);

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden' }}>
      {error && (
        <div role="alert" data-testid="spike-error" style={{ color: 'red' }}>
          {error}
        </div>
      )}
      <div ref={containerRef} data-testid="spike-graph-container" style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
