/**
 * Feature: angular-to-react-migration — Task 3 maxGraph rendering-parity SPIKE.
 *
 * Full visual rendering can't be screenshotted in CI, so this jsdom test
 * asserts the maxGraph MODEL STRUCTURE after decode: vertex/edge counts, edge
 * connectivity, labels, geometry, and key styles. Passing here is the evidence
 * behind the GO decision recorded in MAXGRAPH_SPIKE.md.
 */
import { renderDiagram, inspectModel, SAMPLE_INFRA_TOPOLOGY_XML } from './renderSpike';
import { encode } from '../diagramCodec';

describe('maxGraph spike — renders sample infra topology into the model', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  test('instantiates Graph and loads three vertices and two edges', () => {
    const graph = renderDiagram(container, SAMPLE_INFRA_TOPOLOGY_XML);
    try {
      const model = inspectModel(graph);
      expect(model.vertexCount).toBe(3);
      expect(model.edgeCount).toBe(2);
    } finally {
      graph.destroy();
    }
  });

  test('preserves cell labels (web, app, db) and edge labels (http, sql)', () => {
    const graph = renderDiagram(container, SAMPLE_INFRA_TOPOLOGY_XML);
    try {
      const { labels } = inspectModel(graph);
      expect(labels).toEqual(expect.arrayContaining(['web', 'app', 'db', 'http', 'sql']));
    } finally {
      graph.destroy();
    }
  });

  test('preserves vertex geometry (position/size)', () => {
    const graph = renderDiagram(container, SAMPLE_INFRA_TOPOLOGY_XML);
    try {
      const { cells } = inspectModel(graph);
      const web = cells.find((c) => c.id === 'web');
      expect(web).toBeDefined();
      expect(web!.geometry).toEqual({ x: 40, y: 40, width: 120, height: 60 });
      const db = cells.find((c) => c.id === 'db');
      expect(db!.geometry).toEqual({ x: 440, y: 40, width: 120, height: 80 });
    } finally {
      graph.destroy();
    }
  });

  test('preserves edge connectivity (web->app, app->db)', () => {
    const graph = renderDiagram(container, SAMPLE_INFRA_TOPOLOGY_XML);
    try {
      const { cells } = inspectModel(graph);
      const e1 = cells.find((c) => c.id === 'e1');
      const e2 = cells.find((c) => c.id === 'e2');
      expect(e1).toBeDefined();
      expect(e1!.sourceId).toBe('web');
      expect(e1!.targetId).toBe('app');
      expect(e2!.sourceId).toBe('app');
      expect(e2!.targetId).toBe('db');
    } finally {
      graph.destroy();
    }
  });

  test('preserves key styles (fill colors on vertices)', () => {
    const graph = renderDiagram(container, SAMPLE_INFRA_TOPOLOGY_XML);
    try {
      const { cells } = inspectModel(graph);
      const web = cells.find((c) => c.id === 'web');
      // style serialized either as a key=value string or flattened object.
      expect(web!.style.toLowerCase()).toContain('dae8fc');
      const db = cells.find((c) => c.id === 'db');
      expect(db!.style.toLowerCase()).toContain('cylinder');
    } finally {
      graph.destroy();
    }
  });

  test('renders an encoded (pako+base64) diagram after decode', () => {
    const encoded = encode(SAMPLE_INFRA_TOPOLOGY_XML);
    const graph = renderDiagram(container, encoded);
    try {
      const model = inspectModel(graph);
      expect(model.vertexCount).toBe(3);
      expect(model.edgeCount).toBe(2);
      expect(model.labels).toEqual(expect.arrayContaining(['web', 'app', 'db']));
    } finally {
      graph.destroy();
    }
  });
});
