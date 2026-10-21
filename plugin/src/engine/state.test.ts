/**
 * Feature: angular-to-react-migration — Task 7.3 unit tests for XCell + state
 * application (Req 4.5).
 *
 * Adapted from the legacy `spec/states.test.ts`, which exercised the base
 * `GFState` match/change/level bookkeeping against a bare `{ id }` stub. That
 * suite is preserved here (Part A) and then extended with the behavior Task 7.3
 * actually gates: a Rule result recoloring the *correct* maxGraph cell through
 * the real `XGraph`/`XCell`/`State` engine (Part B/C), the evidence behind
 * Req 4.5 ("WHEN a Rule evaluates against metric data, THE Plugin SHALL apply
 * data-driven cell coloring ... to mapped cells").
 *
 * The Angular-coupled `new GFState(undefined, { id })` of the legacy spec is
 * replaced by a real `XGraph` built from an mxGraph XML sample (reusing the
 * Task 3 spike's `SAMPLE_INFRA_TOPOLOGY_XML`) and a `LogicContext` stub — the
 * same seam pattern as `logic/threshold.test.ts` / `data/dataFrameAdapter.test.ts`.
 *
 * Runs under jsdom (the project's jest env). As the spike's `renderSpike.test.ts`
 * documents, assertions are made at the maxGraph MODEL/STYLE level (cell style
 * keys), not pixels; animation is disabled so the recolor applies synchronously
 * rather than through the timer-driven color sweep.
 */
import { getDefaultTimeRange } from '@grafana/data';
import { XGraph, XCell } from './XGraph';
import { State, GFState } from './state';
import { SAMPLE_INFRA_TOPOLOGY_XML } from './spike/renderSpike';
import { Rule } from '../logic/rule';
import { GFEvents, GlobalSignals, GLOBAL_SIGNALS } from '../logic/flowchartingBase';
import type { LogicContext, MetricHandlerLike, RulesHandlerLike } from '../logic/logicContext';
import type { ObjectMetricLike } from '../logic/engineRefs';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** A metric standing in for the Task-5 SerieMetric — only the bits the Rule and
 * State read: a name (matched by the rule pattern) and a fixed aggregated value. */
function stubMetric(name: string, value: number): ObjectMetricLike {
  let uid = 0;
  return {
    uid: `metric-${name}-${uid++}`,
    type: 'serie',
    getName: () => name,
    getValue: () => value,
  } as ObjectMetricLike;
}

interface StubContext extends LogicContext {
  metricHandler: MetricHandlerLike;
  rulesHandler: RulesHandlerLike;
}

/**
 * A `LogicContext` stub with live `metricHandler` and `rulesHandler` event buses
 * so the test can drive metric/rule registration exactly as the real handlers
 * would: the Rule connects to `metricHandler.events('metric_created')`, and the
 * State connects to `rulesHandler.events('rule_created'/'rule_changed'/...)`.
 */
function stubContext(): StubContext {
  const events = GFEvents.create<GlobalSignals>(GLOBAL_SIGNALS);
  const metricEvents = GFEvents.create<'metric_created' | 'metric_updated' | 'metric_deleted'>([
    'metric_created',
    'metric_updated',
    'metric_deleted',
  ]);
  const rulesEvents = GFEvents.create<'rule_created' | 'rule_updated' | 'rule_changed' | 'rule_deleted'>([
    'rule_created',
    'rule_updated',
    'rule_changed',
    'rule_deleted',
  ]);
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
    metricHandler: {
      events: metricEvents,
      isMultipleType: () => false,
      isTypeOf: (type: 'serie' | 'table') => type === 'serie',
    },
    rulesHandler: {
      events: rulesEvents,
      getRule: () => null,
    },
  };
}

/** Build a jsdom container sized like the spike test. */
function makeContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.width = '800px';
  container.style.height = '600px';
  document.body.appendChild(container);
  return container;
}

/**
 * Build a 2-level serie number Rule that colors matching cells on `fillColor`:
 *   - base threshold (level 0, index 0): always matches, GREEN
 *   - high threshold (index 1, ge 50): RED
 * For a non-inverted rule the displayed level is `count-1-index`, so index 1
 * (value >= 50) is the highest-priority level and yields RED.
 */
const GREEN = '#00ff00';
const RED = '#ff0000';
function makeShapeRule(gf: LogicContext, cellPattern: string, metricPattern = '/.*/'): Rule {
  const rule = new Rule(gf, metricPattern, Rule.getDefaultData());
  rule.metricType = 'serie';
  rule.aggregation = 'current';
  rule.dataType = 'number';
  // Base (always matches) then the ge-50 step.
  rule.addThreshold(0, GREEN, 0);
  rule.addThreshold(1, RED, 50);
  // One shape map on fillColor, pattern targets the cell id/value.
  const shape = rule.addShapeMap(cellPattern);
  shape.style = 'fillColor';
  shape.condition = 'a'; // colorOn 'a' => eligible for any level
  return rule;
}

