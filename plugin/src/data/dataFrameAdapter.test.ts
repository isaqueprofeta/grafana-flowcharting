/**
 * Feature: angular-to-react-migration — Task 5.1 unit tests.
 *
 * Verifies the DataFrame adapter + metric contract (Req 3.1-3.7):
 *   - `props.data.series` DataFrames are consumed and converted to the legacy
 *     `dataList` shape that `SerieMetric`/`TableMetric` consume unchanged;
 *   - aggregations current/min/max/avg/total match hand-computed legacy
 *     `dataList` reference values (Req 3.3, 3.4);
 *   - `findValue(timestamp)` is nearest-not-after (Req 4.10 crosshair path);
 *   - formatting uses `@grafana/data` `getValueFormat`/`dateTime` (Req 3.5, 3.6).
 *
 * Mock DataFrames are built with `@grafana/data` `toDataFrame` so field types
 * are inferred exactly as Grafana would deliver them to the panel.
 */
import { PanelData, LoadingState, dateTime, getDefaultTimeRange, toDataFrame, FieldType } from '@grafana/data';
import {
  adaptDataFrames,
  aggregate,
  dataFramesToDataList,
  findValueAt,
  formatDate,
  formatValue,
  SerieDataListEntry,
  TableDataListEntry,
} from './dataFrameAdapter';
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

// Reference series: values at increasing timestamps (20s apart like the legacy sample).
const TS0 = 1653627189784;
const STEP = 20000;
const VALUES = [10, 12, 8, 20, 15]; // min=8, max=20, total=65, avg=13, current=15
const TIMES = VALUES.map((_, i) => TS0 + i * STEP);

function makeSerieFrame() {
  return toDataFrame({
    name: 'cpu',
    refId: 'A',
    fields: [
      { name: 'Time', type: FieldType.time, values: TIMES },
      { name: 'Value', type: FieldType.number, values: VALUES },
    ],
  });
}

describe('dataFrameAdapter — conversion to legacy dataList shape (Req 3.1, 3.2)', () => {
  test('a single time+number frame becomes a serie entry with [value, ts] datapoints', () => {
    const list = dataFramesToDataList(panelDataFromFrames([makeSerieFrame()]));
    expect(list).toHaveLength(1);
    const serie = list[0] as SerieDataListEntry;
    expect(serie.type).toBe('serie');
    expect(serie.target).toBe('cpu');
    expect(serie.datapoints).toHaveLength(VALUES.length);
    // Flot order is [value, timestamp].
    expect(serie.datapoints[0]).toEqual([VALUES[0], TIMES[0]]);
    expect(serie.datapoints[4]).toEqual([VALUES[4], TIMES[4]]);
  });

  test('a multi-field frame becomes a table entry with columns and rows', () => {
    const frame = toDataFrame({
      name: 'T',
      refId: 'B',
      fields: [
        { name: 'Time', type: FieldType.time, values: TIMES },
        { name: 'ValueA', type: FieldType.number, values: VALUES },
        { name: 'ValueB', type: FieldType.number, values: VALUES.map((v) => v * 2) },
      ],
    });
    const list = dataFramesToDataList(panelDataFromFrames([frame]));
    const table = list[0] as TableDataListEntry;
    expect(table.type).toBe('table');
    expect(table.columns.map((c) => c.text)).toEqual(['Time', 'ValueA', 'ValueB']);
    expect(table.rows).toHaveLength(VALUES.length);
    expect(table.rows[0]).toEqual([TIMES[0], VALUES[0], VALUES[0] * 2]);
  });

  test('empty series produces an empty dataList', () => {
    expect(dataFramesToDataList(panelDataFromFrames([]))).toEqual([]);
  });
});

