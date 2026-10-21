/**
 * metricClass — ported `Metric` / `SerieMetric` / `TableMetric` from the legacy
 * `src/metric_class.ts` with **import swaps only** (design.md: Logic_Layer
 * "import swaps", Req 3.1-3.4, 3.7). The aggregation algorithms are preserved
 * verbatim so results match the legacy `dataList` reference (Req 3.4).
 *
 * Swaps performed (no algorithm change):
 *   - `grafana_func.getTimeSeries(...)`  -> `getTimeSeries` from `./timeSeries`
 *     (the classic Grafana `TimeSeries` stats port). `grafana_func` is excluded
 *     from the pipeline (Req 3.7).
 *   - `$GF` singleton                    -> the `GFContext` seam (only its bus +
 *     a framework-agnostic `genUid` are used here).
 *   - `gf.*` ambient types               -> local `MetricType` / `Aggregation`.
 *   - `DateTH.isValidDate`               -> a local date-validity helper, so this
 *     module does not depend on the (separately ported) threshold layer.
 *
 * `SerieMetric`/`TableMetric` consume the same `dataList` shape as the legacy
 * engine: a series is `{ target, datapoints: [[value, ts], ...] }`, a table is
 * `{ type: 'table', columns: [{text}], rows: [[...]] }`. The DataFrame adapter
 * (`data/dataFrameAdapter.ts`) produces exactly these shapes, so the metric
 * classes consume adapted data unchanged (Req 3.1, 3.2).
 */
import { find as _find, isNumber as _isNumber } from 'lodash';
import { GFEvents } from './flowchartingBase';
import { GFLog, genUid } from './globals';
import type { GFContext } from '../components/context/GFContext';
import { getTimeSeries } from './timeSeries';

/** Metric kind (replaces the legacy `gf.TMetricTypeKeys`). */
export type MetricType = 'serie' | 'table';

/** Aggregation keys (replaces the legacy `gf.TAggregationKeys`). */
export type Aggregation =
  | 'first'
  | 'first_notnull'
  | 'current'
  | 'current_notnull'
  | 'min'
  | 'max'
  | 'total'
  | 'avg'
  | 'count'
  | 'delta'
  | 'range'
  | 'diff'
  | 'last_time';

export type ObjectMetric = SerieMetric | TableMetric;

const metricSignalsArray = ['metric_initialized', 'metric_updated', 'metric_freed'] as const;
type MetricSignals = typeof metricSignalsArray[number];

/**
 * Local date-validity check replacing `DateTH.isValidDate` so the metric layer
 * has no dependency on the threshold layer. Accepts numeric epochs and strings
 * that parse to a finite `Date`.
 */
function isValidDateValue(value: string | number | null): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  const t = Date.parse(value);
  return !Number.isNaN(t);
}

/**
 * Metric parent — ported verbatim, `$GF` swapped for the `GFContext` seam.
 */
export class Metric {
  protected readonly $gf: GFContext;
  type: MetricType | 'unknown' = 'unknown';
  uid: string = genUid(this.constructor.name);
  metrics: any = {};
  name = '';
  dataList: any;
  protected _nullPointMode = 'connected';
  protected _GHValue: string | number | null = null;
  /**
   * Whether a shared-crosshair hover is currently active. When `true`, the
   * value a rule evaluates (`getValue`) is the hovered-timestamp value
   * (`_GHValue`, from `findValue`) instead of the default aggregation — this is
   * the legacy `$GF.hasGraphHover()` branch (see `src/metric_class.ts`
   * `getValue`, commented out there because it relied on the `eval`-loaded
   * singleton) reconnected through the React panel `eventBus` (Req 4.10).
   */
  protected _GHActive = false;
  /**
   * The hovered timestamp while `_GHActive` is `true`, kept so subtypes that
   * resolve per-column (tables) can look up the hovered value for the exact
   * column a rule asks for rather than only the default column captured in
   * `_GHValue`.
   */
  protected _GHTimestamp: number | null = null;
  events: GFEvents<MetricSignals> = GFEvents.create(metricSignalsArray);

  constructor($gf: GFContext, dataList: any) {
    this.$gf = $gf;
    this.dataList = dataList;
  }

  setDataList(dataList: any): this {
    this.dataList = dataList;
    return this;
  }

  getName(): string {
    if (this.name === undefined || this.name === null) {
      GFLog.error('Metric => getName : Name is null');
    }
    return this.name;
  }

  getValue(_aggregator: Aggregation, _column?: string): string | number | null {
    return null;
  }

  isValidDate(aggregator: Aggregation, column?: string): boolean {
    return isValidDateValue(this.getValue(aggregator, column));
  }

