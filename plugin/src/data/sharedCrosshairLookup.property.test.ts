/**
 * Feature: angular-to-react-migration, Property 8: Shared-crosshair value lookup
 * Validates: Requirements 4.10
 *
 * For any time-ordered metric series and any query timestamp, the value
 * returned by the shared-crosshair lookup (`findValueAt` -> `SerieMetric.findValue`,
 * a nearest-not-after binary search over flotpairs) SHALL be the value at the
 * greatest timestamp that is less than or equal to the query. Queries before
 * the first point clamp to the first value (the preserved legacy boundary
 * behaviour of the binary search).
 *
 * Adapted from the legacy `spec/metrics.test.ts` reference, driving the ported
 * metric layer through mock DataFrames (`@grafana/data` `toDataFrame`) exactly
 * as Grafana would deliver them to the panel. Minimum 100 iterations.
 */
import { LoadingState, PanelData, getDefaultTimeRange, toDataFrame, FieldType } from '@grafana/data';
import fc from 'fast-check';
import { adaptDataFrames, findValueAt } from './dataFrameAdapter';
import type { GFContext } from '../components/context/GFContext';
import { GFEvents, GlobalSignals, GLOBAL_SIGNALS } from '../logic/flowchartingBase';

// Minimal GFContext stub — the metric layer only touches `events`.
function stubContext(): GFContext {
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
  };
}

function panelDataFromFrames(frames: any[]): PanelData {
  return {
    state: LoadingState.Done,
    series: frames,
    timeRange: getDefaultTimeRange(),
  };
}

/** Build a single time+number mock DataFrame from aligned times/values. */
function makeSerieFrame(times: number[], values: number[]) {
  return toDataFrame({
    name: 'cpu',
    refId: 'A',
    fields: [
      { name: 'Time', type: FieldType.time, values: times },
      { name: 'Value', type: FieldType.number, values },
    ],
  });
}

/** Adapt a mock serie frame and return the resulting serie metric. */
function metricFor(times: number[], values: number[]) {
  const handler = adaptDataFrames(panelDataFromFrames([makeSerieFrame(times, values)]), stubContext());
  return handler.getMetrics('serie')[0];
}

/**
 * Reference oracle: the greatest-timestamp-not-after value. The implementation's
 * binary search rounds the query and clamps a before-first query to the first
 * value, so the oracle mirrors that boundary. `times` is strictly ascending.
 *
 * Preserved legacy boundaries of the verbatim-ported `SerieMetric.findValue`
 * binary search:
 *   - a degenerate single-point series yields `null` for any query (the loop
 *     guard treats `high === 0` as "nothing to search");
 *   - a before-first query clamps to the first value.
 */
function nearestNotAfter(times: number[], values: number[], query: number): number | null {
  if (times.length === 1) {
    return null;
  }
  const q = Math.round(query);
  if (q < times[0]) {
    // before first point -> clamp to first value (preserved legacy behaviour)
    return values[0];
  }
  let idx = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= q) {
      idx = i;
    } else {
      break;
    }
  }
  return values[idx];
}

/**
 * A time-ordered series generator: a start epoch, a strictly-increasing set of
 * gaps (so timestamps are distinct and ascending), and a value per point.
 */
const seriesArb = fc
  .record({
    start: fc.integer({ min: 1_000_000_000_000, max: 1_700_000_000_000 }),
    gaps: fc.array(fc.integer({ min: 1, max: 120_000 }), { minLength: 0, maxLength: 24 }),
    values: fc.array(fc.integer({ min: -10_000, max: 10_000 }), { minLength: 1, maxLength: 25 }),
  })
  .map(({ start, gaps, values }) => {
    // Align counts: one more point than gaps.
    const n = Math.min(values.length, gaps.length + 1);
    const vals = values.slice(0, n);
    const times: number[] = [start];
    for (let i = 0; i < n - 1; i++) {
      times.push(times[times.length - 1] + gaps[i]);
    }
    return { times, values: vals };
  });

describe('dataFrameAdapter — Feature: angular-to-react-migration, Property 8: Shared-crosshair value lookup', () => {
  test('findValueAt returns the nearest-not-after value for arbitrary queries (Req 4.10)', () => {
    fc.assert(
      fc.property(
        seriesArb,
        // A query strategy flag: exact hit, between points, before first, or after last.
        fc.integer({ min: 0, max: 3 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        ({ times, values }, mode, frac) => {
          const metric = metricFor(times, values);
          const first = times[0];
          const last = times[times.length - 1];

          let query: number;
          switch (mode) {
            case 0: {
              // exact hit on some existing point
              const i = Math.min(times.length - 1, Math.floor(frac * times.length));
              query = times[i];
              break;
            }
            case 1: {
              // between two points (or exact if single point)
              if (times.length === 1) {
                query = first;
              } else {
                const i = Math.min(times.length - 2, Math.floor(frac * (times.length - 1)));
                const span = times[i + 1] - times[i];
                query = times[i] + Math.floor(frac * Math.max(0, span - 1));
              }
              break;
            }
            case 2:
              // before the first point
              query = first - 1 - Math.floor(frac * 100_000);
              break;
            default:
              // after the last point
              query = last + 1 + Math.floor(frac * 100_000);
              break;
          }

          const actual = findValueAt(metric, query);
          const expected = nearestNotAfter(times, values, query);
          expect(actual).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });
});
