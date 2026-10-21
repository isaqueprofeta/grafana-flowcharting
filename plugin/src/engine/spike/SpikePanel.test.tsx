/**
 * Feature: angular-to-react-migration — Task 3 maxGraph rendering-parity SPIKE.
 *
 * Proves a sample diagram renders STATICALLY inside a panel-mounted React
 * container via `@maxgraph/core`, and that unmount releases the engine. This is
 * the component-level evidence behind the GO decision in MAXGRAPH_SPIKE.md.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SpikePanel } from './SpikePanel';
import { encode } from '../diagramCodec';
import { SAMPLE_INFRA_TOPOLOGY_XML } from './renderSpike';

describe('SpikePanel — static maxGraph render inside a React container', () => {
  test('mounts a graph container without surfacing an error', () => {
    render(<SpikePanel source={SAMPLE_INFRA_TOPOLOGY_XML} />);
    expect(screen.getByTestId('spike-graph-container')).toBeInTheDocument();
    expect(screen.queryByTestId('spike-error')).not.toBeInTheDocument();
  });

  test('renders an encoded (pako+base64) diagram after decode', () => {
    render(<SpikePanel source={encode(SAMPLE_INFRA_TOPOLOGY_XML)} />);
    expect(screen.getByTestId('spike-graph-container')).toBeInTheDocument();
    expect(screen.queryByTestId('spike-error')).not.toBeInTheDocument();
  });

  test('unmounts cleanly, releasing the engine container', () => {
    const { unmount } = render(<SpikePanel source={SAMPLE_INFRA_TOPOLOGY_XML} />);
    const container = screen.getByTestId('spike-graph-container');
    expect(() => unmount()).not.toThrow();
    expect(container.innerHTML).toBe('');
  });
});