describe('dataFrameAdapter — serie aggregations match legacy dataList reference (Req 3.3, 3.4)', () => {
  let metric: any;
  beforeEach(() => {
    const handler = adaptDataFrames(panelDataFromFrames([makeSerieFrame()]), stubContext());
    metric = handler.getMetrics('serie')[0];
  });

  test('current/min/max/avg/total equal hand-computed legacy values', () => {
    expect(aggregate(metric, 'current')).toBe(15);
    expect(aggregate(metric, 'min')).toBe(8);
    expect(aggregate(metric, 'max')).toBe(20);
    expect(aggregate(metric, 'total')).toBe(65);
    expect(aggregate(metric, 'avg')).toBe(13);
  });

  test('aggregation invariants hold (min <= avg <= max, total = sum)', () => {
    const min = aggregate(metric, 'min') as number;
    const max = aggregate(metric, 'max') as number;
    const avg = aggregate(metric, 'avg') as number;
    const total = aggregate(metric, 'total') as number;
    expect(min).toBeLessThanOrEqual(avg);
    expect(avg).toBeLessThanOrEqual(max);
    expect(total).toBe(VALUES.reduce((a, b) => a + b, 0));
  });

  test('first/last_time/count are populated from flotpairs', () => {
    expect(aggregate(metric, 'first')).toBe(VALUES[0]);
    expect(aggregate(metric, 'last_time')).toBe(TIMES[TIMES.length - 1]);
    expect(aggregate(metric, 'count')).toBe(VALUES.length);
  });
});

describe('dataFrameAdapter — table aggregations (Req 3.3)', () => {
  test('per-column current/min/max/avg/total are computed', () => {
    // A frame with more than one value column is a table (a Time + single value
    // frame is a serie, matching the legacy serie/table split).
    const frame = toDataFrame({
      name: 'T',
      refId: 'B',
      fields: [
        { name: 'Time', type: FieldType.time, values: TIMES },
        { name: 'ValueA', type: FieldType.number, values: VALUES },
        { name: 'ValueB', type: FieldType.number, values: VALUES.map((v) => v * 2) },
      ],
    });
    const handler = adaptDataFrames(panelDataFromFrames([frame]), stubContext());
    const table = handler.getMetrics('table')[0];
    expect(aggregate(table, 'min', 'ValueA')).toBe(8);
    expect(aggregate(table, 'max', 'ValueA')).toBe(20);
    expect(aggregate(table, 'total', 'ValueA')).toBe(65);
    expect(aggregate(table, 'avg', 'ValueA')).toBe(13);
    expect(aggregate(table, 'current', 'ValueA')).toBe(15);
  });
});

describe('dataFrameAdapter — findValue is nearest-not-after (Req 4.10)', () => {
  let metric: any;
  beforeEach(() => {
    const handler = adaptDataFrames(panelDataFromFrames([makeSerieFrame()]), stubContext());
    metric = handler.getMetrics('serie')[0];
  });

  test('exact timestamp returns its value', () => {
    expect(findValueAt(metric, TIMES[2])).toBe(VALUES[2]);
  });

  test('timestamp between points returns the earlier (not-after) value', () => {
    const between = TIMES[2] + STEP / 2; // between index 2 and 3
    expect(findValueAt(metric, between)).toBe(VALUES[2]);
  });

  test('timestamp after the last point returns the last value', () => {
    expect(findValueAt(metric, TIMES[TIMES.length - 1] + STEP * 10)).toBe(VALUES[VALUES.length - 1]);
  });
});

describe('dataFrameAdapter — formatting via @grafana/data (Req 3.5, 3.6)', () => {
  test('formatValue applies unit + decimals through getValueFormat', () => {
    // percent(0-100) formatter appends a % suffix.
    expect(formatValue(42.567, 'percent', 1)).toBe('42.6%');
    // no unit: plain number formatting with decimals.
    expect(formatValue(42.567, '', 2)).toBe('42.57');
  });

  test('formatValue returns empty string for null/NaN', () => {
    expect(formatValue(null, 'percent', 1)).toBe('');
    expect(formatValue(NaN, '', 0)).toBe('');
  });

  test('formatDate formats an epoch through dateTime', () => {
    const fmt = 'YYYY-MM-DD HH:mm:ss';
    expect(formatDate(TS0, fmt)).toBe(dateTime(TS0).format(fmt));
  });

  test('formatDate returns empty string for null', () => {
    expect(formatDate(null, 'YYYY-MM-DD')).toBe('');
  });
});
