/**
 * SourceEditor — custom panel-option editor for a flowchart's diagram source
 * (design.md "Options_Editor (hybrid)" / editors/SourceEditor.tsx, Req 5.5).
 *
 * The legacy Angular `flowchart_options` tab authored the diagram source for a
 * flowchart: a source TYPE (`xml` | `csv`), the inline `xml`/`csv` content, and
 * an optional `url` (with a `download` toggle) to load the source from a remote
 * location. This React custom editor reproduces that authoring surface for the
 * ACTIVE flowchart of the clean Options_Schema `flowcharts[]` array.
 *
 * Registration (handled by Task 9.1 in module.ts via `addCustomEditor`) binds
 * this editor at `path: 'flowcharts'`, so `value` is the full `flowcharts[]`
 * array and `onChange` replaces that array. This editor edits a single active
 * flowchart (default: index 0 — the panel navigates among flowcharts at
 * runtime; multi-flowchart management lives in {@link FlowchartListEditor}).
 *
 * Input methods supported (Req 4.8 "load diagrams from CSV/XML/URL sources"):
 *   - paste  : type/paste directly into the TextArea
 *   - upload : read a local file into the inline source via FileUpload
 *   - URL    : set the `url` field (+ `download` toggle) for remote load
 *
 * Uses only `@grafana/ui` components and the `StandardEditorProps` type from
 * `@grafana/data`. No `$GF`, Angular, or global coupling.
 */
import React, { useState } from 'react';
import { StandardEditorProps } from '@grafana/data';
import {
  Button,
  Field,
  FileUpload,
  Input,
  RadioButtonGroup,
  Select,
  TextArea,
} from '@grafana/ui';
import {
  FlowchartOptions,
  SourceType,
  defaultFlowchartingOptions,
} from '../../types/options';

/**
 * A fresh flowchart with schema defaults. The array may be empty on a brand-new
 * panel; the editor seeds the first entry so the user has something to author.
 */
export function createDefaultFlowchart(name = 'Main'): FlowchartOptions {
  return {
    name,
    type: 'xml',
    xml: '',
    csv: '',
    url: '',
    download: false,
    zoom: '100%',
    scale: true,
    center: true,
    lock: true,
    grid: false,
    enableAnim: true,
    tooltip: true,
    bgColor: null,
  };
}

const SOURCE_TYPE_OPTIONS: Array<{ label: string; value: SourceType }> = [
  { label: 'XML', value: 'xml' },
  { label: 'CSV', value: 'csv' },
];

type Props = StandardEditorProps<FlowchartOptions[]>;

export const SourceEditor: React.FC<Props> = ({ value, onChange }) => {
  const flowcharts = Array.isArray(value) ? value : [];
  // The editor edits one active flowchart; selection tracks a valid index.
  const [activeIndex, setActiveIndex] = useState(0);

  const safeIndex = flowcharts.length === 0 ? 0 : Math.min(activeIndex, flowcharts.length - 1);
  const active: FlowchartOptions =
    flowcharts[safeIndex] ?? createDefaultFlowchart(defaultFlowchartingOptions.flowcharts[0]?.name ?? 'Main');

  /** Replace the active flowchart with a patched copy and emit the new array. */
  const patchActive = (patch: Partial<FlowchartOptions>) => {
    const next = flowcharts.length === 0 ? [active] : [...flowcharts];
    next[safeIndex] = { ...active, ...patch };
    onChange(next);
  };

  const onUpload = (event: React.FormEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      patchActive(active.type === 'csv' ? { csv: text } : { xml: text });
    };
    reader.readAsText(file);
  };

  const sourceValue = active.type === 'csv' ? active.csv : active.xml;
  const sourcePlaceholder =
    active.type === 'csv'
      ? 'Paste CSV source here, or upload a file / load from a URL below'
      : 'Paste mxGraph / draw.io XML here, or upload a file / load from a URL below';

  return (
    <div data-testid="source-editor">
      {flowcharts.length > 1 && (
        <Field label="Active flowchart" description="Edit the source of the selected flowchart.">
          <Select
            aria-label="Active flowchart"
            value={safeIndex}
            options={flowcharts.map((f, i) => ({ label: f.name || `Flowchart ${i + 1}`, value: i }))}
            onChange={(sel) => setActiveIndex(typeof sel.value === 'number' ? sel.value : 0)}
          />
        </Field>
      )}

      <Field label="Source type" description="Format of the inline diagram source.">
        <RadioButtonGroup<SourceType>
          options={SOURCE_TYPE_OPTIONS}
          value={active.type}
          onChange={(type) => patchActive({ type })}
        />
      </Field>

      <Field label="Diagram source" description="Paste the diagram source, or use upload / URL below.">
        <TextArea
          aria-label="Diagram source"
          rows={10}
          value={sourceValue}
          placeholder={sourcePlaceholder}
          onChange={(e) =>
            patchActive(
              active.type === 'csv'
                ? { csv: e.currentTarget.value }
                : { xml: e.currentTarget.value }
            )
          }
        />
      </Field>

      <Field label="Upload source file" description="Read a local file into the inline source.">
        <FileUpload
          accept={active.type === 'csv' ? '.csv,text/csv' : '.xml,.drawio,text/xml,application/xml'}
          onFileUpload={onUpload}
        >
          Upload {active.type.toUpperCase()} file
        </FileUpload>
      </Field>

      <Field label="Source URL" description="Load the diagram source from a remote URL.">
        <Input
          aria-label="Source URL"
          type="url"
          value={active.url}
          placeholder="https://example.com/diagram.xml"
          onChange={(e) => patchActive({ url: e.currentTarget.value })}
        />
      </Field>

      <Field
        label="Download from URL"
        description="When enabled, the diagram source is fetched from the URL at render time."
      >
        <RadioButtonGroup<boolean>
          options={[
            { label: 'Off', value: false },
            { label: 'On', value: true },
          ]}
          value={active.download}
          onChange={(download) => patchActive({ download })}
        />
      </Field>

      {flowcharts.length === 0 && (
        <Button
          variant="secondary"
          icon="plus"
          onClick={() => onChange([createDefaultFlowchart()])}
          data-testid="source-editor-create-first"
        >
          Add a flowchart
        </Button>
      )}
    </div>
  );
};
