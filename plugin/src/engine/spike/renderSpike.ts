/**
 * renderSpike — throwaway maxGraph rendering-parity harness (Task 3 RISK GATE).
 *
 * Proves that `@maxgraph/core` can render a draw.io / mxGraph diagram with no
 * `eval` and no global/`globalThis`/`mx*` mutation. It:
 *   1. decodes the source via `diagramCodec` if it is an encoded diagram,
 *   2. instantiates `new Graph(container)` from `@maxgraph/core` (ESM import),
 *   3. decodes the XML into the model via a Codec inside `model.batchUpdate(...)`,
 *   4. renders into the supplied DOM container.
 *
 * It also exposes a pure `inspectModel` so tests can assert the resulting model
 * structure (vertices, edges, labels, geometry, styles) — the CI-friendly stand
 * in for a visual screenshot.
 *
 * This module is intentionally disposable; the production engine lands in
 * `engine/XGraph.ts` (Task 7). Nothing here mutates globals or calls `eval`.
 */
import { Graph, Cell, ModelXmlSerializer } from '@maxgraph/core';
import { decode, isEncoded } from '../diagramCodec';

/** Flattened description of a single cell in the rendered model. */
export interface InspectedCell {
  id: string;
  value: string | null;
  isVertex: boolean;
  isEdge: boolean;
  style: string;
  geometry: { x: number; y: number; width: number; height: number } | null;
  sourceId: string | null;
  targetId: string | null;
}

/** Structural summary of a rendered maxGraph model. */
export interface ModelInspection {
  vertexCount: number;
  edgeCount: number;
  cells: InspectedCell[];
  labels: string[];
}

/**
 * Normalize a maxGraph cell style (which may be an object or a legacy style
 * string) into a comparable string for assertions.
 */
function styleToString(style: unknown): string {
  if (style == null) {
    return '';
  }
  if (typeof style === 'string') {
    return style;
  }
  // maxGraph 0.25 uses a CellStyle object. Flatten to `key=value;` pairs.
  try {
    return Object.entries(style as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(';');
  } catch {
    return String(style);
  }
}

/**
 * Render a draw.io / mxGraph XML source into a DOM container using
 * `@maxgraph/core`. Decodes the source first if it is an encoded diagram.
 *
 * @param container The host DOM element.
 * @param source mxGraph XML, or a pako/base64-encoded diagram.
 * @returns The live `Graph` instance (caller owns teardown via `graph.destroy()`).
 */
export function renderDiagram(container: HTMLElement, source: string): Graph {
  const xml = isEncoded(source) ? decode(source) : source;

  // ESM import — no eval, no global mutation.
  const graph = new Graph(container);
  const model = graph.getDataModel();

  // Decode the XML into the model via the Codec-backed serializer, wrapped in a
  // single batched update (the typed replacement for beginUpdate/endUpdate).
  model.batchUpdate(() => {
    new ModelXmlSerializer(model).import(xml);
  });

  return graph;
}

/**
 * Inspect a rendered `Graph`'s model and return a structural summary suitable
 * for assertions in a jsdom test.
 *
 * @param graph A `Graph` instance populated by `renderDiagram`.
 * @returns The model inspection summary.
 */
export function inspectModel(graph: Graph): ModelInspection {
  const model = graph.getDataModel();
  const cells: InspectedCell[] = [];
  let vertexCount = 0;
  let edgeCount = 0;

  // `model.cells` maps id -> Cell. Skip the root and default layer cells.
  const all: Record<string, Cell> = (model as unknown as { cells: Record<string, Cell> }).cells ?? {};
  for (const id of Object.keys(all)) {
    const cell = all[id];
    if (!cell) {
      continue;
    }
    const isVertex = cell.isVertex();
    const isEdge = cell.isEdge();
    if (!isVertex && !isEdge) {
      // root / layer cells — ignore for parity accounting.
      continue;
    }
    if (isVertex) {
      vertexCount++;
    }
    if (isEdge) {
      edgeCount++;
    }
    const geo = cell.getGeometry();
    const value = cell.getValue();
    cells.push({
      id: String(cell.getId()),
      value: value == null ? null : String(value),
      isVertex,
      isEdge,
      style: styleToString(cell.getStyle()),
      geometry: geo
        ? { x: geo.x, y: geo.y, width: geo.width, height: geo.height }
        : null,
      sourceId: cell.source ? String(cell.source.getId()) : null,
      targetId: cell.target ? String(cell.target.getId()) : null,
    });
  }

  const labels = cells
    .map((c) => c.value)
    .filter((v): v is string => v != null && v.length > 0);

  return { vertexCount, edgeCount, cells, labels };
}

/**
 * A small, representative infra-topology sample authored as mxGraph XML:
 * three boxes (web -> app -> db) connected by two edges, with labels, explicit
 * geometry, and basic fill-color styles. Used by the spike and its test.
 */
export const SAMPLE_INFRA_TOPOLOGY_XML = `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="web" value="web" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
      <mxGeometry x="40" y="40" width="120" height="60" as="geometry" />
    </mxCell>
    <mxCell id="app" value="app" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">
      <mxGeometry x="240" y="40" width="120" height="60" as="geometry" />
    </mxCell>
    <mxCell id="db" value="db" style="shape=cylinder;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;" vertex="1" parent="1">
      <mxGeometry x="440" y="40" width="120" height="80" as="geometry" />
    </mxCell>
    <mxCell id="e1" value="http" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="web" target="app">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="e2" value="sql" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="app" target="db">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>`;
