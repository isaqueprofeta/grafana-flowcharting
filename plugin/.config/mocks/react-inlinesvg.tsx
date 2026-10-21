import React from 'react';

type Callback = (...args: unknown[]) => void;

// A mock of the react-inlinesvg package used in Grafana scaffolding tests.
// `react-inlinesvg` accepts several library-specific props (`innerRef`,
// `cacheRequests`, `uniquifyIDs`, lifecycle callbacks, ...) that are not valid
// DOM attributes. The real package consumes them; this mock renders a raw
// `<svg>`, so they must be stripped before spreading `rest` onto the element —
// otherwise React logs "does not recognize the `innerRef` prop on a DOM
// element" (and similar) during tests.
const InlineSVG = ({
  src,
  innerRef,
  cacheRequests,
  uniquifyIDs,
  preProcessor,
  onLoad,
  onError,
  loader,
  baseURL,
  ...rest
}: {
  src: string;
  innerRef?: unknown;
  cacheRequests?: unknown;
  uniquifyIDs?: unknown;
  preProcessor?: unknown;
  onLoad?: unknown;
  onError?: unknown;
  loader?: unknown;
  baseURL?: unknown;
} & Record<string, unknown>) => {
  return <svg data-testid="mock-inline-svg" data-src={src} {...rest} />;
};

export const cacheStore: Record<string, unknown> = {};
export const callbacks: Record<string, Callback> = {};

export default InlineSVG;
