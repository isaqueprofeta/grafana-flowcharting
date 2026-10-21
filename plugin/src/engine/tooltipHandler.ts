/**
 * tooltipHandler — the per-cell tooltip DOM overlay, ported from the legacy
 * `src/tooltipHandler.ts` **with import swaps only** (design.md: Render_Engine,
 * Req 4.6 tooltips with sparklines).
 *
 * Import swaps from the legacy module:
 *   - `$GF.getCurrentDate`      -> `getCurrentDate`              (logic/globals)
 *   - `GFLog`                   -> `GFLog`                       (logic/globals)
 *   - `Metric` / `XCell`        -> the structural `*Like` contracts from
 *                                  logic/engineRefs (the concrete engine
 *                                  `XCell` and metric union satisfy them)
 *   - `gf.T*Keys` ambient types -> exported types from logic/legacyTypes
 *   - `mxUtils.htmlEntities`    -> a local `htmlEntities` escaper (no mxGraph
 *                                  global coupling)
 *   - **`chartist`**            -> a dependency-free inline **SVG sparkline**.
 *                                  Chartist was never added to the new
 *                                  ESM/webpack build; rather than reintroduce a
 *                                  charting dependency (and its DOM-measurement
 *                                  assumptions that don't hold inside an
 *                                  off-screen tooltip div), the line/bar
 *                                  sparklines are drawn as plain inline SVG.
 *                                  No `eval`, no global mutation.
 *
 * The exported classes satisfy the forward-declared contracts in
 * logic/engineRefs (`TooltipHandlerLike` / `TooltipMetricLike` /
 * `TooltipGraphLike`); `engine/state` constructs this concrete handler where it
 * previously threw the "ported in Task 11" error.
 */
import { GFLog, getCurrentDate } from '../logic/globals';
import type {
  ObjectMetricLike,
  TooltipGraphLike,
  TooltipHandlerLike,
  TooltipMetricLike,
} from '../logic/engineRefs';
import type { XCellLike } from '../logic/engineRefs';
import type { TDirectionKeys, TGraphScaleKeys, TGraphSizeKeys, TGraphTypeKeys } from '../logic/legacyTypes';

/** The metadata contract the metadata row reads (concrete XCell satisfies it). */
interface TooltipXCellLike extends XCellLike {
  getMetadatas(): Map<string, string>;
}

/** The sparkline data contract the graph reads off a metric at render time. */
interface TooltipMetricDataLike extends ObjectMetricLike {
  getData(column?: string, log?: boolean): number[] | Array<{ x: number | Date; y: number }>;
}

const DEFAULT_COLOR = '#8c8980';

/**
 * Escape the HTML-significant characters in a string (replaces the legacy
 * `mxUtils.htmlEntities`, which the metadata row used to render cell metadata
 * values safely).
 */
