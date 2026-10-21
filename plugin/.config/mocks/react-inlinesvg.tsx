import React from 'react';

type Callback = (...args: unknown[]) => void;

// A mock of the react-inlinesvg package used in Grafana scaffolding tests.
const InlineSVG = ({ src, ...rest }: { src: string } & Record<string, unknown>) => {
  return <svg data-testid="mock-inline-svg" data-src={src} {...rest} />;
};

export const cacheStore: Record<string, unknown> = {};
export const callbacks: Record<string, Callback> = {};

export default InlineSVG;
