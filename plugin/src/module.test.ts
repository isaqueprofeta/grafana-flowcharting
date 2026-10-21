import { PanelPlugin } from '@grafana/data';
import { plugin } from './module';

describe('module entry', () => {
  it('exports a PanelPlugin instance', () => {
    expect(plugin).toBeInstanceOf(PanelPlugin);
  });

  it('registers a panel component', () => {
    expect(plugin.panel).toBeDefined();
  });
});