/** Register a metric on the rule via the metricHandler bus and return it. */
async function registerMetric(gf: StubContext, name: string, value: number): Promise<ObjectMetricLike> {
  const metric = stubMetric(name, value);
  await gf.metricHandler.events.emit('metric_created', metric);
  return metric;
}

// ===========================================================================
// Part A — GFState bookkeeping (adapted verbatim from spec/states.test.ts).
//
// The legacy spec constructed `new GFState(undefined, { id: '1234' })`; the
// ported GFState takes `(xgraph, xcell)` but the match/change/level logic it
// exercises touches neither, so a pair of casts keeps the original assertions.
// ===========================================================================

describe('Task 7.3 — GFState match/change/level bookkeeping (adapted from legacy states.test.ts)', () => {
  const xgraph = undefined as unknown as XGraph;
  const xcell = { id: '1234' } as unknown as XCell;
  const gf = new GFState(xgraph, xcell);
  const key1 = 'key1';
  const key2 = 'key2';

  test('is constructed', () => {
    expect(gf).toBeInstanceOf(GFState);
  });

  test('addValue seeds a key at the default level, unmatched and unchanged', () => {
    gf.addValue(key1, 0);
    expect(gf.getDefaultValue(key1)).toBe(0);
    expect(gf.isChanged(key1)).toBe(false);
    expect(gf.isMatched(key1)).toBe(false);
    expect(gf.getLevel(key1)).toBe(GFState.DEFAULTLEVEL);
    expect(gf.getLevel()).toBe(GFState.DEFAULTLEVEL);
  });

  test('set(key1, 10, level 1) matches and records the value and level', () => {
    gf.set(key1, 10, 1);
    expect(gf.isMatched(key1)).toBe(true);
    expect(gf.getMatchValue(key1)).toBe(10);
    expect(gf.isMatched()).toBe(true);
    expect(gf.isChanged()).toBe(false);
    expect(gf.getLevel(key1)).toBe(1);
    expect(gf.getLevel()).toBe(1);
  });

  test('a lower-level set does not override a higher-level match', () => {
    gf.set(key1, 999, 0); // level 0 < stored 1 => ignored
    expect(gf.getMatchValue(key1)).toBe(10);
    expect(gf.getLevel(key1)).toBe(1);
  });

  test('a higher-level set overrides (level 2, value 30)', () => {
    gf.set(key1, 30, 2);
    expect(gf.isMatched(key1)).toBe(true);
    expect(gf.getMatchValue(key1)).toBe(30);
    expect(gf.getLevel(key1)).toBe(2);
    expect(gf.getLevel()).toBe(2);
  });

  test('a second key tracks its own level; getLevel() is the max', () => {
    gf.set(key2, 100, 3);
    expect(gf.isMatched(key2)).toBe(true);
    expect(gf.getMatchValue(key2)).toBe(100);
    expect(gf.getLevel(key1)).toBe(2);
    expect(gf.getLevel(key2)).toBe(3);
    expect(gf.getLevel()).toBe(3);
  });

  test('apply(key1) acks key1: matched -> changed, key2 untouched', () => {
    gf.apply(key1);
    expect(gf.isChanged(key1)).toBe(true);
    expect(gf.isChanged(key2)).toBe(false);
    expect(gf.isMatched(key1)).toBe(false);
  });

  test('apply() acks all keys', () => {
    gf.apply();
    expect(gf.isChanged(key1)).toBe(true);
    expect(gf.isChanged(key2)).toBe(true);
    expect(gf.isChanged()).toBe(true);
    expect(gf.isMatched()).toBe(false);
  });
});

// ===========================================================================
// Part B — XCell style get/set/restore over the real maxGraph model.
// ===========================================================================

