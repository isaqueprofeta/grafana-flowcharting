// Jest setup provided by Grafana scaffolding.
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// jsdom does not implement TextEncoder/TextDecoder; several @grafana packages need them.
Object.assign(global, { TextDecoder, TextEncoder });

// jsdom does not implement matchMedia; @grafana/ui theming relies on it.
Object.defineProperty(global, 'matchMedia', {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }),
});
