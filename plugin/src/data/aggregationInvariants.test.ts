/**
 * Feature: angular-to-react-migration
 * Property 2: Aggregation invariants
 * Validates: Requirements 3.3
 *
 * For any non-empty numeric metric series, the aggregations the Data_Pipeline
 * computes SHALL satisfy:
 *   - min <= avg <= max
 *   - min <= current <= max
 *   - total === sum of the series values
 *
 * The series are delivered as mock `DataFrame` values (built with
 * `@grafana/data` `toDataFrame`, matching how Grafana hands series to the panel)
 * and run through the real `adaptDataFrames` -> `MetricHandler` ->
 * `SerieMetric` pipeline. Adapted from the legacy `spec/metrics.test.ts`
 * reference. Minimum 100 iterations.
 */
import fc from 'fast-check';
import { LoadingState, PanelData, getDefaultTimeRange, toDataFrame, FieldType } from '@grafana/data';
import { adaptDataFrames, aggregate } from './dataFrameAdapter';
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

/** Build a single time+number DataFrame from a non-empty value array. */
function makeSerieFrame(values: number[]): any {
  const t0 = 1653627189784;
  const step = 20000;
  const times = values.map((_, i) => t0 + i * step);
  return toDataFrame({
    name: 'cpu',
    refId: 'A',
    fields: [
      { name: 'Time', type: FieldType.time, values: times },
      { name: 'Value', type: FieldType.number, values },
    ],
  });
}

/**
 * Generator for a non-empty series of finite numeric values. `noNaN`/`noDefaultInfinity`
 * keep values finite so the aggregation algorithm (which seeds min/max with
 * ±Number.MAX_VALUE) stays well-defined. The range is bounded so repeated
 * summation stays within double precision without reordering surprises.
 */
const numericSeriesArb: fc.Arbitrary<number[]> = fc.array(
  fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  { minLength: 1, maxLength: 60 }
);

describe('dataFrameAdapter — Feature: angular-to-react-migration, Property 2: Aggregation invariants', () => {
  test('min <= avg <= max, min <= current <= max, total = sum (>=100 iterations)', () => {
    fc.assert(
      fc.property(numericSeriesArb, (values) => {
        const handler = adaptDataFrames(panelDataFromFrames([makeSerieFrame(values)]), stubContext());
        const metric = handler.getMetrics('serie')[0];

        const min = aggregate(metric, 'min') as number;
        const max = aggregate(metric, 'max') as number;
        const avg = aggregate(metric, 'avg') as number;
        const current = aggregate(metric, 'current') as number;
        const total = aggregate(metric, 'total') as number;

        // min <= avg <= max
        expect(min).toBeLessThanOrEqual(avg);
        expect(avg).toBeLessThanOrEqual(max);

        // min <= current <= max
        expect(min).toBeLessThanOrEqual(current);
        expect(current).toBeLessThanOrEqual(max);

        // current is the last datapoint's value
        expect(current).toBe(values[values.length - 1]);

        // total equals the sum of the series values. The pipeline accumulates
        // left-to-right, so reproduce that exact order to compare bit-for-bit.
        const sum = values.reduce((acc, v) => acc + v, 0);
        expect(total).toBe(sum);
      }),
      { numRuns: 200 }
    );
  });

  // Example-based anchor alongside the property (legacy dataList reference).
  test('hand-computed reference values hold the invariants', () => {
    const values = [10, 12, 8, 20, 15]; // min=8 max=20 total=65 avg=13 current=15
    const handler = adaptDataFrames(panelDataFromFrames([makeSerieFrame(values)]), stubContext());
    const metric = handler.getMetrics('serie')[0];

    const min = aggregate(metric, 'min') as number;
    const max = aggregate(metric, 'max') as number;
    const avg = aggregate(metric, 'avg') as number;
    const current = aggregate(metric, 'current') as number;
    const total = aggregate(metric, 'total') as number;

    expect(min).toBe(8);
    expect(max).toBe(20);
    expect(avg).toBe(13);
    expect(current).toBe(15);
    expect(total).toBe(65);
    expect(min).toBeLessThanOrEqual(avg);
    expect(avg).toBeLessThanOrEqual(max);
    expect(min).toBeLessThanOrEqual(current);
    expect(current).toBeLessThanOrEqual(max);
  });
});