  findValue(_timestamp: number, _column?: string): string | number | null {
    return null;
  }

  /** True while a shared-crosshair hover timestamp is being reflected. */
  hasGraphHover(): boolean {
    return this._GHActive;
  }

  getData(_column?: string, _log = false): number[] | Array<{ x: number | Date; y: number }> {
    return [];
  }

  getColumnsName(): string[] {
    return [];
  }

  clear() {
    this.dataList = undefined;
    this.metrics = {};
  }

  update(timestamp?: number) {
    if (timestamp !== undefined) {
      this._GHValue = this.findValue(timestamp);
      this._GHTimestamp = timestamp;
      this._GHActive = true;
    } else {
      this._GHValue = null;
      this._GHTimestamp = null;
      this._GHActive = false;
    }
    this.events.emit('metric_updated', this);
  }

  change() {}

  init() {
    this.events.emit('metric_initialized', this);
  }

  async free() {
    this.clear();
    await this.events.emit('metric_freed', this);
    this.events.clear();
  }
}

/**
 * Serie type for a metric — aggregation semantics preserved; TimeSeries source
 * swapped from `grafana_func` to the portable stats implementation.
 */
export class SerieMetric extends Metric {
  constructor($gf: GFContext, dataList: any) {
    super($gf, dataList);
    this.type = 'serie';
    this.init();
  }

  init() {
    this.metrics = this._seriesHandler();
    this._addCustomStats();
    this.name = this.metrics.alias;
    super.init();
    return this;
  }

  private _seriesHandler() {
    let series: any = undefined;
    if (this.dataList) {
      series = getTimeSeries(this.dataList);
      series.flotpairs = series.getFlotPairs(this._nullPointMode);
    }
    return series;
  }

  private _addCustomStats() {
    try {
      const lg = this.metrics.flotpairs.length;
      // LAST TIME
      this.metrics.stats['last_time'] = this.metrics.flotpairs[lg - 1][0];
      // LAST
      this.metrics.stats['current'] = this.metrics.flotpairs[lg - 1][1];
      // LAST NOT NULL
      this.metrics.stats['current_notnull'] = null;
      let idx = lg - 1;
      while ((this.metrics.flotpairs[idx][1] === null || this.metrics.flotpairs[idx][1] === undefined) && idx >= 0) {
        idx -= 1;
      }
      if (idx >= 0) {
        this.metrics.stats['current_notnull'] = this.metrics.flotpairs[idx][1];
      }
      // FIRST
      this.metrics.stats['first'] = this.metrics.flotpairs[0][1];
      // FIRST NOT NULL
      this.metrics.stats['first_notnull'] = null;
      idx = 0;
      while ((this.metrics.flotpairs[idx][1] === null || this.metrics.flotpairs[idx][1] === undefined) && idx < lg) {
        idx += 1;
      }
      if (idx < lg) {
        this.metrics.stats['first_notnull'] = this.metrics.flotpairs[idx][1];
      }
    } catch (error) {
      GFLog.error('Unable to add custom stats', error);
    }
  }

  getValue(aggregator: Aggregation, _column: string = this.name): string | number | null {
    try {
      // Shared-crosshair hover branch (Req 4.10): while a hover timestamp is
      // active, a rule evaluates the value at that timestamp (`findValue`,
      // nearest-not-after) rather than the default aggregation. This is the
      // legacy `$GF.hasGraphHover()` branch from `src/metric_class.ts`
      // `getValue`, reconnected through the React panel `eventBus` and reset by
      // `update(undefined)` on crosshair-clear.
      if (this._GHActive) {
        return this._GHValue;
      }
      const value: string | number | null = this.metrics.stats[aggregator];
      return value;
    } catch (error) {
      GFLog.error('datapoint for serie is null', error);
      return null;
    }
  }

  /**
   * find a value by a timestamp — nearest-not-after binary search over
   * `flotpairs` (`[timestampMs, value]`). Preserved verbatim for the
   * shared-crosshair path (Req 4.10).
   */
  findValue(timestamp: number): string | number | null {
    let low = 0;
    let high = this.metrics.flotpairs.length - 1;
    let found = !(high > 0);
    timestamp = Math.round(timestamp);
    let value = null;
    while (!found) {
      const middle = low + Math.round((high - low) / 2);
      if (this.metrics.flotpairs[middle][0] === timestamp) {
        value = this.metrics.flotpairs[middle][1];
        found = true;
      }
      if (!found && low < middle && middle < high) {
        if (timestamp > this.metrics.flotpairs[middle][0]) {
          low = middle;
        }
        if (timestamp < this.metrics.flotpairs[middle][0]) {
          high = middle;
        }
      } else {
        if (this.metrics.flotpairs[middle][0] > timestamp && middle >= 1) {
          value = this.metrics.flotpairs[middle - 1][1];
        } else {
          value = this.metrics.flotpairs[middle][1];
        }
        found = true;
      }
    }
    return value;
  }

