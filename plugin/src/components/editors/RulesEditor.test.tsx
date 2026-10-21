/**
 * Feature: angular-to-react-migration — Task 10.1 bespoke Rules editor.
 *
 * Verifies the {@link RulesEditor} custom panel-option editor renders its
 * authoring surface, adds a rule, and edits a threshold, emitting the updated
 * `RuleOptions[]` back through the `StandardEditorProps.onChange` contract
 * (Req 4.1, 4.2, 5.6). Follows the SourceEditor.test.tsx
 * @testing-library/react pattern.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { StandardEditorProps } from '@grafana/data';
import { RulesEditor, createDefaultRule } from './RulesEditor';
import { RuleOptions } from '../../types/options';

/** Minimal StandardEditorProps harness — only value/onChange matter here. */
function renderEditor(value: RuleOptions[], onChange = jest.fn()) {
  const props = {
    value,
    onChange,
    context: { data: [] },
    item: { id: 'rules', name: 'Rules', editor: () => null },
  } as unknown as StandardEditorProps<RuleOptions[]>;
  render(<RulesEditor {...props} />);
  return { onChange };
}

describe('RulesEditor — rule scaffolding and threshold authoring', () => {
  test('renders the rules authoring surface', () => {
    renderEditor([createDefaultRule(0, 'Main')]);
    expect(screen.getByTestId('rules-editor')).toBeInTheDocument();
    expect(screen.getByTestId('rules-editor-row-0')).toBeInTheDocument();
    expect(screen.getByLabelText('Rule pattern')).toBeInTheDocument();
  });

  test('shows the empty state and adds a rule via onChange', () => {
    const { onChange } = renderEditor([]);
    expect(screen.getByTestId('rules-editor-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('rules-editor-add'));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as RuleOptions[];
    expect(next).toHaveLength(1);
    expect(next[0].order).toBe(0);
    expect(next[0].enabled).toBe(true);
    expect(next[0].metricType).toBe('serie');
  });

  test('edits the rule pattern via onChange', () => {
    const { onChange } = renderEditor([createDefaultRule(0, 'Main')]);
    const pattern = screen.getByLabelText('Rule pattern');
    fireEvent.change(pattern, { target: { value: '/^cpu/' } });

    const next = onChange.mock.calls[0][0] as RuleOptions[];
    expect(next[0].pattern).toBe('/^cpu/');
  });

  test('toggles the per-rule enable checkbox via onChange', () => {
    const { onChange } = renderEditor([createDefaultRule(0, 'Main')]);
    const toggle = screen.getByLabelText('Enable rule 1');
    fireEvent.click(toggle);

    const next = onChange.mock.calls[0][0] as RuleOptions[];
    expect(next[0].enabled).toBe(false);
  });

  test('adds and edits a number threshold row via onChange', () => {
    const { onChange } = renderEditor([createDefaultRule(0, 'Main')]);

    // Add a number threshold (number is the default value type).
    fireEvent.click(screen.getByTestId('number-threshold-add'));
    let next = onChange.mock.calls[0][0] as RuleOptions[];
    expect(next[0].numberThresholds).toHaveLength(1);
    expect(next[0].numberThresholds[0].level).toBe(0);
    expect(next[0].numberThresholds[0].comparator).toBe('ge');

    // Re-render with the added threshold, then edit its value.
    const onChange2 = jest.fn();
    renderEditor(next, onChange2);
    const valueInput = screen.getByLabelText('Number threshold value 0');
    fireEvent.change(valueInput, { target: { value: '80' } });

    next = onChange2.mock.calls[0][0] as RuleOptions[];
    expect(next[0].numberThresholds[0].value).toBe(80);
  });

  test('removes a rule and reorders remaining rules canonically', () => {
    const rules = [createDefaultRule(0, 'A'), createDefaultRule(1, 'B')];
    const { onChange } = renderEditor(rules);

    // Remove the first rule; remaining rule's order should normalize to 0.
    fireEvent.click(screen.getByLabelText('Remove rule 1'));
    const next = onChange.mock.calls[0][0] as RuleOptions[];
    expect(next).toHaveLength(1);
    expect(next[0].alias).toBe('B');
    expect(next[0].order).toBe(0);
  });
});

describe('RulesEditor — value/range maps and map families (Task 10.2)', () => {
  test('adds and edits a value map via onChange (mappingType 1)', () => {
    const rule = createDefaultRule(0, 'Main'); // mappingType defaults to 1
    const { onChange } = renderEditor([rule]);

    // Value maps are shown for mappingType 1.
    expect(screen.getByTestId('value-maps')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('value-map-add'));
    let next = onChange.mock.calls[0][0] as RuleOptions[];
    expect(next[0].valueMaps).toHaveLength(1);
    expect(next[0].valueMaps[0].hidden).toBe(false);

    // Re-render with the new value map and edit its value + text.
    const onChange2 = jest.fn();
    renderEditor(next, onChange2);
    fireEvent.change(screen.getByLabelText('Value map value 0'), { target: { value: 'up' } });
    next = onChange2.mock.calls[0][0] as RuleOptions[];
    expect(next[0].valueMaps[0].value).toBe('up');
  });

  test('switches to range maps when mappingType is 2 and adds a range map', () => {
    const rule = { ...createDefaultRule(0, 'Main'), mappingType: 2 as const };
    const { onChange } = renderEditor([rule]);

    // Range maps are shown for mappingType 2.
    expect(screen.getByTestId('range-maps')).toBeInTheDocument();
    expect(screen.queryByTestId('value-maps')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('range-map-add'));
    const next = onChange.mock.calls[0][0] as RuleOptions[];
    expect(next[0].rangeMaps).toHaveLength(1);
    expect(next[0].rangeMaps[0].hidden).toBe(false);
  });

  test('adds and edits a shape map via onChange', () => {
    const { onChange } = renderEditor([createDefaultRule(0, 'Main')]);

    fireEvent.click(screen.getByTestId('shape-map-add'));
    let next = onChange.mock.calls[0][0] as RuleOptions[];
    expect(next[0].shapeMaps).toHaveLength(1);
    expect(next[0].shapeMaps[0].colorOn).toBe('a');

    const onChange2 = jest.fn();
    renderEditor(next, onChange2);
    fireEvent.change(screen.getByLabelText('Shape map pattern 0'), { target: { value: '/^node/' } });
    next = onChange2.mock.calls[0][0] as RuleOptions[];
    expect(next[0].shapeMaps[0].pattern).toBe('/^node/');
  });

  test('toggles tooltip enabled via onChange', () => {
    const { onChange } = renderEditor([createDefaultRule(0, 'Main')]);
    fireEvent.click(screen.getByLabelText('Tooltip enabled'));
    const next = onChange.mock.calls[0][0] as RuleOptions[];
    expect(next[0].tooltip.enabled).toBe(true);
  });

  test('preserves untouched map/tooltip fields when editing an unrelated field', () => {
    const rule = createDefaultRule(0, 'Main');
    rule.valueMaps = [{ value: 'x', text: 'X', hidden: false }];
    rule.shapeMaps = [{ pattern: '/a/', style: 'fillColor', colorOn: 'a', hidden: false }];
    const { onChange } = renderEditor([rule]);

    fireEvent.change(screen.getByLabelText('Rule pattern'), { target: { value: '/^cpu/' } });
    const next = onChange.mock.calls[0][0] as RuleOptions[];
    expect(next[0].pattern).toBe('/^cpu/');
    expect(next[0].valueMaps).toEqual(rule.valueMaps);
    expect(next[0].shapeMaps).toEqual(rule.shapeMaps);
  });
});
