/**
 * FlowchartListEditor — custom panel-option editor for managing the set of
 * flowcharts (design.md "Options_Editor (hybrid)" / editors/FlowchartListEditor.tsx,
 * Req 5.5, 4.7 multi-flowchart navigation).
 *
 * A diagram may hold multiple flowcharts; the panel navigates among them at
 * runtime (Req 4.7). This editor authors the `flowcharts[]` array itself:
 *   - add    : append a new flowchart with schema defaults
 *   - remove : delete a flowchart by index
 *   - reorder: move a flowchart up/down (navigation order)
 *   - select : rename the entry and mark the active/selected one
 *
 * Registration (Task 9.1 in module.ts via `addCustomEditor`) binds this editor
 * at `path: 'flowcharts'`, so `value` is the full `flowcharts[]` array and
 * `onChange` replaces that array. Source authoring for the selected flowchart
 * lives in the sibling {@link SourceEditor}.
 *
 * Uses only `@grafana/ui` components and the `StandardEditorProps` type from
 * `@grafana/data`. No `$GF`, Angular, or global coupling.
 */
import React, { useState } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Button, Field, IconButton, Input, InlineField } from '@grafana/ui';
import { FlowchartOptions } from '../../types/options';
import { createDefaultFlowchart } from './SourceEditor';

type Props = StandardEditorProps<FlowchartOptions[]>;

export const FlowchartListEditor: React.FC<Props> = ({ value, onChange }) => {
  const flowcharts = Array.isArray(value) ? value : [];
  const [selectedIndex, setSelectedIndex] = useState(0);

  const emit = (next: FlowchartOptions[]) => onChange(next);

  const addFlowchart = () => {
    const next = [...flowcharts, createDefaultFlowchart(`Flowchart ${flowcharts.length + 1}`)];
    emit(next);
    setSelectedIndex(next.length - 1);
  };

  const removeFlowchart = (index: number) => {
    const next = flowcharts.filter((_, i) => i !== index);
    emit(next);
    setSelectedIndex((prev) => Math.max(0, Math.min(prev, next.length - 1)));
  };

  const moveFlowchart = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= flowcharts.length) {
      return;
    }
    const next = [...flowcharts];
    [next[index], next[target]] = [next[target], next[index]];
    emit(next);
    setSelectedIndex(target);
  };

  const renameFlowchart = (index: number, name: string) => {
    const next = [...flowcharts];
    next[index] = { ...next[index], name };
    emit(next);
  };

  return (
    <div data-testid="flowchart-list-editor">
      <Field
        label="Flowcharts"
        description="Manage the diagrams in this panel. The panel navigates between them in this order."
      >
        <div>
          {flowcharts.length === 0 && (
            <div data-testid="flowchart-list-empty" style={{ marginBottom: 8 }}>
              No flowcharts yet.
            </div>
          )}

          {flowcharts.map((flowchart, index) => (
            <div
              key={index}
              data-testid={`flowchart-list-row-${index}`}
              style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}
            >
              <IconButton
                name="check"
                tooltip={`Select flowchart ${index + 1}`}
                variant={index === selectedIndex ? 'primary' : 'secondary'}
                onClick={() => setSelectedIndex(index)}
              />
              <InlineField grow>
                <Input
                  aria-label={`Flowchart name ${index + 1}`}
                  value={flowchart.name}
                  placeholder={`Flowchart ${index + 1}`}
                  onChange={(e) => renameFlowchart(index, e.currentTarget.value)}
                />
              </InlineField>
              <IconButton
                name="arrow-up"
                tooltip={`Move flowchart ${index + 1} up`}
                disabled={index === 0}
                onClick={() => moveFlowchart(index, -1)}
              />
              <IconButton
                name="arrow-down"
                tooltip={`Move flowchart ${index + 1} down`}
                disabled={index === flowcharts.length - 1}
                onClick={() => moveFlowchart(index, 1)}
              />
              <IconButton
                name="trash-alt"
                tooltip={`Remove flowchart ${index + 1}`}
                onClick={() => removeFlowchart(index)}
              />
            </div>
          ))}

          <Button
            variant="secondary"
            icon="plus"
            onClick={addFlowchart}
            data-testid="flowchart-list-add"
          >
            Add flowchart
          </Button>
        </div>
      </Field>
    </div>
  );
};
