/**
 * timeSeries — a framework-agnostic port of the classic Grafana `TimeSeries`
 * stats/flotpairs computation that the legacy `SerieMetric` reached through
 * `grafana_func.getTimeSeries(...)` (design.md: Req 3.7 removes `grafana_func`
 * from the Data_Pipeline).
 *
 * The legacy `metric_class.SerieMetric` built a Grafana `app/core/time_series2`
 * object from `{ datapoints, alias }` and then read `series.stats[...]` plus
 * `series.getFlotPairs(nullPointMode)`. That Grafana class is an Angular-era
 * internal that is not importable here, so this module reproduces exactly the
 * aggregation semantics the Logic_Layer depends on:
 *
 *   - `datapoints` are `[value, timestampMs]` pairs (Grafana flot order).
 *   - `stats` holds total/max/min/avg/current/first/delta/diff/range/count/...
 *     computed with the classic null-handling (`connected` ignores nulls).
 *   - `getFlotPairs(fillStyle)` returns `[timestampMs, value]` pairs.
 *
 * No Grafana/Angular/`$GF`/`globalThis` coupling — pure data in, pure data out.
 */

export type NullPointMode = 'connected' | 'null' | 'null as zero';

/** A single flot pair in Grafana input order: `[value, timestampMs]`. */
export type DataPoint = [number | null, number];

/** The classic stats bag computed over a series' datapoints. */
export interface SeriesStats {
  total: number;
  max: number | null;
  min: number | null;
  logmin: number;
  avg: number | null;
  current: number | null;
  first: number | null;
  delta: number;
  diff: number | null;
  range: number | null;
  timeStep: number;
  count: number;
  // Enriched by the metric layer (SerieMetric._addCustomStats):
  last_time?: number;
  current_notnull?: number | null;
  first_notnull?: number | null;
  [key: string]: number | null | undefined;
}

/**
 * The portable replacement for Grafana's `TimeSeries` object. It exposes the
 * same surface the legacy `SerieMetric` consumed: `alias`, `stats`, and
 * `getFlotPairs()` returning `[timestampMs, value]` pairs.
 */
export class PortableTimeSeries {
  alias: string;
  datapoints: DataPoint[];
  stats: SeriesStats;
  flotpairs: Array<[number, number | null]> = [];

  constructor(opts: { datapoints: DataPoint[]; alias: string }) {
    this.alias = opts.alias;
    this.datapoints = opts.datapoints ?? [];
    this.stats = PortableTimeSeries._emptyStats();
  }

  private static _emptyStats(): SeriesStats {
    return {
      total: 0,
      max: -Number.MAX_VALUE,
      min: Number.MAX_VALUE,
      logmin: Number.MAX_VALUE,
      avg: null,
      current: null,
      first: null,
      delta: 0,
      diff: null,
      range: null,
      timeStep: Number.MAX_VALUE,
      count: 0,
    };
  }

  /**
   * Compute the classic stats and return `[timestampMs, value]` flot pairs.
   * Mirrors Grafana's `TimeSeries.getFlotPairs(fillStyle)` aggregation logic
   * (the same algorithm the legacy table path reimplements in `metric_class`).
   */
  getFlotPairs(fillStyle: NullPointMode = 'connected'): Array<[number, number | null]> {
    const result: Array<[number, number | null]> = [];
    const stats = PortableTimeSeries._emptyStats();
    const ignoreNulls = fillStyle === 'connected';
    const nullAsZero = fillStyle === 'null as zero';

    let currentTime: number | undefined;
    let currentValue: number | null;
    let nonNulls = 0;
    let previousTime: number | undefined;
    let previousValue = 0;
    let previousDeltaUp = true;

    for (let i = 0; i < this.datapoints.length; i++) {
      currentValue = this.datapoints[i][0];
      currentTime = this.datapoints[i][1];

      if (previousTime !== undefined) {
        const timeStep = currentTime - previousTime;
        if (timeStep < stats.timeStep) {
          stats.timeStep = timeStep;
        }
      }
      previousTime = currentTime;

      if (currentValue === null) {
        if (ignoreNulls) {
          result.push([currentTime, currentValue]);
          continue;
        }
        if (nullAsZero) {
          currentValue = 0;
        }
      }

      if (currentValue !== null) {
        if (typeof currentValue === 'number') {
          stats.total += currentValue;
          nonNulls++;
        }

        if (currentValue > (stats.max as number)) {
          stats.max = currentValue;
        }
        if (currentValue < (stats.min as number)) {
          stats.min = currentValue;
        }

        if (stats.first === null) {
          stats.first = currentValue;
        } else {
          if (previousValue > currentValue) {
            // counter reset
            previousDeltaUp = false;
            if (i === this.datapoints.length - 1) {
              stats.delta += currentValue; // reset on last
            }
          } else {
            if (previousDeltaUp) {
              stats.delta += currentValue - previousValue; // normal increment
            } else {
              stats.delta += currentValue; // account for counter reset
            }
            previousDeltaUp = true;
          }
        }
        previousValue = currentValue;

        if (currentValue < stats.logmin && currentValue > 0) {
          stats.logmin = currentValue;
        }
      }
      result.push([currentTime, currentValue]);
    }

    if (currentTime !== undefined) {
      stats.last_time = currentTime;
    }

    if (stats.max === -Number.MAX_VALUE) {
      stats.max = null;
    }
    if (stats.min === Number.MAX_VALUE) {
      stats.min = null;
    }

    if (result.length) {
      if (nonNulls > 0) {
        stats.avg = stats.total / nonNulls;
      }
      stats.current = result[result.length - 1][1];
      if (stats.current === null && result.length > 1) {
        stats.current = result[result.length - 2][1];
      }
    }

    if (stats.max !== null && stats.min !== null) {
      stats.range = stats.max - stats.min;
    }
    if (stats.current !== null && stats.first !== null) {
      stats.diff = (stats.current as number) - stats.first;
    }

    stats.count = result.length;

    this.stats = stats;
    this.flotpairs = result;
    return result;
  }
}

/**
 * Factory mirroring the legacy `grafana.getTimeSeries(seriesData)` entry point
 * (`metric_class.SerieMetric._seriesHandler`). Returns a {@link PortableTimeSeries}
 * ready to have `getFlotPairs` called on it.
 */
export function getTimeSeries(seriesData: { datapoints?: DataPoint[]; target?: string }): PortableTimeSeries {
  return new PortableTimeSeries({
    datapoints: seriesData.datapoints ?? [],
    alias: seriesData.target ?? '',
  });
}