export function htmlEntities(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Normalize the raw metric samples into a numeric `y` series for the sparkline. */
function toYSeries(data: number[] | Array<{ x: number | Date; y: number }>): number[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .map((d) => (typeof d === 'number' ? d : d && typeof d.y === 'number' ? d.y : NaN))
    .filter((n) => typeof n === 'number' && !Number.isNaN(n));
}

/**
 * TooltipHandler — the root overlay builder. Collects metric rows + an optional
 * metadata row and renders them (with a date header) into a detached `<div>`
 * that the engine attaches to the cell.
 */
export class TooltipHandler implements TooltipHandlerLike {
  timeFormat = 'YYYY-MM-DD HH:mm:ss';
  checked = false;
  metrics: Set<MetricTooltip>;
  metadata: MetadataTooltip | null = null;
  lastChange: string | undefined;
  div: HTMLDivElement | null = null;

  constructor() {
    this.checked = false;
    this.metrics = new Set();
  }

  /** Return whether the tooltip has any content to display. */
  isChecked(): boolean {
    return this.checked;
  }

  /** Add a metric row (one labelled value, optionally with a sparkline). */
  addMetric(): MetricTooltip {
    this.checked = true;
    const metric = new MetricTooltip();
    this.metrics.add(metric);
    return metric;
  }

  /** Add the cell-metadata row. */
  addMetadata(): MetadataTooltip {
    this.checked = true;
    this.metadata = new MetadataTooltip();
    return this.metadata;
  }

  /** Stamp the "last change" date shown at the top of the tooltip. */
  updateDate(): void {
    this.lastChange = getCurrentDate();
  }

  destroy(): void {
    this.metrics.clear();
    this.metadata = null;
    this.div = null;
  }

  /** Build (or reattach) the overlay DOM under `parentDiv`. */
  getDiv(parentDiv?: HTMLDivElement): HTMLDivElement | null {
    if (this.div !== null && this.div !== undefined) {
      if (parentDiv && this.div) {
        parentDiv.appendChild(this.div);
      }
      return this.div;
    }
    if (!this.checked) {
      return null;
    }
    const div = document.createElement('div');
    if (parentDiv !== undefined) {
      parentDiv.appendChild(div);
    }
    // Values + graphs
    if (this.metrics.size > 0) {
      this.getDateDiv(div);
      this.metrics.forEach((metric: MetricTooltip) => {
        metric.getDiv(div);
      });
    }
    // Metadata
    if (this.metadata !== undefined && this.metadata !== null) {
      this.metadata.getDiv(div);
    }
    this.div = div;
    return div;
  }

  getDateDiv(parentDiv: HTMLDivElement): HTMLDivElement {
    const div = document.createElement('div');
    if (parentDiv !== undefined) {
      parentDiv.appendChild(div);
    }
    div.className = 'graph-tooltip-time tooltip-date';
    div.innerHTML = `${this.lastChange ?? ''}`;
    return div;
  }
}

/**
 * MetricTooltip — one labelled value row, optionally carrying one or more
 * sparkline graphs. Fluent setters satisfy {@link TooltipMetricLike}.
 */
export class MetricTooltip implements TooltipMetricLike {
  color: string;
  graphs: Set<GraphTooltip>;
  label: string;
  value: string;
  direction: TDirectionKeys = 'v';
  div: HTMLDivElement | undefined;

  constructor() {
    this.color = DEFAULT_COLOR;
    this.graphs = new Set();
    this.label = '';
    this.value = '';
  }

  setLabel(label: string): this {
    this.label = label;
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  setColor(color: string | null): this {
    if (color !== null) {
      this.color = color;
    }
    return this;
  }

  setDirection(direction: string): this {
    this.direction = direction === 'h' ? 'h' : 'v';
    return this;
  }

  addGraph(type: string): GraphTooltip {
    let graph: GraphTooltip;
    switch (type) {
      case 'line':
        graph = new LineGraphTooltip();
        break;
      case 'bar':
        graph = new BarGraphTooltip();
        break;
      default:
        GFLog.error('Graph type unknow', type);
        graph = new BarGraphTooltip();
        break;
    }
    this.graphs.add(graph);
    return graph;
  }

  getDiv(parentDiv: HTMLDivElement): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'tooltip-metric';
    if (this.direction === 'h') {
      div.style.display = 'inline-block';
    }
    if (parentDiv !== undefined) {
      parentDiv.appendChild(div);
    }
    this.div = div;
    this.getTextDiv(div);
    this.getGraphsDiv(div);
    return div;
  }

  getTextDiv(parentDiv: HTMLDivElement): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'tooltip-text';
    let str = '';
    if (parentDiv !== undefined) {
      parentDiv.appendChild(div);
    }
    if (this.label !== undefined) {
      str += `${htmlEntities(this.label)} : `;
      str += `<span style="color:${this.color}"><b>${htmlEntities(this.value)}</b></span>`;
    }
    div.innerHTML = str;
    return div;
  }

  getGraphsDiv(parentDiv: HTMLDivElement): HTMLDivElement {
    const div = document.createElement('div');
    if (parentDiv !== undefined) {
      parentDiv.appendChild(div);
    }
    if (this.graphs.size > 0) {
      this.graphs.forEach((graph) => {
        graph.getDiv(div);
      });
    }
    return div;
  }
}

