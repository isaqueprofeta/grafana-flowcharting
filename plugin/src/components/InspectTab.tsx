/**
 * InspectTab — custom panel-option editor that surfaces the inspect tab
 * (design.md "editors/InspectTab.tsx", Req 4.9 "provide an inspect tab").
 *
 * The legacy Angular inspect tab let authors inspect the cells of the rendered
 * diagram (ids, labels, styles) to help build rule patterns. At runtime the
 * live engine (the panel's `FlowchartHandler`) holds the rendered graph, so the
 * authoritative live-cell inspect is wired there. For the EDITOR side, this tab
 * reads the configured flowcharts' source directly and derives the structural
 * cell metadata (id / label / style / kind) from the mxGraph model — a pure,
 * engine-free extraction built on the shared {@link decode} codec and the DOM
 * `DOMParser` (same approach as `diagramCodec.isValidXml`). This gives authors
 * a usable inspect surface without coupling the editor to the live engine.
 *
 * Registration (Task 9.1 in module.ts via `addCustomEditor`) binds this editor
 * at `path: 'inspect'`, so `value` is the `{ enabled }` inspect option and
 * `onChange` updates it. The structural cell inspection reads the sibling
 * `flowcharts` via `context.options`.
 *
 * Uses only `@grafana/ui` components and the `StandardEditorProps` type from
 * `@grafana/data`. No `$GF`, Angular, or global coupling.
 */
import React, { useMemo, useState } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Field, Select, Switch } from '@grafana/ui';
import { FlowchartOptions, FlowchartingOptions } from '../types/options';
import { decode, isEncoded } from '../engine/diagramCodec';

/** Structural metadata for a single diagram cell, derived from the model XML. */
export interface InspectedCell {
  id: string;
  label: string;
  kind: 'vertex' | 'edge' | 'other';
  style: string;
}

/**
 * Resolve the mxGraph XML for a flowchart's configured source. Returns the
 * decoded XML, or `null` when the source is empty / not inspectable from the
 * editor (e.g. a URL-only source loaded at render time).
 */
function resolveXml(flowchart: FlowchartOptions): string | null {
  if (flowchart.type !== 'xml') {
    return null;
  }
  const raw = flowchart.xml?.trim();
  if (!raw) {
    return null;
  }
  try {
    return isEncoded(raw) ? decode(raw) : raw;
  } catch {
    return null;
  }
}

/**
 * Pure, engine-free extraction of cell metadata from mxGraph XML. Walks every
 * `<mxCell>` and reports its id, label (`value`), style, and kind (vertex /
 * edge / other) — the same data the live inspect surfaces, derived structurally.
 */
export function inspectCells(xml: string): InspectedCell[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return [];
  }
  const cells = Array.from(doc.getElementsByTagName('mxCell'));
  return cells
    .filter((cell) => {
      const id = cell.getAttribute('id');
      // Skip the two implicit root cells (ids "0" and "1") with no content.
      return id !== '0' && id !== '1';
    })
    .map((cell) => {
      const isEdge = cell.getAttribute('edge') === '1';
      const isVertex = cell.getAttribute('vertex') === '1';
      return {
        id: cell.getAttribute('id') ?? '',
        label: cell.getAttribute('value') ?? '',
        kind: isEdge ? 'edge' : isVertex ? 'vertex' : 'other',
        style: cell.getAttribute('style') ?? '',
      } as InspectedCell;
    });
}

type Props = StandardEditorProps<{ enabled: boolean } | undefined, unknown, FlowchartingOptions>;

export const InspectTab: React.FC<Props> = ({ value, onChange, context }) => {
  const enabled = value?.enabled ?? false;
  const flowcharts: FlowchartOptions[] = context?.options?.flowcharts ?? [];
  const [selectedIndex, setSelectedIndex] = useState(0);

  const safeIndex = flowcharts.length === 0 ? 0 : Math.min(selectedIndex, flowcharts.length - 1);
  const active = flowcharts[safeIndex];

  const cells = useMemo(() => {
    if (!active) {
      return [];
    }
    const xml = resolveXml(active);
    return xml ? inspectCells(xml) : [];
  }, [active]);

  return (
    <div data-testid="inspect-tab">
      <Field label="Enable inspect" description="Expose the inspect tab for this panel at runtime.">
        <Switch
          value={enabled}
          onChange={(e) => onChange({ enabled: e.currentTarget.checked })}
        />
      </Field>

      {flowcharts.length > 1 && (
        <Field label="Flowchart" description="Inspect the cells of the selected flowchart.">
          <Select
            aria-label="Inspect flowchart"
            value={safeIndex}
            options={flowcharts.map((f, i) => ({ label: f.name || `Flowchart ${i + 1}`, value: i }))}
            onChange={(sel) => setSelectedIndex(typeof sel.value === 'number' ? sel.value : 0)}
          />
        </Field>
      )}

      <Field label="Cells" description="Structural cell metadata derived from the configured diagram source.">
        <div data-testid="inspect-cells">
          {flowcharts.length === 0 && <div>No flowcharts configured.</div>}
          {flowcharts.length > 0 && cells.length === 0 && (
            <div data-testid="inspect-no-cells">
              No inspectable cells. The source may be empty, URL-only, or CSV (inspected live at render time).
            </div>
          )}
          {cells.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Id</th>
                  <th style={{ textAlign: 'left' }}>Label</th>
                  <th style={{ textAlign: 'left' }}>Kind</th>
                  <th style={{ textAlign: 'left' }}>Style</th>
                </tr>
              </thead>
              <tbody>
                {cells.map((cell) => (
                  <tr key={cell.id} data-testid={`inspect-cell-${cell.id}`}>
                    <td>{cell.id}</td>
                    <td>{cell.label}</td>
                    <td>{cell.kind}</td>
                    <td style={{ wordBreak: 'break-all' }}>{cell.style}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Field>
    </div>
  );
};
