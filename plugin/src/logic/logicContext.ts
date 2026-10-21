/**
 * logicContext — the contract the preserved Logic_Layer consumes in place of
 * the legacy Angular-coupled `$GF` object (design.md: Context_Seam, Req 8.3,
 * 8.4).
 *
 * The React {@link GFContext} (components/context/GFContext.tsx) is the concrete
 * seam the panel builds; it already carries the Grafana services (`interpolate`,
 * `notify`, `events`, `getTimeRange`, `theme`, `eventBus`, ...). The ported
 * handlers/domain classes additionally reach a few *logic-internal* members on
 * the old `$gf` — the live handler cross-references and the mapping/focus/vars
 * helpers. Those are declared here as `LogicContext`, which extends `GFContext`,
 * so the engine depends only on this typed boundary and never on `$GF`,
 * `$scope`, Angular, `globalThis`, or `mx*`.
 *
 * Members that reference handlers ported in later waves (MetricHandler, Task 5;
 * RulesHandler, this wave) are typed against forward-declared structural
 * interfaces so Task 6.1 compiles standalone; the concrete handler types slot
 * in unchanged when those modules land.
 */
import type { GFContext } from '../components/context/GFContext';
import type { GFEvents } from './flowchartingBase';

/** Signals emitted by a {@link MetricHandlerLike}. Ported in Task 5. */
export type MetricHandlerSignals = 'metric_created' | 'metric_updated' | 'metric_deleted';

/**
 * The subset of the (later-ported) MetricHandler the rules engine reads:
 * metric-type predicates plus the `metric_created`/`metric_deleted` bus the
 * Rule connects to. Replaced by the concrete `MetricHandler` in Task 5.
 */
export interface MetricHandlerLike {
  events: GFEvents<MetricHandlerSignals>;
  isMultipleType(): boolean;
  isTypeOf(type: 'serie' | 'table'): boolean;
}

/** Signals emitted by a {@link RulesHandlerLike}. */
export type RulesHandlerSignals = 'rule_created' | 'rule_updated' | 'rule_changed' | 'rule_deleted';

/**
 * The subset of the RulesHandler the engine reads: the `getRule` name-collision
 * check the Rule uses, plus the `rule_*` bus the State connects to so it can
 * react to rule lifecycle changes (ported `state_class` wiring). Satisfied by
 * the concrete `RulesHandler` (logic/rulesHandler).
 */
export interface RulesHandlerLike {
  events: GFEvents<RulesHandlerSignals>;
  getRule(value: number | string): RuleLike | null;
  /**
   * The current rule set. A freshly created State reads this to ingest rules
   * that were created before it existed (the FlowchartHandler builds rules
   * before flowcharts/states), keeping state creation order-independent of
   * rule creation.
   */
  getRules(): RuleLike[];
}

/** Minimal Rule shape referenced across handler boundaries. */
export interface RuleLike {
  name: string;
}

/**
 * The logic-layer seam: everything the ported engine needs, funneled through
 * one typed object. It is `GFContext` (the React seam) plus the handler
 * cross-references and the mapping/focus/vars helpers the legacy `$gf` exposed.
 */
export interface LogicContext extends GFContext {
  /** Live MetricHandler (set by the data pipeline, Task 5). */
  metricHandler?: MetricHandlerLike;
  /** Live RulesHandler (set when the handler is constructed). */
  rulesHandler?: RulesHandlerLike;
  /**
   * Live FlowchartHandler (set when the orchestrator is constructed, Task 8.2).
   * Typed loosely to avoid a circular type dependency between the seam and the
   * orchestrator; the concrete `FlowchartHandler` satisfies it structurally.
   */
  flowchartHandler?: unknown;

  /**
   * Register the active map-pattern callback(s) when entering mapping mode.
   * Replaces `$GF.setMappingCallBack`; the React editor wires the concrete
   * implementation (Task 10). A no-op default keeps the engine decoupled.
   */
  setMappingCallBack(callback: CallableFunction | CallableFunction[]): void;

  /**
   * All available variable names (local rule vars + Grafana template vars).
   * Replaces `$GF.getFullAvailableVarNames`.
   */
  getFullAvailableVarNames(): string[];

  /** Move focus to a DOM id. Replaces `$GF.setFocus` (editor-only convenience). */
  setFocus(id: string): void;
}
