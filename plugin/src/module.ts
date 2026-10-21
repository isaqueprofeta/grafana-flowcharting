/**
 * module.ts — the Module_Entry (design.md: "Module_Entry (module.ts)",
 * Req 7.2, 5.4).
 *
 * Exports a `PanelPlugin<FlowchartingOptions>` that registers the React
 * {@link FlowchartingPanel} as the panel component (Req 7.2) and seeds the
 * clean Options_Schema defaults (types/options). Simple scalar settings are
 * registered with `setPanelOptions` builders (Req 5.4); the structured editors
 * (Rules_Editor, SourceEditor, FlowchartListEditor, InspectTab) are added in
 * Task 9 via `addCustomEditor` and are intentionally left out of this MVP
 * registration so the panel builds and renders with live data (Task 8 MVP).
 */
import { PanelPlugin } from '@grafana/data';
import { FlowchartingOptions, defaultFlowchartingOptions } from './types/options';
import { FlowchartingPanel } from './components/FlowchartingPanel';

export const plugin = new PanelPlugin<FlowchartingOptions>(FlowchartingPanel)
  .setPanelOptions((builder) => {
    return builder
      .addTextInput({
        path: 'editor.editorUrl',
        name: 'Editor URL',
        description: 'draw.io / mxGraph editor URL. Structured editors are added in Task 9.',
        defaultValue: defaultFlowchartingOptions.editor.editorUrl,
      })
      .addSelect({
        path: 'editor.editorTheme',
        name: 'Editor theme',
        defaultValue: defaultFlowchartingOptions.editor.editorTheme,
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
      });
  });
