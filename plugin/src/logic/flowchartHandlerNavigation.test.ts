/**
 * Feature: angular-to-react-migration, Property 7
 *
 * Property 7: Flowchart navigation bounds and round-trip.
 * **Validates: Requirements 4.7**
 *
 * For any list of N flowcharts and any current index, advancing to the next and
 * previous flowchart SHALL keep the current index within `[0, N-1]`, and from
 * any non-edge index, next followed by previous SHALL return to the original
 * index.
 *
 * The navigation API under test lives on {@link FlowchartHandler}
 * (`logic/flowchartHandler.ts`): `getFlowchartCount()`, `getCurrentIndex()`,
 * `getCurrentFlowchart()`, `setCurrentFlowchart(index|name)`, `nextFlowchart()`,
 * `previousFlowchart()`, all bounded through the private `_clampIndex` to
 * `[0, N-1]` with no wrap-around.
 *
 * The handler is built via `FlowchartHandler.create(gf, parentDiv, options)`
 * against a minimal `LogicContext` stub (the same seam pattern as
 * `engine/state.test.ts`/`data/dataFrameAdapter.test.ts`) and a jsdom container.
 * Each flowchart is seeded from `Flowchart.getDefaultData()` with a tiny valid
 * mxGraph XML source (the Task-3 spike `SAMPLE_INFRA_TOPOLOGY_XML`), so the
 * handler builds real `Flowchart`/`XGraph` instances exactly as the panel does.
 * The navigation bookkeeping (index/current/clamp) touches no pixels, so the
 * assertions are made at the model/index level under jsdom.
 *
 * Minimum 100 iterations per property (set explicitly via `numRuns`).
 */
import fc from 'fast-check';
import { getDefaultTimeRange } from '@grafana/data';
import { FlowchartHandler } from './flowchartHandler';
import { Flowchart } from './flowchart';
import { GFEvents, GlobalSignals, GLOBAL_SIGNALS } from './flowchartingBase';
import { SAMPLE_INFRA_TOPOLOGY_XML } from '../engine/spike/renderSpike';
import type { LogicContext } from './logicContext';
import type { FlowchartingOptions, FlowchartOptions } from '../types/options';

// ---------------------------------------------------------------------------
// Test doubles — minimal LogicContext stub, mirroring engine/state.test.ts.
// The navigation path reads none of the Grafana services; the handler only
// needs a live `events` bus (it connects global `debug_asked`/`panel_closed`)
// and the logic-internal helpers the seam exposes.
// ---------------------------------------------------------------------------
function stubContext(): LogicContext {
  const events = GFEvents.create<GlobalSignals>(GLOBAL_SIGNALS);
  return {
    notify: jest.fn(),
    clearNotify: jest.fn(),
    interpolate: (t: string) => t,
    getGrafanaVarNames: () => [],
    getTimeRange: () => getDefaultTimeRange(),
    theme: {} as any,
    eventBus: {} as any,
    subscribeSharedCrosshair: () => () => undefined,
    events,
    setMappingCallBack: () => undefined,
    getFullAvailableVarNames: () => [],
    setFocus: () => undefined,
  };
}

/** A jsdom parent div for the handler's per-flowchart containers. */
function makeParentDiv(): HTMLDivElement {
  const div = document.createElement('div');
  div.style.width = '800px';
  div.style.height = '600px';
  document.body.appendChild(div);
  return div;
}

/** One flowchart's options: defaults + the tiny valid mxGraph XML source. */
function makeFlowchartOptions(index: number): FlowchartOptions {
  const data = Flowchart.getDefaultData();
  // Name is overwritten to `Main` for index 0 by the handler; set a distinct
  // name for the rest so name-based selection is unambiguous.
  data.name = index === 0 ? 'Main' : `Flowchart-${index}`;
  data.type = 'xml';
  data.xml = SAMPLE_INFRA_TOPOLOGY_XML;
  // No download, no animation sweep to keep construction synchronous/light.
  data.download = false;
  data.enableAnim = false;
  return data;
}

/** Build a FlowchartingOptions carrying N flowcharts and no rules. */
function makeOptions(n: number): FlowchartingOptions {
  const flowcharts: FlowchartOptions[] = [];
  for (let i = 0; i < n; i++) {
    flowcharts.push(makeFlowchartOptions(i));
  }
  return {
    flowcharts,
    rules: [],
    editor: { editorUrl: '', editorTheme: 'dark', allowDrawio: false },
    inspect: { enabled: false },
  };
}

/** Build a handler with N flowcharts; caller frees via the returned teardown. */
function makeHandler(n: number): { handler: FlowchartHandler; teardown: () => void } {
  const gf = stubContext();
  const parent = makeParentDiv();
  const handler = FlowchartHandler.create(gf, parent, makeOptions(n));
  return {
    handler,
    teardown: () => {
      handler.free();
      parent.parentElement?.removeChild(parent);
    },
  };
}