  getData(_column = '', log = false): number[] | Array<{ x: number | Date; y: number }> {
    return this.metrics.flotpairs.map((d: any[]) => {
      if (log) {
        return { x: d[0], y: Math.log10(d[1]) };
      }
      return { x: d[0], y: d[1] };
    });
  }

  getColumnsName(): string[] {
    return ['Time', this.name];
  }
}

/**
 * Table type for a metric — the full flot-pair/stats reduction is preserved
 * verbatim from the legacy engine.
 */
export class TableMetric extends Metric {
  tableColumnOptions: any = {};
  tableColumn = '';
  allIsNull = true;
  allIsZero = true;

  constructor($gf: GFContext, dataList: any) {
    super($gf, dataList);
    this.type = 'table';
    this.init();
  }

  init() {
    this.metrics = this._tableHandler();
    this.name = this.dataList?.refId;
    super.init();
    return this;
  }

  private _tableHandler() {
    const table: any = {
      datapoints: [],
      columnNames: {},
      stats: {},
    };

    this.dataList?.columns.forEach((column: { text: { toString: () => string } }, columnIndex: string | number) => {
      table.columnNames[columnIndex] = column.text;
      if (column.text.toString().toLowerCase() === 'time') {
        table.timeIndex = columnIndex;
        table.timeColumn = column.text;
      }
    });

    this.tableColumnOptions = table.columnNames;
    if (!_find(this.dataList?.columns, ['text', this.tableColumn])) {
      this._setTableColumnToSensibleDefault();
    }

    this.dataList?.rows.forEach((row: any[]) => {
      const datapoint: any = {};
      row.forEach((value: any, columnIndex: string | number) => {
        const key = table.columnNames[columnIndex];
        datapoint[key] = value;
      });
      table.datapoints.push(datapoint);
    });
    table.flotpairs = this._getFlotPairs(this._nullPointMode, table);
    return table;
  }

  private _setTableColumnToSensibleDefault() {
    if (!this.dataList) {
      return;
    }
    if (this.dataList.columns.length === 1) {
      this.tableColumn = this.dataList.columns[0].text;
    } else {
      this.tableColumn = _find(this.dataList.columns, (col: any) => {
        return col.type !== 'time';
      }).text;
    }
  }

  private _getFlotPairs(fillStyle: string, table: any) {
    const result: any[] = [];
    const ignoreNulls = fillStyle === 'connected';
    const nullAsZero = fillStyle === 'null as zero';
    table.allIsNull = true;
    table.allIsZero = true;

    for (const idx in table.columnNames) {
      const currName = table.columnNames[idx];
      table.stats[currName] = {};
      table.stats[currName].name = currName;
      table.stats[currName].total = 0;
      table.stats[currName].max = -Number.MAX_VALUE;
      table.stats[currName].min = Number.MAX_VALUE;
      table.stats[currName].logmin = Number.MAX_VALUE;
      table.stats[currName].avg = null;
      table.stats[currName].current = null;
      table.stats[currName].current_notnull = null;
      table.stats[currName].first = null;
      table.stats[currName].first_notnull = null;
      table.stats[currName].delta = 0;
      table.stats[currName].diff = null;
      table.stats[currName].range = null;
      table.stats[currName].timeStep = Number.MAX_VALUE;

      let currentTime: any;
      let currentValue: any;
      let nonNulls = 0;
      let previousTime;
      let previousValue = 0;
      let previousDeltaUp = true;

      try {
        for (let i = 0; i < table.datapoints.length; i++) {
          if (table.timeColumn) {
            currentTime = table.datapoints[i][table.timeColumn];
          }
          currentValue = table.datapoints[i][currName];

          if (previousTime !== undefined) {
            const timeStep = currentTime - previousTime;
            if (timeStep < table.stats[currName].timeStep) {
              table.stats[currName].timeStep = timeStep;
            }
          }
          previousTime = currentTime;

          if (currentValue === null) {
            if (ignoreNulls) {
              continue;
            }
            if (nullAsZero) {
              currentValue = 0;
            }
          }

          if (currentValue !== null) {
            if (_isNumber(currentValue)) {
              table.stats[currName].total += currentValue;
              this.allIsNull = false;
              nonNulls++;
            }

            if (currentValue > table.stats[currName].max) {
              table.stats[currName].max = currentValue;
            }

            if (currentValue < table.stats[currName].min) {
              table.stats[currName].min = currentValue;
            }

            if (table.stats[currName].first === null) {
              table.stats[currName].first = currentValue;
            } else {
              if (previousValue > currentValue) {
                // counter reset
                previousDeltaUp = false;
                if (i === table.datapoints.length - 1) {
                  // reset on last
                  table.stats[currName].delta += currentValue;
                }
              } else {
                if (previousDeltaUp) {
                  table.stats[currName].delta += currentValue - previousValue; // normal increment
                } else {
                  table.stats[currName].delta += currentValue; // account for counter reset
                }
                previousDeltaUp = true;
              }
            }
            previousValue = currentValue;

            if (currentValue < table.stats[currName].logmin && currentValue > 0) {
              table.stats[currName].logmin = currentValue;
            }

            if (currentValue !== 0) {
              this.allIsZero = false;
            }
          }
          result.push([currentTime, currentValue]);
        }
      } catch (error) {
        GFLog.error('Unable to aggregate data', error);
      }

      if (currentTime) {
        table.stats[currName].last_time = currentTime;
      }

      if (table.stats[currName].max === -Number.MAX_VALUE) {
        table.stats[currName].max = null;
      }
      if (table.stats[currName].min === Number.MAX_VALUE) {
        table.stats[currName].min = null;
      }

      if (result.length && !this.allIsNull) {
        table.stats[currName].avg = table.stats[currName].total / nonNulls;
        table.stats[currName].current = result[result.length - 1][1];
        if (table.stats[currName].current === null && result.length > 1) {
          table.stats[currName].current = result[result.length - 2][1];
        }
      }
      if (table.stats[currName].max !== null && table.stats[currName].min !== null) {
        table.stats[currName].range = table.stats[currName].max - table.stats[currName].min;
      }
      if (table.stats[currName].current !== null && table.stats[currName].first !== null) {
        table.stats[currName].diff = table.stats[currName].current - table.stats[currName].first;
      }

      table.stats[currName].count = result.length;
    }
    return result;
  }

