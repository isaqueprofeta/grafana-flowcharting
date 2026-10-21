/**
 * metricHandler — ported `MetricHandler` from the legacy `src/metric_handler.ts`
 * with **import swaps only** (design.md: Logic_Layer "import swaps", Req 3.1-3.4).
 *
 * The handler owns the set of metrics built from the adapted `dataList`
 * (produced by `data/dataFrameAdapter.ts`) and dispatches aggregation lookups to
 * `SerieMetric`/`TableMetric`. The input contract is identical to the legacy
 * engine: `setDataList(datas)` then `change()` converts each entry into a metric.
 *
 * Swaps performed (no algorithm change):
 *   - `$GF` singleton      -> the `GFContext` seam; only its `events` bus is used.
 *   - `$GF.genUid`         -> framework-agnostic `genUid` from `./globals`.
 *   - `$GF.matchString`    -> local `matchString` helper (regex/literal, as legacy).
 *   - `gf.TMetricTypeKeys` -> local `MetricType`.
 *   - the legacy `$gf.metricHandler = this` back-reference is dropped (the seam
 *     exposes no such field; the React layer holds the handler via a ref).
 */
import { SerieMetric, TableMetric, ObjectMetric, Metric, MetricType } from './metricClass';
import { GFLog, genUid } from './globals';
import { GFEvents } from './flowchartingBase';
import type { GFContext } from '../components/context/GFContext';

// Define signals
const metricHandlerSignalsArray = ['metric_created', 'metric_updated', 'metric_deleted'] as const;
type MetricHandlerSignals = typeof metricHandlerSignalsArray[number];

/**
 * Match a string against a pattern — literal or `/regex/flags`. Replaces the
 * legacy `$GF.matchString(text, pattern, regex)` for the handler's metric-name
 * filtering; kept framework-agnostic.
 */
function matchString(text: string, pattern: string | null | undefined): boolean {
  if (pattern === undefined || pattern === null) {
    return false;
  }
  if (text === pattern) {
    return true;
  }
  const re = /^\/(.*)\/([gimsuy]*)$/.exec(pattern);
  try {
    const regex = re ? new RegExp(re[1], re[2]) : new RegExp(`^${pattern}$`);
    return regex.test(text);
  } catch (error) {
    return false;
  }
}

export class MetricHandler {
  private readonly $gf: GFContext;
  dataList: any[] = [];
  uid: string;
  tables: Map<string, TableMetric> = new Map();
  series: Map<string, SerieMetric> = new Map();
  metrics: Map<string, ObjectMetric> = new Map();
  events: GFEvents<MetricHandlerSignals> = GFEvents.create(metricHandlerSignalsArray);

  constructor($gf: GFContext) {
    this.$gf = $gf;
    this.uid = genUid('MetricHandler');
    this.init();
  }

  //
  // Updates
  //
  async change() {
    this.clear();
    await Promise.all(
      this.dataList.map(async (dl) => {
        this.addMetric(dl);
      })
    );
    this.$gf.events.emit('data_processed');
    return;
  }

  update(timestamp?: number): this {
    const funcName = 'update';
    GFLog.debug(`${this.constructor.name}.${funcName}() : ${this.uid}`);
    this.metrics.forEach((m) => m.update(timestamp));
    return this;
  }

  init(): this {
    const funcName = 'init';
    GFLog.debug(`${this.constructor.name}.${funcName}() : ${this.uid}`);
    this.$gf.events.connect('data_updated', this, this._on_global_data_updated.bind(this));
    this.$gf.events.connect('debug_asked', this, this._on_global_debug_asked.bind(this));
    this.$gf.events.connect('panel_closed', this, this._on_global_panel_closed.bind(this));
    return this;
  }

  free(): this {
    const funcName = 'free';
    GFLog.debug(`${this.constructor.name}.${funcName}() : ${this.uid}`);
    this.metrics.forEach((m: ObjectMetric) => {
      m.free();
      this.events.emit('metric_deleted', m);
    });
    this.$gf.events.disconnect('data_updated', this);
    this.$gf.events.disconnect('debug_asked', this);
    this.$gf.events.disconnect('panel_closed', this);
    this.$gf.events.disconnect('editmode_closed', this);
    this.clear();
    return this;
  }

  setDataList(datas: any[]) {
    this.dataList = datas;
  }

  addMetric(data: any): ObjectMetric {
    let metric: ObjectMetric;
    if (data.type === 'table') {
      metric = this.addTable(data);
    } else {
      metric = this.addSerie(data);
    }
    return metric;
  }

  async removeMetric(metric: Metric) {
    const uid = metric.uid;
    const type = metric.type;
    metric.free();
    if (type === 'serie') {
      this.series.delete(uid);
    }
    if (type === 'table') {
      this.tables.delete(uid);
    }
    this.metrics.delete(uid);
    await this.events.emit('metric_deleted', metric);
  }

  addTable(data: any): TableMetric {
    const table = new TableMetric(this.$gf, data);
    this.tables.set(table.uid, table);
    this.metrics.set(table.uid, table);
    this.events.emit('metric_created', table);
    return table;
  }

  addSerie(data: any): SerieMetric {
    const serie = new SerieMetric(this.$gf, data);
    this.series.set(serie.uid, serie);
    this.metrics.set(serie.uid, serie);
    this.events.emit('metric_created', serie);
    return serie;
  }

  getNames(type?: MetricType): string[] {
    return this.getMetrics(type).map((m) => m.getName());
  }

  getMetrics(type?: MetricType): ObjectMetric[] {
    if (type === 'serie') {
      return Array.from(this.series.values());
    }
    if (type === 'table') {
      return Array.from(this.tables.values());
    }
    return Array.from(this.metrics.values());
  }

  isTypeOf(type?: MetricType): boolean {
    if (type === 'serie') {
      return this.series.size > 0;
    }
    if (type === 'table') {
      return this.tables.size > 0;
    }
    return false;
  }

  findMetrics(name: string, type?: MetricType): ObjectMetric[] {
    return this.getMetrics(type).filter((m) => matchString(m.getName(), name));
  }

  refreshMetrics(timestamp?: number): this {
    this.metrics.forEach((m) => {
      m.update(timestamp);
    });
    return this;
  }

  getColumnsName(metricName: string, type?: MetricType): string[] {
    const metrics = this.findMetrics(metricName, type);
    let columns: string[] = [];
    metrics.forEach((m) => {
      columns = columns.concat(m.getColumnsName());
    });
    return columns;
  }

  clear() {
    this.metrics.forEach((metric) => {
      this.removeMetric(metric);
    });
  }

  isMultipleType() {
    return this.isTypeOf('serie') && this.isTypeOf('table');
  }

  getMetricNames(): string[] {
    const result: string[] = [];
    let prefix = '';
    const multiple = this.isMultipleType();
    if (multiple) {
      prefix = 'Series/';
    }
    this.series.forEach((m) => result.push(`${prefix}${m.getName()}`));
    if (multiple) {
      prefix = 'Tables/';
    }
    this.tables.forEach((t) => {
      t.getColumnsName().forEach((c) => result.push(`${prefix}${t}/${c}`));
    });
    return result;
  }

  //##############################################################
  //### EVENTS
  //##############################################################
  private _on_global_data_updated(dataList: any) {
    this.setDataList(dataList);
    this.change();
  }

  private _on_global_debug_asked() {
    GFLog.debug(`${this.constructor.name} debug`, this);
  }

  private _on_global_panel_closed() {
    this.free();
  }
}