// A navigation step the sequence driver can apply.
type NavOp = 'next' | 'previous';
const arbNavOp = fc.constantFrom<NavOp>('next', 'previous');

describe('Feature: angular-to-react-migration, Property 7 — flowchart navigation bounds and round-trip', () => {
  // -------------------------------------------------------------------------
  // Part A — BOUNDS: any sequence of next/previous keeps the current index in
  // `[0, N-1]`, from any reachable starting index.
  // -------------------------------------------------------------------------
  describe('navigation keeps the current index within [0, N-1]', () => {
    test('any next/previous sequence from any start index stays in bounds', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 8 }), // N flowcharts
          fc.nat(), // raw starting index (clamped by the handler)
          fc.array(arbNavOp, { minLength: 0, maxLength: 24 }), // nav sequence
          (n, rawStart, ops) => {
            const { handler, teardown } = makeHandler(n);
            try {
              expect(handler.getFlowchartCount()).toBe(n);

              // Seed a current index anywhere (setCurrentFlowchart clamps it).
              handler.setCurrentFlowchart(rawStart % (n + 2));
              expect(handler.getCurrentIndex()).toBeGreaterThanOrEqual(0);
              expect(handler.getCurrentIndex()).toBeLessThanOrEqual(n - 1);

              // Drive the sequence; after every step the index stays bounded.
              for (const op of ops) {
                if (op === 'next') {
                  handler.nextFlowchart();
                } else {
                  handler.previousFlowchart();
                }
                const idx = handler.getCurrentIndex();
                expect(idx).toBeGreaterThanOrEqual(0);
                expect(idx).toBeLessThanOrEqual(n - 1);
                // The current flowchart is always the one at the current index.
                expect(handler.getCurrentFlowchart()).toBe(handler.getFlowchart(idx));
              }
            } finally {
              teardown();
            }
          }
        ),
        { numRuns: 120 }
      );
    });

    test('next is a no-op at the last index and previous a no-op at the first (no wrap-around)', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 8 }), (n) => {
          const { handler, teardown } = makeHandler(n);
          try {
            // At the last index, next stays put.
            handler.setCurrentFlowchart(n - 1);
            expect(handler.getCurrentIndex()).toBe(n - 1);
            handler.nextFlowchart();
            expect(handler.getCurrentIndex()).toBe(n - 1);

            // At the first index, previous stays put.
            handler.setCurrentFlowchart(0);
            expect(handler.getCurrentIndex()).toBe(0);
            handler.previousFlowchart();
            expect(handler.getCurrentIndex()).toBe(0);
          } finally {
            teardown();
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Part B — ROUND-TRIP: from any non-edge index (0 < i < N-1), next followed
  // by previous returns to the original index. Non-edge indices only exist for
  // N >= 3, so the generator constrains N and i accordingly.
  // -------------------------------------------------------------------------
  describe('next-then-previous round-trips from a non-edge index', () => {
    test('from any non-edge start index, next then previous returns to the start', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 8 }), // N >= 3 so a non-edge index exists
          fc.integer({ min: 1 }), // non-edge index seed (bounded below)
          (n, seed) => {
            // Map the seed into a non-edge index in [1, N-2].
            const start = 1 + (seed % (n - 2));
            const { handler, teardown } = makeHandler(n);
            try {
              handler.setCurrentFlowchart(start);
              expect(handler.getCurrentIndex()).toBe(start);

              handler.nextFlowchart();
              // A non-edge index always has a next strictly greater.
              expect(handler.getCurrentIndex()).toBe(start + 1);

              handler.previousFlowchart();
              // ...and previous brings us back to the original index.
              expect(handler.getCurrentIndex()).toBe(start);
              expect(handler.getCurrentFlowchart()).toBe(handler.getFlowchart(start));
            } finally {
              teardown();
            }
          }
        ),
        { numRuns: 120 }
      );
    });

    test('previous-then-next also round-trips from a non-edge index (symmetry)', () => {
      fc.assert(
        fc.property(fc.integer({ min: 3, max: 8 }), fc.integer({ min: 1 }), (n, seed) => {
          const start = 1 + (seed % (n - 2));
          const { handler, teardown } = makeHandler(n);
          try {
            handler.setCurrentFlowchart(start);
            handler.previousFlowchart();
            expect(handler.getCurrentIndex()).toBe(start - 1);
            handler.nextFlowchart();
            expect(handler.getCurrentIndex()).toBe(start);
          } finally {
            teardown();
          }
        }),
        { numRuns: 120 }
      );
    });
  });
});