describe('Task 7.3 — XCell style application over the real maxGraph model (Req 4.5)', () => {
  let container: HTMLDivElement;
  let xgraph: XGraph;

  beforeEach(() => {
    container = makeContainer();
    xgraph = new XGraph(container, 'xml', SAMPLE_INFRA_TOPOLOGY_XML);
    xgraph.enableAnimation(false);
  });

  afterEach(() => {
    xgraph.free();
    document.body.removeChild(container);
  });

  test('XGraph captures one XCell per sample vertex (web, app, db)', () => {
    expect(xgraph.getXCell('web')).toBeInstanceOf(XCell);
    expect(xgraph.getXCell('app')).toBeInstanceOf(XCell);
    expect(xgraph.getXCell('db')).toBeInstanceOf(XCell);
  });

  test('getStyle reads the authored fillColor from the sample XML', () => {
    const web = xgraph.getXCell('web')!;
    expect((web.getStyle('fillColor') ?? '').toLowerCase()).toBe('#dae8fc');
  });

  test('setStyle changes fillColor and captures the default for restore', () => {
    const web = xgraph.getXCell('web')!;
    expect((web.getDefaultStyle('fillColor') ?? '').toLowerCase()).toBe('#dae8fc');

    web.setStyle('fillColor', RED);
    expect((web.getStyle('fillColor') ?? '').toLowerCase()).toBe(RED);

    web.restoreStyle('fillColor');
    expect((web.getStyle('fillColor') ?? '').toLowerCase()).toBe('#dae8fc');
  });

  test('setAnimColorCell (animation off) applies the color directly to the cell', () => {
    const app = xgraph.getXCell('app')!;
    xgraph.setAnimColorCell(app, 'fillColor', RED);
    expect((app.getStyle('fillColor') ?? '').toLowerCase()).toBe(RED);
    // A different cell is untouched.
    const web = xgraph.getXCell('web')!;
    expect((web.getStyle('fillColor') ?? '').toLowerCase()).toBe('#dae8fc');
  });
});

// ===========================================================================
// Part C — a Rule result recolors the CORRECT cell through the State cycle.
// This is the Req 4.5 Verify assertion.
// ===========================================================================

describe('Task 7.3 — a Rule result recolors the correct cell (Req 4.5 Verify)', () => {
  let container: HTMLDivElement;
  let gf: StubContext;
  let xgraph: XGraph;

  beforeEach(() => {
    container = makeContainer();
    gf = stubContext();
    xgraph = new XGraph(container, 'xml', SAMPLE_INFRA_TOPOLOGY_XML);
    xgraph.enableAnimation(false);
  });

  afterEach(() => {
    xgraph.free();
    document.body.removeChild(container);
  });

  /**
   * Drive the full match/apply cycle for one cell: create a State for the cell,
   * register the rule on the rulesHandler bus (which the State connects to), then
   * run the update cycle and return the cell's resulting fillColor.
   */
  async function colorAfterRule(xcell: XCell, rule: Rule, metricValue: number): Promise<string> {
    await registerMetric(gf, 'cpu', metricValue);
    const state = new State(gf, xcell, xgraph);
    // The State wired itself to rulesHandler on construction; announce the rule.
    await gf.rulesHandler.events.emit('rule_created', rule);
    await state.update();
    return (xcell.getStyle('fillColor') ?? '').toLowerCase();
  }

  test('a rule matching only "app" recolors app and leaves web and db unchanged', async () => {
    const rule = makeShapeRule(gf, 'app');
    const app = xgraph.getXCell('app')!;
    const web = xgraph.getXCell('web')!;
    const db = xgraph.getXCell('db')!;

    // value 80 >= 50 => high threshold (RED) is the eligible highest level.
    const appColor = await colorAfterRule(app, rule, 80);
    expect(appColor).toBe(RED);

    // web/db were never given a State and keep their authored fill.
    expect((web.getStyle('fillColor') ?? '').toLowerCase()).toBe('#dae8fc');
    expect((db.getStyle('fillColor') ?? '').toLowerCase()).toBe('#ffe6cc');
  });

  test('the threshold color tracks the metric value (below threshold => base color)', async () => {
    const rule = makeShapeRule(gf, 'web');
    const web = xgraph.getXCell('web')!;
    // value 10 < 50 => base threshold (GREEN).
    const webColor = await colorAfterRule(web, rule, 10);
    expect(webColor).toBe(GREEN);
  });

  test('a rule whose shape pattern matches no cell leaves the cell at its default', async () => {
    const rule = makeShapeRule(gf, 'does-not-exist');
    const db = xgraph.getXCell('db')!;
    const dbColor = await colorAfterRule(db, rule, 80);
    // Unmatched: the authored cylinder fill is preserved.
    expect(dbColor).toBe('#ffe6cc');
  });

  test('two cells with the same rule recolor independently by their own value path', async () => {
    // Pattern matches both web and app (alternation via regex).
    const ruleWeb = makeShapeRule(gf, 'web');
    const ruleApp = makeShapeRule(gf, 'app');
    const web = xgraph.getXCell('web')!;
    const app = xgraph.getXCell('app')!;

    const webColor = await colorAfterRule(web, ruleWeb, 10); // below => GREEN
    const appColor = await colorAfterRule(app, ruleApp, 80); // above => RED

    expect(webColor).toBe(GREEN);
    expect(appColor).toBe(RED);
  });
});
