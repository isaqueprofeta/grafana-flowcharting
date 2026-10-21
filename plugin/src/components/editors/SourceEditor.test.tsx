/**
 * Feature: angular-to-react-migration — Task 9.2 light custom editors.
 *
 * Verifies the {@link SourceEditor} custom panel-option editor renders its
 * authoring surface and emits the active flowchart's source back through the
 * `StandardEditorProps.onChange` contract (Req 4.8, 5.5). Follows the
 * SpikePanel.test.tsx @testing-library/react pattern.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { StandardEditorProps } from '@grafana/data';
import { SourceEditor, createDefaultFlowchart } from './SourceEditor';
import { FlowchartOptions } from '../../types/options';

/** Minimal StandardEditorProps harness — only value/onChange matter here. */
function renderEditor(value: FlowchartOptions[], onChange = jest.fn()) {
  const props = {
    value,
    onChange,
    context: { data: [] },
    item: { id: 'source', name: 'Diagram source', editor: () => null },
  } as unknown as StandardEditorProps<FlowchartOptions[]>;
  render(<SourceEditor {...props} />);
  return { onChange };
}

describe('SourceEditor — active-flowchart source authoring', () => {
  test('renders the source authoring surface', () => {
    renderEditor([createDefaultFlowchart('Main')]);
    expect(screen.getByTestId('source-editor')).toBeInTheDocument();
    expect(screen.getByLabelText('Diagram source')).toBeInTheDocument();
    expect(screen.getByLabelText('Source URL')).toBeInTheDocument();
  });

  test('updates the active flowchart XML via onChange when source is pasted', () => {
    const { onChange } = renderEditor([createDefaultFlowchart('Main')]);
    const textarea = screen.getByLabelText('Diagram source');
    fireEvent.change(textarea, { target: { value: '<mxGraphModel></mxGraphModel>' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as FlowchartOptions[];
    expect(next[0].xml).toBe('<mxGraphModel></mxGraphModel>');
    expect(next[0].type).toBe('xml');
  });

  test('updates the URL field via onChange', () => {
    const { onChange } = renderEditor([createDefaultFlowchart('Main')]);
    const url = screen.getByLabelText('Source URL');
    fireEvent.change(url, { target: { value: 'https://example.com/d.xml' } });

    const next = onChange.mock.calls[0][0] as FlowchartOptions[];
    expect(next[0].url).toBe('https://example.com/d.xml');
  });

  test('seeds a first flowchart when the array is empty', () => {
    const { onChange } = renderEditor([]);
    fireEvent.click(screen.getByTestId('source-editor-create-first'));

    const next = onChange.mock.calls[0][0] as FlowchartOptions[];
    expect(next).toHaveLength(1);
    expect(next[0].type).toBe('xml');
  });
});
