/**
 * Feature: angular-to-react-migration — Task 12.2
 * (Flow saved draw.io XML back into options and re-render).
 * Validates: Requirements 6.4, 6.5
 *
 * These tests prove the save seam: when the draw.io editor reports a saved
 * Diagram_XML, the panel writes it into the active flowchart's options via
 * `onOptionsChange` (Req 6.4), producing a *new* options reference so the
 * options effect re-renders the diagram (Req 6.5).
 *
 *   - `writeSavedXml` writes the saved XML into the active flowchart only,
 *     leaves other flowcharts/options untouched, and returns the same
 *     reference when the active index is out of range.
 *   - Rendering the panel with a mocked DrawioEditor: clicking "Edit diagram"
 *     opens an editor; invoking its captured `onSave(xml)` calls
 *     `onOptionsChange` with the updated active flowchart XML.
 *   - The Edit affordance is hidden when `editor.allowDrawio` is false.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FlowchartingPanel, writeSavedXml } from './FlowchartingPanel';
import { defaultEditorOptions, FlowchartOptions, FlowchartingOptions } from '../types/options';

// --- Mock the heavy collaborators so the panel mounts in jsdom ---------------

// Capture the config/callbacks the panel hands to DrawioEditor so we can drive
// the save seam directly (stand-in for the real editor's postMessage flow).
const openMock = jest.fn();
const closeMock = jest.fn();
let lastEditorCallbacks: { onSave?: (xml: string) => void; onExit?: () => void } | undefined;
let lastEditorConfig: { uid: string; xml: string; editorUrl?: string; editorTheme?: string } | undefined;

jest.mock('../drawio/DrawioEditor', () => ({
  DrawioEditor: jest.fn().mockImplementation((config, callbacks) => {
    lastEditorConfig = config;
    lastEditorCallbacks = callbacks;
    return { open: openMock, close: closeMock };
  }),
}));

// FlowchartHandler touches @maxgraph/core; stub it to a no-op orchestrator that
// reports the active index the panel reads when opening the editor / saving.
let currentIndex = 0;
jest.mock('../logic/flowchartHandler', () => ({
  FlowchartHandler: {
    create: jest.fn().mockImplementation(() => ({
      getCurrentIndex: () => currentIndex,
      update: jest.fn(),
      resize: jest.fn(),
      refreshMetrics: jest.fn(),
      applyOptions: jest.fn(),
      free: jest.fn(),
    })),
  },
}));

// The data pipeline is irrelevant to the save path.
jest.mock('../data/dataFrameAdapter', () => ({
  dataFramesToDataList: () => [],
}));

// Keep the Context_Seam trivial so no Grafana runtime is required.
jest.mock('./context/GFContext', () => ({
  useGFContext: () => ({
    events: { emit: jest.fn(), clear: jest.fn() },
    clearNotify: jest.fn(),
    subscribeSharedCrosshair: () => () => undefined,
  }),
}));

function makeFlowchart(name: string, xml: string): FlowchartOptions {
  return {
    name,
    type: 'xml',
    xml,
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

function makeOptions(flowcharts: FlowchartOptions[], allowDrawio = true): FlowchartingOptions {
  return {
    flowcharts,
    rules: [],
    editor: { ...defaultEditorOptions, allowDrawio },
    inspect: { enabled: false },
  };
}

function renderPanel(options: FlowchartingOptions, onOptionsChange = jest.fn()) {
  const props: any = {
    id: 42,
    width: 400,
    height: 300,
    data: { series: [] },
    timeRange: {},
    options,
    onOptionsChange,
    eventBus: {},
  };
  render(<FlowchartingPanel {...props} />);
  return { onOptionsChange };
}

beforeEach(() => {
  currentIndex = 0;
  openMock.mockClear();
  closeMock.mockClear();
  lastEditorCallbacks = undefined;
  lastEditorConfig = undefined;
});

describe('writeSavedXml (Req 6.4, 6.5)', () => {
  it('writes the saved XML into the active flowchart only', () => {
    const options = makeOptions([makeFlowchart('Main', '<old-0/>'), makeFlowchart('B', '<old-1/>')]);
    const next = writeSavedXml(options, 1, '<new-1/>');

    expect(next.flowcharts[0].xml).toBe('<old-0/>');
    expect(next.flowcharts[1].xml).toBe('<new-1/>');
  });

  it('returns a new reference so the options effect re-renders (Req 6.5)', () => {
    const options = makeOptions([makeFlowchart('Main', '<old/>')]);
    const next = writeSavedXml(options, 0, '<new/>');

    expect(next).not.toBe(options);
    expect(next.flowcharts).not.toBe(options.flowcharts);
    expect(next.flowcharts[0]).not.toBe(options.flowcharts[0]);
    // Untouched sibling fields are preserved.
    expect(next.rules).toBe(options.rules);
    expect(next.editor).toBe(options.editor);
  });

  it('returns the same options when the active index is out of range', () => {
    const empty = makeOptions([]);
    expect(writeSavedXml(empty, 0, '<x/>')).toBe(empty);

    const one = makeOptions([makeFlowchart('Main', '<old/>')]);
    expect(writeSavedXml(one, 5, '<x/>')).toBe(one);
    expect(writeSavedXml(one, -1, '<x/>')).toBe(one);
  });
});

describe('FlowchartingPanel — draw.io save seam (Req 6.4, 6.5)', () => {
  it('writes saved XML into the active flowchart via onOptionsChange', () => {
    const options = makeOptions([makeFlowchart('Main', '<old-0/>'), makeFlowchart('B', '<old-1/>')]);
    currentIndex = 1;
    const { onOptionsChange } = renderPanel(options);

    // Open the editor.
    fireEvent.click(screen.getByTestId('flowcharting-edit-diagram'));
    expect(openMock).toHaveBeenCalledTimes(1);
    // The editor is seeded with the active flowchart's current XML + config.
    expect(lastEditorConfig?.uid).toBe('42');
    expect(lastEditorConfig?.xml).toBe('<old-1/>');
    expect(lastEditorConfig?.editorUrl).toBe(defaultEditorOptions.editorUrl);

    // The editor reports a saved diagram.
    expect(lastEditorCallbacks?.onSave).toBeDefined();
    lastEditorCallbacks!.onSave!('<saved-1/>');

    expect(onOptionsChange).toHaveBeenCalledTimes(1);
    const next = onOptionsChange.mock.calls[0][0] as FlowchartingOptions;
    expect(next.flowcharts[1].xml).toBe('<saved-1/>');
    expect(next.flowcharts[0].xml).toBe('<old-0/>');
    expect(next).not.toBe(options);
  });

  it('does not call onOptionsChange when there is no flowchart to write into', () => {
    const { onOptionsChange } = renderPanel(makeOptions([]));

    fireEvent.click(screen.getByTestId('flowcharting-edit-diagram'));
    lastEditorCallbacks!.onSave!('<saved/>');

    expect(onOptionsChange).not.toHaveBeenCalled();
  });

  it('hides the Edit affordance when allowDrawio is false', () => {
    renderPanel(makeOptions([makeFlowchart('Main', '<x/>')], false));
    expect(screen.queryByTestId('flowcharting-edit-diagram')).toBeNull();
  });
});
