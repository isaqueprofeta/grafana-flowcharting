/**
 * Feature: angular-to-react-migration — Task 11.2
 * Shared-crosshair hover value consumption (Req 4.10).
 *
 * These tests prove the full shared-crosshair hover path end to end: a hover
 * timestamp delivered through the panel `eventBus` (modelled here by calling the
 * same `MetricHandler.refreshMetrics(timestamp)` / `Metric.update(timestamp)`
 * entry points the Context_Seam `subscribeSharedCrosshair` callback drives) must
 * make the **rule** evaluate the value at that timestamp (nearest-not-after via
 * the preserved `findValue` binary search) rather than the default aggregation,
 * and clearing the hover (`refreshMetrics()` / `update(undefined)`) must reset
 * the evaluated value back to the default aggregation.
 *
 * The assertions go through the genuine consumption point —
 * `Rule.getValueForMetric(metric)` -> `metric.getValue(aggregation, column)` —
 * so this exercises the real wiring the panel uses, not a shortcut.
 *
 *   eventBus hover
 *     -> subscribeSharedCrosshair(ts)
 *     -> FlowchartHandler.refreshMetrics(ts)
 *     -> MetricHandler.refreshMetrics(ts) -> Metric.update(ts)
 *     -> Metric.findValue(ts) -> getValue() returns hovered value
 *     -> Rule.getValueForMetric() reflects the hovered value.
 */
import { LoadingState, PanelData, getDefaultTimeRange, toDataFrame, FieldType } from '@grafana/data';
import { adaptDataFrames } from '../data/dataFrameAdapter';
import { Rule } from './rule';
import type { LogicContext } from './logicContext';
import type { GFContext } from '../components/context/GFContext';
import { GFEvents, GlobalSignals, GLOBAL_SIGNALS } from './flowchartingBase';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A LogicContext stub — the metric layer uses only `events`; the Rule reads
 * the optional `metricHandler` (absent here) and the editor-only helpers. */
function stubLogicContext(): LogicContext {
  const events = GFEvents.create<GlobalSignals>(GLOBAL_SIGNALS);
  const base: GFContext = {
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
  return {
    ...base,
    setMappingCallBack: () => undefined,
    getFullAvailableVarNames: () => [],
    setFocus: () => undefined,
  };
}

function panelDataFromFrames(frames: any[]): PanelData {
  return { state: LoadingState.Done, series: frames, timeRange: getDefaultTimeRange() };
}

// A strictly increasing time axis with distinct values so a hovered timestamp
// maps unambiguously to one datapoint (and a between-samples hover resolves to
// the earlier one — nearest-not-after).
const TS0 = 1653627189784;
const STEP = 20000;
const VALUES = [10, 25, 40, 55, 70];
const TIMES = VALUES.map((_, i) => TS0 + i * STEP);

function makeSerieFrame() {
  return toDataFrame({
    name: 'metric',
    refId: 'A',
    fields: [
      { name: 'Time', type: FieldType.time, values: [...TIMES] },
      { name: 'Value', type: FieldType.number, values: [...VALUES] },
    ],
  });
}

/** Build a serie MetricHandler + a default `current`-aggregation Rule that
 * matches it (default pattern `.*`, metricType `serie`). */
function buildMetricAndRule() {
  const gf = stubLogicContext();
  const handler = adaptDataFrames(panelDataFromFrames([makeSerieFrame()]), gf);
  const metric = handler.getMetrics('serie')[0];
  const rule = new Rule(gf, '.*', Rule.getDefaultData());
  return { handler, metric, rule };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Task 11.2 — shared-crosshair hover drives rule evaluation (Req 4.10)', () => {
  test('default (no hover) — rule evaluates the current aggregation', () => {
    const { rule, metric } = buildMetricAndRule();
    // Default aggregation is `current` = last datapoint value.
    expect(rule.getValueForMetric(metric)).toBe(VALUES[VALUES.length - 1]);
  });

  test('hover at an exact sample timestamp — rule evaluates that sample value', () => {
    const { handler, rule, metric } = buildMetricAndRule();
    // Hover the 2nd sample (value 25). This is the refreshMetrics(ts) path the
    // subscribeSharedCrosshair callback triggers.
    handler.refreshMetrics(TIMES[1]);
    expect(rule.getValueForMetric(metric)).toBe(VALUES[1]);
  });

  test('hover between samples — rule evaluates the nearest-not-after value', () => {
    const { handler, rule, metric } = buildMetricAndRule();
    // Hover just after the 3rd sample but before the 4th: nearest-not-after is
    // the 3rd sample (value 40).
    handler.refreshMetrics(TIMES[2] + 1);
    expect(rule.getValueForMetric(metric)).toBe(VALUES[2]);
  });

  test('clearing the hover resets the rule to the default aggregation', () => {
    const { handler, rule, metric } = buildMetricAndRule();

    handler.refreshMetrics(TIMES[0]); // hover first sample
    expect(rule.getValueForMetric(metric)).toBe(VALUES[0]);

    handler.refreshMetrics(); // crosshair-clear (no timestamp)
    expect(rule.getValueForMetric(metric)).toBe(VALUES[VALUES.length - 1]);
  });

  test('re-hovering after a clear reflects the new hovered timestamp', () => {
    const { handler, rule, metric } = buildMetricAndRule();

    handler.refreshMetrics(TIMES[1]);
    expect(rule.getValueForMetric(metric)).toBe(VALUES[1]);

    handler.refreshMetrics(); // clear
    expect(rule.getValueForMetric(metric)).toBe(VALUES[VALUES.length - 1]);

    handler.refreshMetrics(TIMES[3]); // hover a different sample
    expect(rule.getValueForMetric(metric)).toBe(VALUES[3]);
  });

  test('hasGraphHover tracks the active hover state', () => {
    const { handler, metric } = buildMetricAndRule();
    expect(metric.hasGraphHover()).toBe(false);
    handler.refreshMetrics(TIMES[2]);
    expect(metric.hasGraphHover()).toBe(true);
    handler.refreshMetrics();
    expect(metric.hasGraphHover()).toBe(false);
  });
});
