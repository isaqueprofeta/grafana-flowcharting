/**
 * dataFrameAdapter — the Data_Pipeline (design.md: "Data_Pipeline
 * (dataFrameAdapter.ts)", Req 3.1-3.7).
 *
 * Consumes `PanelData` from `props.data` (Req 3.1) and reads series from
 * `props.data.series` as `DataFrame` values (Req 3.2), converting each frame
 * into the legacy `dataList` shape the ported `MetricHandler` / `SerieMetric` /
 * `TableMetric` consume **unchanged** (Req 3.3, 3.4):
 *
 *   - a single-value time series frame  -> `{ target, datapoints: [[v, ts]...] }`
 *     which `SerieMetric` turns into `stats`/`flotpairs` via the portable
 *     TimeSeries port (so current/min/max/avg/total match the legacy reference).
 *   - a multi-field / non-time frame     -> `{ type: 'table', columns, rows }`
 *     which `TableMetric` reduces per column.
 *
 * Aggregations current/min/max/avg/total (and the rest of
 * `GFCONSTANT.AGGREGATION_TYPES`) are produced by the metric classes from these
 * structures; `aggregate()` is a thin convenience over `Metric.getValue()`.
 *
 * Formatting moves off the removed `grafana_func` (Req 3.7) onto `@grafana/data`:
 *   - numeric display -> `getValueFormat(unit)(value, decimals)` (Req 3.5);
 *   - date display    -> `dateTime(value).format(fmt)`            (Req 3.6).
 *
 * `findValue(timestamp)` (nearest-not-after) is preserved on the metric classes
 * and surfaced here for the shared-crosshair path (Req 4.10).
 */
import {
  DataFrame,
  Field,
  FieldType,
  PanelData,
  dateTime,
  formattedValueToString,
  getValueFormat,
} from '@grafana/data';
import { MetricHandler } from '../logic/metricHandler';
import { Aggregation, ObjectMetric } from '../logic/metricClass';
import type { GFContext } from '../components/context/GFContext';

/** A series entry in the legacy `dataList` shape (`SerieMetric` input). */
export interface SerieDataListEntry {
  target: string;
  /** Flot order: `[value, timestampMs]`. */
  datapoints: Array<[number | null, number]>;
  type?: 'serie';
  refId?: string;
}

/** A table entry in the legacy `dataList` shape (`TableMetric` input). */
export interface TableDataListEntry {
  type: 'table';
  refId: string;
  columns: Array<{ text: string; type?: string }>;
  rows: any[][];
}

export type DataListEntry = SerieDataListEntry | TableDataListEntry;

/**
 * Determine whether a frame looks like a plain time series: exactly one time
 * field and exactly one numeric value field. Anything else is treated as a
 * table (matching the legacy serie/table split).
 */
function isTimeSeriesFrame(frame: DataFrame): boolean {
  const timeFields = frame.fields.filter((f) => f.type === FieldType.time);
  const numberFields = frame.fields.filter((f) => f.type === FieldType.number);
  return timeFields.length === 1 && numberFields.length === 1 && frame.fields.length <= 2;
}

