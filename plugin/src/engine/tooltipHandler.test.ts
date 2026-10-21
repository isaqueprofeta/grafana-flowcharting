/**
 * Feature: angular-to-react-migration — Task 11.1 unit tests for the ported
 * `TooltipHandler` (Req 4.6 tooltips with sparklines).
 *
 * Part A exercises the tooltip builder directly: it constructs a handler,
 * builds metric rows (label/value/color/direction), renders line and bar
 * sparklines as inline SVG (the chartist replacement), renders a metadata row
 * from an XCell, and produces the detached overlay DOM.
 *
 * Part B is the Req 4.6 integration assertion: a tooltip-eligible Rule driven
 * through the real `XGraph`/`XCell`/`State` engine no longer throws the
 * "ported in Task 11" error — the TooltipState now constructs the concrete
 * handler and attaches it to the cell.
 *
 * Runs under jsdom (the project's jest env). Sparkline assertions are made at
 * the SVG DOM level (element counts / point data), not pixels.
 */
import { getDefaultTimeRange } from '@grafana/data';
import {
  TooltipHandler,
  MetricTooltip,
  LineGraphTooltip,
  BarGraphTooltip,
  MetadataTooltip,
  htmlEntities,
} from './tooltipHandler';
import { XGraph, XCell } from './XGraph';
import { State } from './state';
import { SAMPLE_INFRA_TOPOLOGY_XML } from './spike/renderSpike';
import { Rule } from '../logic/rule';
import { GFEvents, GlobalSignals, GLOBAL_SIGNALS } from '../logic/flowchartingBase';
import type { LogicContext, MetricHandlerLike, RulesHandlerLike } from '../logic/logicContext';
import type { ObjectMetricLike } from '../logic/engineRefs';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** A metric exposing getValue (for the rule) and getData (for the sparkline). */
function stubMetricWithData(name: string, value: number, series: number[]): ObjectMetricLike {
  return {
    uid: `metric-${name}`,
    type: 'serie',
    getName: () => name,
    getValue: () => value,
    getData: () => series,
  } as unknown as ObjectMetricLike;
}

interface StubContext extends LogicContext {
  metricHandler: MetricHandlerLike;
  rulesHandler: RulesHandlerLike;
}

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

function makeContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.width = '800px';
  container.style.height = '600px';
  document.body.appendChild(container);
  return container;
}

// ===========================================================================
// Part A — the TooltipHandler builder.
// ===========================================================================

describe('Task 11.1 — TooltipHandler builds the overlay DOM (Req 4.6)', () => {
  test('a fresh handler is unchecked and yields no div', () => {
    const tp = new TooltipHandler();
    expect(tp.isChecked()).toBe(false);
    expect(tp.getDiv()).toBeNull();
  });

  test('adding a metric marks the handler checked and builds a metric row', () => {
    const tp = new TooltipHandler();
    tp.addMetric().setLabel('cpu').setValue('80%').setColor('#ff0000').setDirection('v');
    tp.updateDate();
    expect(tp.isChecked()).toBe(true);

    const parent = document.createElement('div');
    const div = tp.getDiv(parent)!;
    expect(div).not.toBeNull();
    // Date header + one metric row.
    expect(div.querySelector('.tooltip-date')).not.toBeNull();
    const metricRow = div.querySelector('.tooltip-metric');
    expect(metricRow).not.toBeNull();
    const text = div.querySelector('.tooltip-text')!;
    expect(text.innerHTML).toContain('cpu');
    expect(text.innerHTML).toContain('80%');
    expect(text.innerHTML).toContain('#ff0000');
  });

  test('horizontal direction renders the metric row inline-block', () => {
    const metric = new MetricTooltip();
    metric.setLabel('lat').setValue('5ms').setDirection('h');
    const parent = document.createElement('div');
    const row = metric.getDiv(parent);
    expect(row.style.display).toBe('inline-block');
  });

  test('getDiv is idempotent — a second call reuses the cached div', () => {
    const tp = new TooltipHandler();
    tp.addMetric().setLabel('cpu').setValue('1');
    tp.updateDate();
    const first = tp.getDiv(document.createElement('div'));
    const second = tp.getDiv(document.createElement('div'));
    expect(second).toBe(first);
  });

  test('destroy clears metrics, metadata and the cached div', () => {
    const tp = new TooltipHandler();
    tp.addMetric().setLabel('cpu').setValue('1');
    tp.updateDate();
    tp.getDiv(document.createElement('div'));
    tp.destroy();
    expect(tp.metrics.size).toBe(0);
    expect(tp.metadata).toBeNull();
    expect(tp.div).toBeNull();
  });
});