  getValue(aggregator: Aggregation, column = 'Value'): string | number | null {
    try {
      // Shared-crosshair hover branch (Req 4.10): resolve the hovered-timestamp
      // value for the requested column (nearest-not-after) instead of the
      // aggregation. Reset by `update(undefined)` on crosshair-clear.
      if (this._GHActive && this._GHTimestamp !== null) {
        return this.findValue(this._GHTimestamp, column);
      }
      const value: string | number | null = this.metrics.stats[column][aggregator];
      return value;
    } catch (error) {
      GFLog.error('datapoint for table is null', error);
      return null;
    }
  }

  /**
   * find a value by a timestamp — nearest-not-after binary search over the
   * table datapoints. Preserved verbatim (Req 4.10).
   */
  findValue(timestamp: number, column: string = this.tableColumn): string | number | null {
    let low = 0;
    let high = this.metrics.datapoints.length - 1;
    let found = !(high > 0 && this.metrics.datapoints[low][this.metrics.timeColumn] < timestamp);
    timestamp = Math.round(timestamp);
    let value = null;
    while (!found) {
      const middle = low + Math.round((high - low) / 2);
      if (this.metrics.datapoints[middle][this.metrics.timeColumn] === timestamp) {
        value = this.metrics.datapoints[middle][column];
        found = true;
      }
      if (!found && low < middle && middle < high) {
        if (timestamp > this.metrics.datapoints[middle][this.metrics.timeColumn]) {
          low = middle;
        }
        if (timestamp < this.metrics.datapoints[middle][this.metrics.timeColumn]) {
          high = middle;
        }
      } else {
        if (this.metrics.datapoints[middle][this.metrics.timeColumn] > timestamp && middle >= 1) {
          value = this.metrics.datapoints[middle - 1][column];
        } else {
          value = this.metrics.datapoints[middle][column];
        }
        found = true;
      }
    }
    return value;
  }

  getColumnIndex(column: string): number | null {
    for (const idx in this.tableColumnOptions) {
      if (column === this.tableColumnOptions[idx]) {
        return Number(idx);
      }
    }
    return null;
  }

  getColumnsName(): string[] {
    const result: string[] = [];
    for (const idx in this.tableColumnOptions) {
      result.push(this.tableColumnOptions[idx]);
    }
    return result;
  }

  getData(column: string): number[] | Array<{ x: number | Date; y: number }> {
    if (this.metrics.timeColumn) {
      return this.metrics.datapoints.map((d: { [x: string]: any }) => {
        return { x: d[this.metrics.timeColumn], y: d[column] };
      });
    }
    return this.metrics.datapoints.map((d: { [x: string]: any }) => d[column]);
  }
}