/** Pick a display name for a frame's value field (legacy `target`/alias). */
function serieName(frame: DataFrame, valueField: Field): string {
  if (valueField.config?.displayName) {
    return valueField.config.displayName;
  }
  if (valueField.labels && Object.keys(valueField.labels).length > 0) {
    const labels = Object.entries(valueField.labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(', ');
    return `${frame.name ?? valueField.name}{${labels}}`;
  }
  return frame.name ?? valueField.name;
}

/** Convert a single time-series DataFrame into a serie `dataList` entry. */
function frameToSerie(frame: DataFrame): SerieDataListEntry {
  const timeField = frame.fields.find((f) => f.type === FieldType.time)!;
  const valueField = frame.fields.find((f) => f.type === FieldType.number)!;
  const datapoints: Array<[number | null, number]> = [];
  for (let i = 0; i < frame.length; i++) {
    const ts = Number(timeField.values[i]);
    const raw = valueField.values[i];
    const value = raw === null || raw === undefined ? null : Number(raw);
    datapoints.push([value, ts]);
  }
  return {
    target: serieName(frame, valueField),
    datapoints,
    type: 'serie',
    refId: frame.refId,
  };
}

/** Convert a DataFrame into a table `dataList` entry (column/row layout). */
function frameToTable(frame: DataFrame): TableDataListEntry {
  const columns = frame.fields.map((f) => ({
    text: f.config?.displayName ?? f.name,
    type: f.type === FieldType.time ? 'time' : f.type,
  }));
  const rows: any[][] = [];
  for (let i = 0; i < frame.length; i++) {
    rows.push(frame.fields.map((f) => f.values[i]));
  }
  return {
    type: 'table',
    refId: frame.refId ?? frame.name ?? '',
    columns,
    rows,
  };
}

/**
 * Convert `props.data.series` (DataFrame values) into the legacy `dataList`
 * array consumed by `MetricHandler`. Series-shaped frames become serie entries;
 * everything else becomes a table entry (Req 3.1, 3.2).
 */
export function dataFramesToDataList(data: Pick<PanelData, 'series'>): DataListEntry[] {
  const series = data.series ?? [];
  return series.map((frame) => (isTimeSeriesFrame(frame) ? frameToSerie(frame) : frameToTable(frame)));
}

/**
 * Adapt `PanelData` into a populated `MetricHandler`. The handler's metrics hold
 * the `stats`/`flotpairs` structures the Logic_Layer evaluates against; this is
 * the main entry point the panel's data effect calls (design.md data effect).
 *
 * @param data the panel data (`props.data`).
 * @param gf   the Context_Seam (supplies the preserved event bus).
 * @returns a `MetricHandler` whose `dataList` has been converted and `change()`d.
 */
export function adaptDataFrames(data: Pick<PanelData, 'series'>, gf: GFContext): MetricHandler {
  const handler = new MetricHandler(gf);
  handler.setDataList(dataFramesToDataList(data));
  handler.change();
  return handler;
}

/**
 * Convenience aggregation accessor over a metric — returns current/min/max/avg/
 * total (and any other `GFCONSTANT.AGGREGATION_TYPES` key) for the given column.
 * Thin wrapper over `Metric.getValue()` so callers need not know the metric
 * subtype (Req 3.3).
 */
export function aggregate(
  metric: ObjectMetric,
  aggregator: Aggregation,
  column?: string
): string | number | null {
  return metric.getValue(aggregator, column);
}

/**
 * Nearest-not-after lookup for the shared-crosshair path (Req 4.10). Delegates
 * to the preserved `Metric.findValue(timestamp)` binary search.
 */
export function findValueAt(
  metric: ObjectMetric,
  timestamp: number,
  column?: string
): string | number | null {
  return metric.findValue(timestamp, column as string);
}

/**
 * Format a numeric metric value using `@grafana/data` `getValueFormat` (Req 3.5),
 * replacing the legacy `grafana_func.formatValue` (`kbn.valueFormats`).
 *
 * @param value    the raw value.
 * @param unit     a Grafana unit id (e.g. `percent`, `bytes`); empty for none.
 * @param decimals decimal places to render.
 * @returns the formatted string (prefix + text + suffix), or `''` for null.
 */
export function formatValue(value: number | null, unit?: string, decimals?: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '';
  }
  const formatter = getValueFormat(unit && unit.length > 0 ? unit : undefined);
  return formattedValueToString(formatter(value, decimals ?? undefined));
}

/**
 * Format a date value using `@grafana/data` `dateTime` (Req 3.6), replacing the
 * legacy `grafana_func.getFormatedDate`. `fmt` is one of the
 * `GFCONSTANT.VALUE_DATEFORMAT_TYPES` moment-style patterns.
 *
 * @param value an epoch-ms number or a date-parseable string.
 * @param fmt   a moment/dayjs format string.
 * @returns the formatted date string, or `''` for null.
 */
export function formatDate(value: number | string | null, fmt: string): string {
  if (value === null || value === undefined) {
    return '';
  }
  return dateTime(value).format(fmt);
}