/**
 * GraphTooltip — base sparkline builder. Fluent setters satisfy
 * {@link TooltipGraphLike}; subclasses render a line or bar inline SVG.
 */
export class GraphTooltip implements TooltipGraphLike {
  color = DEFAULT_COLOR;
  type: TGraphTypeKeys = 'line';
  name: string | undefined;
  column: string | undefined;
  size: TGraphSizeKeys = '100%';
  metric: TooltipMetricDataLike | undefined;
  low: number | null = null;
  high: number | null = null;
  scaleType: TGraphScaleKeys = 'linear';
  div: HTMLDivElement | undefined;
  parentDiv: HTMLDivElement | undefined;

  constructor() {}

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setColumn(column: string): this {
    this.column = column;
    return this;
  }

  setType(type: TGraphTypeKeys): this {
    this.type = type;
    return this;
  }

  setSize(size: string): this {
    this.size = size as TGraphSizeKeys;
    return this;
  }

  setMetric(metric: ObjectMetricLike): this {
    // The concrete SerieMetric/TableMetric provide `getData`; the structural
    // ObjectMetricLike contract doesn't declare it, so narrow at the boundary.
    this.metric = metric as TooltipMetricDataLike;
    return this;
  }

  setScaling(low: number | null, high: number | null): this {
    this.low = low;
    this.high = high;
    return this;
  }

  setScale(type: string): this {
    this.scaleType = type === 'log' ? 'log' : 'linear';
    return this;
  }

  setColor(color: string | null): this {
    if (color !== null) {
      this.color = color;
    }
    return this;
  }

  setParentDiv(div: HTMLDivElement): this {
    this.parentDiv = div;
    return this;
  }

  /** Read the numeric series this graph should plot (log-scaled when requested). */
  protected readSeries(): number[] {
    if (!this.metric || typeof this.metric.getData !== 'function') {
      return [];
    }
    const log = this.scaleType === 'log';
    let series = toYSeries(this.metric.getData(this.column, log));
    // Clamp to the configured scaling window when provided (mirrors chartist
    // low/high, which clipped the plotted range).
    if (this.low !== null) {
      const low = this.low;
      series = series.map((y) => (y < low ? low : y));
    }
    if (this.high !== null) {
      const high = this.high;
      series = series.map((y) => (y > high ? high : y));
    }
    return series;
  }

  /** Create the sized container div the inline SVG is drawn into. */
  protected createContainer(parentDiv: HTMLDivElement): HTMLDivElement {
    const div = document.createElement('div');
    this.div = div;
    if (parentDiv !== undefined) {
      parentDiv.appendChild(div);
    }
    div.className = 'ct-chart ct-golden-section';
    if (this.size !== null) {
      div.style.width = this.size;
    }
    return div;
  }

  getDiv(_parentDiv: HTMLDivElement): HTMLDivElement | undefined {
    return this.div;
  }
}

const SPARK_WIDTH = 100;
const SPARK_HEIGHT = 30;

/** Map a numeric series to [0..1] with the effective low/high bounds. */
function normalized(series: number[], low: number | null, high: number | null): number[] {
  if (series.length === 0) {
    return [];
  }
  const min = low !== null ? low : Math.min(...series);
  const max = high !== null ? high : Math.max(...series);
  const span = max - min;
  if (span === 0) {
    return series.map(() => 0.5);
  }
  return series.map((y) => (y - min) / span);
}

/**
 * LineGraphTooltip — a filled-area line sparkline drawn as inline SVG
 * (replacing the legacy `Chartist.Line`).
 */
export class LineGraphTooltip extends GraphTooltip {
  constructor() {
    super();
    this.type = 'line';
  }