describe('Task 11.1 — inline-SVG sparklines (chartist replacement, Req 4.6)', () => {
  test('a line graph renders an SVG with an area path and a polyline', () => {
    const metric = new MetricTooltip();
    const graph = metric.addGraph('line') as LineGraphTooltip;
    graph.setColor('#00ff00').setColumn('').setMetric(stubMetricWithData('cpu', 50, [10, 20, 30, 25, 40]));

    const parent = document.createElement('div');
    graph.getDiv(parent);
    const svg = parent.querySelector('svg')!;
    expect(svg).not.toBeNull();
    const polyline = svg.querySelector('polyline')!;
    expect(polyline).not.toBeNull();
    // 5 samples => 5 points on the line.
    expect(polyline.getAttribute('points')!.trim().split(/\s+/).length).toBe(5);
    expect(polyline.getAttribute('style')).toContain('#00ff00');
    // An area fill path is present.
    expect(svg.querySelector('path')).not.toBeNull();
  });

  test('a bar graph renders one rect per sample', () => {
    const metric = new MetricTooltip();
    const graph = metric.addGraph('bar') as BarGraphTooltip;
    graph.setColor('#0000ff').setColumn('').setMetric(stubMetricWithData('cpu', 50, [1, 2, 3, 4]));

    const parent = document.createElement('div');
    graph.getDiv(parent);
    const svg = parent.querySelector('svg')!;
    expect(svg.querySelectorAll('rect').length).toBe(4);
    expect(svg.querySelector('rect')!.getAttribute('style')).toContain('#0000ff');
  });

  test('a graph with no metric renders an empty SVG (no points/bars)', () => {
    const metric = new MetricTooltip();
    const graph = metric.addGraph('line') as LineGraphTooltip;
    const parent = document.createElement('div');
    graph.getDiv(parent);
    const svg = parent.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.querySelector('polyline')).toBeNull();
  });

  test('setSize sets the container width and setScaling clamps the series', () => {
    const metric = new MetricTooltip();
    const graph = metric.addGraph('bar') as BarGraphTooltip;
    graph
      .setColumn('')
      .setMetric(stubMetricWithData('cpu', 50, [-5, 100, 50]))
      .setSize('200px')
      .setScaling(0, 60)
      .setScale('linear');
    const parent = document.createElement('div');
    const div = graph.getDiv(parent);
    expect(div.style.width).toBe('200px');
    // Clamped series [0, 60, 50] normalized to [0, 1, 0.833]; three bars.
    expect(div.querySelectorAll('rect').length).toBe(3);
  });

  test('a metric row with a graph nests the sparkline SVG under the row', () => {
    const tp = new TooltipHandler();
    const metric = tp.addMetric().setLabel('cpu').setValue('40');
    metric.addGraph('line').setColumn('').setMetric(stubMetricWithData('cpu', 40, [1, 2, 3]));
    tp.updateDate();
    const parent = document.createElement('div');
    const div = tp.getDiv(parent)!;
    expect(div.querySelector('.tooltip-metric svg')).not.toBeNull();
  });
});

describe('Task 11.1 — metadata row and HTML escaping', () => {
  test('htmlEntities escapes the HTML-significant characters', () => {
    expect(htmlEntities('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });

  test('a metadata row renders escaped key/value pairs from the XCell', () => {
    const xcell = {
      getDefaultValues: () => '',
      getMetadatas: () =>
        new Map<string, string>([
          ['env', 'prod'],
          ['danger', '<script>'],
          ['', 'skip-empty-key'],
        ]),
    } as unknown as XCell;

    const md = new MetadataTooltip().setXCell(xcell);
    const parent = document.createElement('div');
    const div = md.getDiv(parent);
    expect(div.innerHTML).toContain('env');
    expect(div.innerHTML).toContain('prod');
    // The dangerous value is escaped, not injected.
    expect(div.innerHTML).toContain('&lt;script&gt;');
    expect(div.innerHTML).not.toContain('<script>');
    // The empty-key entry is skipped.
    expect(div.querySelectorAll('div').length).toBe(2);
  });
});

// ===========================================================================
// Part B — a tooltip-eligible rule no longer throws (Req 4.6 Verify).
// ===========================================================================

describe('Task 11.1 — a tooltip-eligible rule drives the real handler (Req 4.6 Verify)', () => {
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

  /** A serie-number rule matching `app` that also enables the tooltip. */
  function makeTooltipRule(): Rule {
    const rule = new Rule(gf, '/.*/', Rule.getDefaultData());
    rule.metricType = 'serie';
    rule.aggregation = 'current';
    rule.dataType = 'number';
    rule.addThreshold(0, '#00ff00', 0);
    rule.addThreshold(1, '#ff0000', 50);
    const shape = rule.addShapeMap('app');
    shape.style = 'fillColor';
    shape.condition = 'a';
    // Enable the tooltip path.
    rule.tooltip = true;
    rule.tooltipOn = 'a';
    rule.tooltipForGraph = true;
    rule.tooltipColors = true;
    rule.tooltipMetadata = true;
    return rule;
  }

  test('the State update cycle no longer throws and attaches a checked handler', async () => {
    // Build the rule first so it catches the metric_created event (the Rule
    // binds matching metrics on that signal), mirroring state.test.ts ordering.
    const rule = makeTooltipRule();
    const metric = stubMetricWithData('cpu', 80, [10, 20, 30, 80]);
    await gf.metricHandler.events.emit('metric_created', metric);

    const app = xgraph.getXCell('app')!;
    const state = new State(gf, app, xgraph);
    await gf.rulesHandler.events.emit('rule_created', rule);

    // The legacy forward-decl threw "ported in Task 11" here; it must not now.
    await expect(state.update()).resolves.toBeUndefined();

    // Sanity: the shape map matched (the cell recolored to the high threshold).
    expect((app.getStyle('fillColor') ?? '').toLowerCase()).toBe('#ff0000');

    const handler = app.getTooltipHandler();
    expect(handler).toBeDefined();
    expect(handler!.isChecked()).toBe(true);

    // The attached handler renders a populated overlay div.
    const div = (handler as TooltipHandler).getDiv(document.createElement('div'));
    expect(div).not.toBeNull();
    expect(div!.querySelector('.tooltip-metric')).not.toBeNull();
  });

  test('XCell.enableTooltip + setTooltipHandler round-trips the handler', () => {
    const app = xgraph.getXCell('app')!;
    const tp = new TooltipHandler();
    tp.addMetric().setLabel('cpu').setValue('1');
    app.enableTooltip().setTooltipHandler(tp);
    expect(app.isTooltipEnabled()).toBe(true);
    expect(app.getTooltipHandler()).toBe(tp);
  });
});
