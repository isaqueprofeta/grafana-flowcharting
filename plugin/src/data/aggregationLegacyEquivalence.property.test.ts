/**
 * Feature: angular-to-react-migration
 * Property 3: Aggregation legacy-equivalence
 * Validates: Requirements 3.4
 *
 * For any numeric metric series, the current/min/max/avg/total produced by the
 * DataFrame adapter (`adaptDataFrames` -> `SerieMetric`) SHALL equal the
 * corresponding results produced by an independent legacy `dataList`
 * aggregation reference computed directly from the generated value array.
 *
 * The reference below reimplements the five aggregations from first principles
 * over the raw `[value, timestamp]` series — it does NOT reuse the adapter or
 * the metric classes — matching the Legacy_Plugin `dataList` semantics (the
 * classic Grafana TimeSeries stats): nulls are ignored under the `connected`
 * null-point mode; `total` is the sum of non-null values; `avg` divides that
 * sum by the non-null count; `min`/`max` are over non-null values; `current` is
 * the value of the last datapoint (the legacy `SerieMetric._addCustomStats`
 * sets `current` to the last flotpair value directly, so a trailing `null`
 * yields a `null` current).
 *
 * Mock DataFrames are built with `@grafana/data` `toDataFrame` (adapted from the
 * legacy `spec/metrics.test.ts` reference), so field types are inferred exactly
 * as Grafana would deliver them to the panel. Minimum 100 iterations.
 */
import fc from 'fast-check';
import { LoadingState, PanelData, getDefaultTimeRange, toDataFrame, FieldType } from '@grafana/data';
import { adaptDataFrames } from './dataFrameAdapter';
import type { GFContext } from '../components/context/GFContext';
import { GFEvents, GlobalSignals, GLOBAL_SIGNALS } from '../logic/flowchartingBase';

// A minimal GFContext stub — the metric layer only touches `events`.
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

/**
 * Independent reference implementation of the legacy `dataList` aggregations.
 * Built directly from the generated `[value, timestampMs]` series — deliberately
 * NOT sharing any code with the adapter under test. Mirrors the classic Grafana
 * TimeSeries stats under the `connected` null-point mode (nulls ignored).
 */
function referenceAggregations(datapoints: Array<[number | null, number]>) {
  const nonNull = datapoints
    .map(([v]) => v)
    .filter((v): v is number => v !== null && v !== undefined);

  const total = nonNull.reduce((a, b) => a + b, 0);
  const count = nonNull.length;
  const min = count === 0 ? null : Math.min(...nonNull);
  const max = count === 0 ? null : Math.max(...nonNull);
  const avg = count === 0 ? null : total / count;

  // current = value of the last datapoint. Matching legacy
  // `SerieMetric._addCustomStats`, which assigns the last flotpair value with
  // no null fallback: a trailing null therefore yields a null current.
  const current: number | null = datapoints.length ? datapoints[datapoints.length - 1][0] : null;

  return { current, min, max, avg, total };
}

/** Build a single time+number DataFrame from a generated series. */
function makeSerieFrame(datapoints: Array<[number | null, number]>) {
  return toDataFrame({
    name: 'metric',
    refId: 'A',
    fields: [
      { name: 'Time', type: FieldType.time, values: datapoints.map((d) => d[1]) },
      { name: 'Value', type: FieldType.number, values: datapoints.map((d) => d[0]) },
    ],
  });
}

// A smart generator: a non-empty series of strictly increasing timestamps paired
// with values that are finite numbers or null (to exercise null handling).
const TS0 = 1653627189784;
const STEP = 20000;

const serieArb: fc.Arbitrary<Array<[number | null, number]>> = fc
  .array(
    fc.oneof(
      fc.integer({ min: -100000, max: 100000 }),
      fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      fc.constant<null>(null)
    ),
    { minLength: 1, maxLength: 50 }
  )
  // Require at least one non-null value so min/max/avg/current are defined, and
  // the aggregation comparison is meaningful.
  .filter((vals) => vals.some((v) => v !== null))
  .map((vals) => vals.map((v, i) => [v, TS0 + i * STEP] as [number | null, number]));

describe('dataFrameAdapter — Feature: angular-to-react-migration, Property 3: Aggregation legacy-equivalence', () => {
  const APPROX = 1e-6;

  function closeOrEqual(actual: unknown, expected: number | null) {
    if (expected === null) {
      expect(actual).toBeNull();
      return;
    }
    expect(typeof actual).toBe('number');
    expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
      APPROX * Math.max(1, Math.abs(expected))
    );
  }

  test('current/min/max/avg/total from the adapter equal the independent legacy reference (>=100 iterations)', () => {
    fc.assert(
      fc.property(serieArb, (datapoints) => {
        const handler = adaptDataFrames(panelDataFromFrames([makeSerieFrame(datapoints)]), stubContext());
        const metric = handler.getMetrics('serie')[0];

        const ref = referenceAggregations(datapoints);

        closeOrEqual(metric.getValue('current'), ref.current);
        closeOrEqual(metric.getValue('min'), ref.min);
        closeOrEqual(metric.getValue('max'), ref.max);
        closeOrEqual(metric.getValue('avg'), ref.avg);
        closeOrEqual(metric.getValue('total'), ref.total);
      }),
      { numRuns: 200 }
    );
  });
});