  getDiv(parentDiv: HTMLDivElement): HTMLDivElement {
    const div = this.createContainer(parentDiv);
    const series = this.readSeries();
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', `${SPARK_HEIGHT}`);
    svg.setAttribute('class', 'ct-chart-line');

    const norm = normalized(series, this.low, this.high);
    if (norm.length >= 2) {
      const step = SPARK_WIDTH / (norm.length - 1);
      const points = norm.map((v, i) => {
        const x = i * step;
        const y = SPARK_HEIGHT - v * SPARK_HEIGHT;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      // Area (fill)
      const area = document.createElementNS(SVG_NS, 'path');
      const areaD = `M${points[0]} L${points.join(' L')} L${SPARK_WIDTH},${SPARK_HEIGHT} L0,${SPARK_HEIGHT} Z`;
      area.setAttribute('d', areaD);
      area.setAttribute('style', `fill: ${this.color}; fill-opacity: 0.2; stroke: none`);
      svg.appendChild(area);
      // Line (stroke)
      const line = document.createElementNS(SVG_NS, 'polyline');
      line.setAttribute('points', points.join(' '));
      line.setAttribute('style', `fill: none; stroke: ${this.color}; stroke-width: 1.5`);
      svg.appendChild(line);
    }
    div.appendChild(svg);
    return div;
  }
}

/**
 * BarGraphTooltip — a histogram sparkline drawn as inline SVG (replacing the
 * legacy `Chartist.Bar`).
 */
export class BarGraphTooltip extends GraphTooltip {
  constructor() {
    super();
    this.type = 'bar';
  }

  getDiv(parentDiv: HTMLDivElement): HTMLDivElement {
    const div = this.createContainer(parentDiv);
    const series = this.readSeries();
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', `${SPARK_HEIGHT}`);
    svg.setAttribute('class', 'ct-chart-bar');

    const norm = normalized(series, this.low, this.high);
    if (norm.length > 0) {
      const slot = SPARK_WIDTH / norm.length;
      const barWidth = Math.max(slot * 0.7, 0.5);
      norm.forEach((v, i) => {
        const h = Math.max(v * SPARK_HEIGHT, 0.5);
        const x = i * slot + (slot - barWidth) / 2;
        const y = SPARK_HEIGHT - h;
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', x.toFixed(2));
        rect.setAttribute('y', y.toFixed(2));
        rect.setAttribute('width', barWidth.toFixed(2));
        rect.setAttribute('height', h.toFixed(2));
        rect.setAttribute('style', `fill: ${this.color}`);
        svg.appendChild(rect);
      });
    }
    div.appendChild(svg);
    return div;
  }
}

/**
 * MetadataTooltip — renders the cell's metadata key/value pairs as a row
 * (ported from the legacy `MetadataTooltip`, with `mxUtils.htmlEntities`
 * swapped for the local {@link htmlEntities}).
 */
export class MetadataTooltip {
  enableMetadata = true;
  div: HTMLDivElement | undefined = undefined;
  xcell: TooltipXCellLike | undefined = undefined;

  constructor() {}

  setXCell(cell: XCellLike): this {
    this.xcell = cell as TooltipXCellLike;
    return this;
  }

  getDiv(parentDiv: HTMLDivElement): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'tooltip-metric';
    this.div = div;
    if (parentDiv !== undefined) {
      parentDiv.appendChild(div);
    }
    if (this.xcell !== undefined && typeof this.xcell.getMetadatas === 'function') {
      const md = this.xcell.getMetadatas();
      md.forEach((v, k) => {
        if (k !== undefined && k !== null && k.length > 0 && v !== undefined && v !== null && v.length > 0) {
          const row = document.createElement('div');
          row.innerHTML = `${htmlEntities(k)} : <b>${htmlEntities(v)}</b>`;
          div.appendChild(row);
        }
      });
    }
    return div;
  }
}
