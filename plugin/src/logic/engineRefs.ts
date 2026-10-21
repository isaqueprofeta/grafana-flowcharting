/**
 * engineRefs — the typed boundary between the rules engine (logic/) and the
 * engine/data classes it references.
 *
 * Task 6.1 ported the rules/thresholds/mappings logic with "import swaps only",
 * standing on forward-declared structural interfaces so it compiled before the
 * `XCell`/`State`/`ObjectMetric` modules existed (design.md dependency graph:
 * `XCell`/`State` in Task 7, `metric_class` in Task 5).
 *
 * Now that the real modules exist, this file is reconciled per Task 7.2:
 *   - `State`        -> the concrete state class (engine/state). State is a new
 *                       Task-7 module consumed by the rules layer only as a
 *                       **type** (`Map<string, State>`, `MatchState(state)`),
 *                       so wiring it to the concrete class costs nothing and
 *                       gives the rules layer the real shape.
 *   - `XCell` / `ObjectMetric` -> **kept as the structural `*Like` contracts**.
 *                       The rules layer (rule.ts, mapping.ts) was authored
 *                       against the legacy loose shapes (`getDefaultValues(): any`,
 *                       `getValue(aggregator: string)`), and the concrete engine
 *                       `XCell` / metric union are *stricter* (`unknown` returns,
 *                       narrowed `Aggregation` params). Aliasing those to the
 *                       concrete types would tighten the rules layer and break
 *                       its existing call sites — which Task 7.2 explicitly
 *                       forbids ("without breaking the rules layer"). The real
 *                       engine classes satisfy these `*Like` contracts
 *                       structurally, and `engine/state`, `engine/statesHandler`
 *                       and `logic/flowchart` import the concrete `XCell`/`XGraph`
 *                       directly from `engine/XGraph` where they need the full API.
 *
 * The `State` re-export is **type-only** (`import type`), so there is no runtime
 * import cycle even though `engine/state` imports `Rule` from logic at runtime:
 * the type edge is erased by the compiler. No `$GF`, Angular, or `mx*` coupling.
 */
import type { TRuleMapOptions } from './legacyTypes';
import type { State as EngineState } from '../engine/state';

/** The metric contract the Rule reads (SerieMetric | TableMetric, Task 5). */
export interface ObjectMetricLike {
  uid: string;
  type: 'serie' | 'table' | 'unknown';
  getName(): string;
  getValue(aggregator: string, column?: string): string | number | null;
}
/**
 * The metric contract the rules layer depends on. Kept structural so the loose
 * legacy call sites keep compiling; the concrete `SerieMetric | TableMetric`
 * satisfy this shape.
 */
export type ObjectMetric = ObjectMetricLike;

/**
 * The cell contract the maps read for identifier extraction (XCell, Task 7).
 * `getDefaultValues` returns `any` to preserve the legacy `cell_class` contract
 * (a string for id/value, or an array for metadata); the matchers forward the
 * value unchanged exactly as the legacy engine did.
 */
export interface XCellLike {
  getDefaultValues(options: TRuleMapOptions): any;
}
/**
 * The cell contract the rules layer depends on. Kept structural (see file
 * header); the concrete engine `XCell` satisfies this shape.
 */
export type XCell = XCellLike;

/** The state contract the Rule drives for highlight (State, Task 7). */
export interface StateLike {
  getXCell(): XCellLike;
  highlightCell(): void;
  unhighlightCell(): void;
}
/** Concrete state class — satisfies {@link StateLike}. */
export type State = EngineState;

/**
 * The tooltip handler contract the State/XCell drive (TooltipHandler, Task 11).
 * Only the members the ported `state_class` calls are declared; the concrete
 * `TooltipHandler` (ported with sparkline support in Task 11) satisfies this
 * shape and the forward-declared import is swapped for the real one with no
 * change to the state-application algorithm.
 */
export interface TooltipHandlerLike {
  isChecked(): boolean;
  destroy(): void;
  updateDate(): void;
  addMetric(): TooltipMetricLike;
  addMetadata(): { setXCell(xcell: XCellLike): unknown };
}

/** The per-metric tooltip row builder (fluent, ported from `tooltipHandler`). */
export interface TooltipMetricLike {
  setLabel(label: string): TooltipMetricLike;
  setValue(value: string): TooltipMetricLike;
  setColor(color: string | null): TooltipMetricLike;
  setDirection(direction: string): TooltipMetricLike;
  addGraph(type: string): TooltipGraphLike;
}

/** The sparkline builder on a tooltip metric row. */
export interface TooltipGraphLike {
  setColor(color: string | null): TooltipGraphLike;
  setColumn(column: string): TooltipGraphLike;
  setMetric(metric: ObjectMetricLike): TooltipGraphLike;
  setSize(size: string): TooltipGraphLike;
  setScaling(low: number | null, high: number | null): TooltipGraphLike;
  setScale(scale: string): TooltipGraphLike;
}
export type TooltipHandler = TooltipHandlerLike;
