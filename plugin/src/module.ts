/**
 * module.ts — the Module_Entry (design.md: "Module_Entry (module.ts)",
 * Req 7.2, 5.3, 5.4).
 *
 * Exports a `PanelPlugin<FlowchartingOptions>` that registers the React
 * {@link FlowchartingPanel} as the panel component (Req 7.2) and seeds the
 * clean Options_Schema defaults (types/options).
 *
 * Simple scalar settings are registered with the standard
 * `PanelOptionsEditorBuilder` builders (`addRadio`/`addSelect`/`addTextInput`/
 * `addBooleanSwitch`/`addColorPicker`), following the design.md "Module_Entry"
 * sketch (Req 5.4):
 *   - source type (xml/csv) and the per-flowchart scalar toggles on
 *     `flowcharts.0.*` (zoom/scale/center/lock/grid/animation/tooltip/bgColor);
 *   - editor URL / theme / `allowDrawio` on `editor.*`;
 *   - inspect enable on `inspect.enabled`.
 *
 * The light custom editors (SourceEditor, FlowchartListEditor, InspectTab) are
 * registered below via `addCustomEditor`, alongside the scalar builders. The
 * SourceEditor and FlowchartListEditor both bind `path: 'flowcharts'`, so they
 * carry distinct `id`s (`addCustomEditor` requires unique ids). The
 * Rules_Editor is wired in a later task.
 */
import { PanelPlugin } from '@grafana/data';
import { FlowchartingOptions, defaultFlowchartingOptions } from './types/options';
import { FlowchartingPanel } from './components/FlowchartingPanel';
import { SourceEditor } from './components/editors/SourceEditor';
import { FlowchartListEditor } from './components/editors/FlowchartListEditor';
import { RulesEditor } from './components/editors/RulesEditor';
import { InspectTab } from './components/InspectTab';

export const plugin = new PanelPlugin<FlowchartingOptions>(FlowchartingPanel)
  .setPanelOptions((builder) => {
    return (
      builder
        // --- Diagram source (per-flowchart scalar settings) --------------------
        .addRadio({
          path: 'flowcharts.0.type',
          name: 'Source type',
          description: 'Diagram source format.',
          defaultValue: 'xml',
          category: ['Flowchart'],
          settings: {
            options: [
              { value: 'xml', label: 'XML' },
              { value: 'csv', label: 'CSV' },
            ],
          },
        })
        .addTextInput({
          path: 'flowcharts.0.zoom',
          name: 'Zoom',
          description: 'Initial zoom level, e.g. "100%" or "0" to fit.',
          defaultValue: '100%',
          category: ['Flowchart'],
        })
        .addBooleanSwitch({
          path: 'flowcharts.0.scale',
          name: 'Scale',
          description: 'Scale the diagram to fit the panel.',
          defaultValue: true,
          category: ['Flowchart'],
        })
        .addBooleanSwitch({
          path: 'flowcharts.0.center',
          name: 'Center',
          description: 'Center the diagram in the panel.',
          defaultValue: true,
          category: ['Flowchart'],
        })
        .addBooleanSwitch({
          path: 'flowcharts.0.lock',
          name: 'Lock',
          description: 'Lock the diagram (disable user pan/zoom).',
          defaultValue: true,
          category: ['Flowchart'],
        })
        .addBooleanSwitch({
          path: 'flowcharts.0.grid',
          name: 'Grid',
          description: 'Show the background grid.',
          defaultValue: false,
          category: ['Flowchart'],
        })
        .addBooleanSwitch({
          path: 'flowcharts.0.enableAnim',
          name: 'Animation',
          description: 'Animate style changes on the diagram.',
          defaultValue: true,
          category: ['Flowchart'],
        })
        .addBooleanSwitch({
          path: 'flowcharts.0.tooltip',
          name: 'Tooltip',
          description: 'Enable tooltips on diagram cells.',
          defaultValue: true,
          category: ['Flowchart'],
        })
        .addColorPicker({
          path: 'flowcharts.0.bgColor',
          name: 'Background color',
          description: 'Panel background color behind the diagram.',
          category: ['Flowchart'],
        })
        // --- Editor (draw.io) settings ----------------------------------------
        .addTextInput({
          path: 'editor.editorUrl',
          name: 'Editor URL',
          description: 'draw.io / mxGraph editor URL.',
          defaultValue: defaultFlowchartingOptions.editor.editorUrl,
          category: ['Editor'],
        })
        .addSelect({
          path: 'editor.editorTheme',
          name: 'Editor theme',
          defaultValue: defaultFlowchartingOptions.editor.editorTheme,
          category: ['Editor'],
          settings: {
            options: [
              { value: 'dark', label: 'Dark' },
              { value: 'kennedy', label: 'Light' },
              { value: 'minimal', label: 'Mobile' },
              { value: 'atlas', label: 'Atlas' },
            ],
          },
        })
        .addBooleanSwitch({
          path: 'editor.allowDrawio',
          name: 'Allow draw.io editing',
          defaultValue: defaultFlowchartingOptions.editor.allowDrawio,
          category: ['Editor'],
        })
        // --- Inspect ----------------------------------------------------------
        .addBooleanSwitch({
          path: 'inspect.enabled',
          name: 'Enable inspect',
          description: 'Show the cell-metadata inspect tab.',
          defaultValue: defaultFlowchartingOptions.inspect?.enabled ?? false,
          category: ['Inspect'],
        })
        // --- Light custom editors (structured settings) -----------------------
        // FlowchartListEditor and SourceEditor both bind `path: 'flowcharts'`;
        // they carry distinct ids because addCustomEditor requires unique ids.
        .addCustomEditor({
          id: 'flowchart-list',
          path: 'flowcharts',
          name: 'Flowcharts',
          category: ['Flowchart'],
          editor: FlowchartListEditor,
        })
        .addCustomEditor({
          id: 'source',
          path: 'flowcharts',
          name: 'Diagram source',
          category: ['Flowchart'],
          editor: SourceEditor,
        })
        // Bespoke Rules_Editor (Task 10.1): authors the full RuleOptions[]
        // structure (pattern, metric binding, enable, order, thresholds).
        .addCustomEditor({
          id: 'rules',
          path: 'rules',
          name: 'Rules',
          category: ['Rules'],
          editor: RulesEditor,
        })
        .addCustomEditor({
          id: 'inspect',
          path: 'inspect',
          name: 'Inspect',
          category: ['Inspect'],
          editor: InspectTab,
        })
    );
  });
