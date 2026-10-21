/**
 * flowchartHandler — the FlowchartHandler orchestrator, ported **with import
 * swaps only** from the legacy `src/flowchart_handler.ts` (design.md:
 * Logic_Layer, "flowchart_class / FlowchartHandler: import swaps — owns XGraph,
 * now constructed from GFContext + container ref instead of `ctrl`", Req 4.5,
 * 4.7; Task 8.2).
 *
 * The handler orchestrates the full render pipeline for the MVP (Req 7.8):
 *   - owns the set of {@link Flowchart} instances (render engine + states),
 *   - owns one {@link RulesHandler} (rules/thresholds/mappings) built from the
 *     clean Options_Schema `RuleOptions[]`,
 *   - owns one {@link MetricHandler} (DataFrame-fed metrics),
 * and wires rule evaluation to metrics so the per-cell states recolor from live
 * data end to end:
 *
 *     data_updated (panel)  -> MetricHandler.setDataList + change()
 *                           -> metric_created (Rules bind matching metrics)
 *                           -> data_processed (States re-run their apply cycle)
 *                           -> cell recolor
 *
 * Multi-flowchart navigation (Req 4.7) is exposed through a clean, bounded API
 * (`getCurrentFlowchart`/`setCurrentFlowchart`/`nextFlowchart`/
 * `previousFlowchart`/`getFlowchartCount`/`getCurrentIndex`) — the subject of
 * Property 7 (Task 8.3). `next`/`previous` are clamped to `[0, N-1]`.
 *
 * Import swaps performed against the legacy source (no algorithm change to the
 * navigation/flowchart bookkeeping):
 *   - `$GF` / `$gf: $GF`              -> `gf: LogicContext`   (Context_Seam)
 *   - `$GF.genUid`                    -> `genUid`             (logic/globals)
 *   - `$GF.notify` / `clearNotify`    -> `gf.notify` / `gf.clearNotify`, which
 *                                        drive the `@grafana/ui` Alert (Req 7.9)
 *   - `GFMessage`                     -> routed through `gf.notify` (Req 7.9)
 *   - `this.$gf.ctrl.flowchartsDiv`   -> a container ref passed to `create(...)`
 *   - `gf.TFlowchartHandlerData`      -> `FlowchartingOptions` (types/options)
 *   - `gf.TFlowchartData`             -> `FlowchartOptions`    (types/options)
 *   - legacy `document.body.onmouse*` throttling, Angular `ctrl` render hooks,
 *     and the draw.io `openDrawEditor`/`listenMessage` popup are *not* part of
 *     the render-only MVP and land with the draw.io integration (Task 12); they
 *     are omitted here to avoid orphaned code / global side-effects.
 *
 * No `$GF`, `$scope`, Angular, `grafana/app`, `globalThis`, or `mx*` global
 * mutation.
 */
import { Flowchart } from './flowchart';
import { RulesHandler } from './rulesHandler';
import { MetricHandler } from './metricHandler';
import { GFLog, genUid } from './globals';
import { GFEvents } from './flowchartingBase';
import { ruleOptionsToLegacyData } from './ruleOptionsAdapter';
import type { LogicContext } from './logicContext';
import type { FlowchartingOptions, FlowchartOptions } from '../types/options';
import type { TIRulesHandlerData } from './legacyTypes';

// Debug
const DEBUG = false;
const _log = (...args: any) => {
  DEBUG && console.log(...args);
};

// Define signals
const flowchartHandlerSignalsArray = ['flowchart_created', 'flowchart_deleted'] as const;
type FlowchartHandlerSignals = typeof flowchartHandlerSignalsArray[number];

/**
 * FlowchartHandler — orchestrates flowcharts, rules, and metrics for the panel.
 *
 * @export
 * @class FlowchartHandler
 */
export class FlowchartHandler {
  private readonly gf: LogicContext;
  private readonly parentDiv: HTMLDivElement;
  flowcharts: Flowchart[] = [];
  /** Per-flowchart container the render engine draws into (parallel to {@link flowcharts}). */
  private containers: HTMLDivElement[] = [];
  currentFlowchartName = 'Main';
  currentFlowchart: Flowchart | undefined;
  rulesHandler: RulesHandler;
  metricHandler: MetricHandler;
  options: FlowchartingOptions;
  uid: string;
  sequenceNumber = 0;
  events: GFEvents<FlowchartHandlerSignals> = GFEvents.create(flowchartHandlerSignalsArray);

  private constructor(gf: LogicContext, parentDiv: HTMLDivElement, options: FlowchartingOptions) {
    this.gf = gf;
    this.gf.flowchartHandler = this;
    this.uid = genUid(this.constructor.name);
    this.parentDiv = parentDiv;
    this.options = options;
    this.currentFlowchartName = 'Main';

    // Metrics first: the owned MetricHandler listens on the global
    // `data_updated` bus, so emitting a new dataList refreshes metrics without
    // re-wiring. Set the cross-reference before building rules so each Rule's
    // `metric_created`/`metric_deleted` connections resolve (rule_class
    // `_eventsConnect` reads `gf.metricHandler`).
    this.metricHandler = new MetricHandler(gf);
    this.gf.metricHandler = this.metricHandler;

    // Rules next: the RulesHandler sets `gf.rulesHandler = this` in its ctor so
    // each per-cell State can subscribe to rule lifecycle events.
    this.rulesHandler = new RulesHandler(gf, RulesHandler.getDefaultData());
    this.applyRules(options.rules);

    // Flowcharts last: states are created per cell and immediately subscribe to
    // the now-populated rules/metrics handlers.
    this.init();
    this.applyFlowcharts(options.flowcharts);
  }

  /**
   * Factory mirroring the design sketch `FlowchartHandler.create(...)`. The
   * panel passes the maxGraph render container (held through a ref) and the
   * current options; the handler builds the metric/rules/flowchart graph.
   */
  static create(gf: LogicContext, parentDiv: HTMLDivElement, options: FlowchartingOptions): FlowchartHandler {
    return new FlowchartHandler(gf, parentDiv, options);
  }

  //############################################################################
  //### INIT/UPDATE/CHANGE/FREE/CLEAR
  //############################################################################
  init(): this {
    this.gf.events.connect('debug_asked', this, this._on_global_debug_asked.bind(this));
    this.gf.events.connect('panel_closed', this, this._on_global_panel_closed.bind(this));
    return this;
  }

  /** Re-render every flowchart from the current metrics/options (data/options effect). */
  update(): this {
    this.flowcharts.forEach((f) => f.update());
    return this;
  }

  /** Refresh metric values at an optional timestamp, then refresh states (time/crosshair effect). */
  refreshMetrics(timestamp?: number): this {
    this.metricHandler.refreshMetrics(timestamp);
    this.refreshStates();
    return this;
  }

  /** Re-run each flowchart's state application (recolor from current metrics). */
  refreshStates(): this {
    this.flowcharts.forEach((f) => f.getStateHandler()?.update());
    return this;
  }

  /** Resize the current flowchart's render engine (size effect, Req 7.4). */
  resize(width: number, height: number): this {
    void width;
    void height;
    // The maxGraph containers fill the panel via CSS (100%/100%); re-applying
    // the display options (scale/center/zoom) keeps the diagram in view after a
    // dimension change.
    this.flowcharts.forEach((f) => f.update_graph());
    return this;
  }

  free(): void {
    this.flowcharts.forEach((f) => f.free());
    this.rulesHandler.free();
    this.metricHandler.free();
    this.gf.events.disconnect('debug_asked', this);
    this.gf.events.disconnect('panel_closed', this);
    this.gf.flowchartHandler = undefined;
    this.gf.rulesHandler = undefined;
    this.gf.metricHandler = undefined;
    this.clear();
    this.events.clear();
  }

  clear(): this {
    this.flowcharts.forEach((fc: Flowchart) => fc.clear());
    this.flowcharts = [];
    this.containers.forEach((c) => c.parentElement?.removeChild(c));
    this.containers = [];
    return this;
  }

  //############################################################################
  //### OPTIONS -> ENGINE
  //############################################################################
  /**
   * Apply a new set of options (options effect, Req 7.6). Rebuilds the rules
   * from the clean `RuleOptions[]` and the flowcharts from `FlowchartOptions[]`,
   * then refreshes states so the new configuration colors the diagram.
   */
  applyOptions(options: FlowchartingOptions): this {
    this.options = options;
    this.applyRules(options.rules);
    this.applyFlowcharts(options.flowcharts);
    this.update();
    return this;
  }

  /**
   * Convert `props.options.rules` (clean `RuleOptions[]`) into the RulesHandler's
   * rules (legacy `TIRuleData`), so the data-driven coloring works end to end.
   * Rebuilds the rule set from scratch on each call — cheap for the MVP and
   * avoids diffing the authored order against the live rules.
   */
  applyRules(rules: FlowchartingOptions['rules']): this {
    this.rulesHandler.clear();
    const authored = rules ?? [];
    authored.forEach((ruleOptions) => {
      // Feed the converted legacy shape as `oldData` to the Rule's `_convert`,
      // reusing the preserved migration path (thresholds/maps/tooltip) verbatim.
      const legacy = ruleOptionsToLegacyData(ruleOptions);
      const rule = this.rulesHandler.addRule(ruleOptions.pattern ?? '', legacy);
      this.rulesHandler.events.emit('rule_created', rule);
    });
    return this;
  }

  /**
   * Build/rebuild the flowcharts from `FlowchartOptions[]`. The first flowchart
   * is named `Main` (legacy contract); each gets its own absolutely-positioned
   * container appended to the panel's render div so navigation can show/hide
   * them independently.
   */
  applyFlowcharts(flowcharts: FlowchartOptions[] | undefined): this {
    // Rebuild from scratch: free existing flowcharts/containers, then recreate.
    this.flowcharts.forEach((f) => f.free());
    this.flowcharts = [];
    this.containers.forEach((c) => c.parentElement?.removeChild(c));
    this.containers = [];

    const fcData = flowcharts ?? [];
    fcData.forEach((data, index) => {
      const name = index === 0 ? 'Main' : data.name || this.getFlowchartTmpName();
      const container = this.createContainer();
      const flowchart = new Flowchart(this.gf, name, container, data);
      this.flowcharts.push(flowchart);
      this.containers.push(container);
      this.events.emit('flowchart_created', flowchart);
    });

    // Select the first flowchart as current and bring it to front.
    if (this.flowcharts.length > 0) {
      this.setCurrentFlowchart(0);
    } else {
      this.currentFlowchart = undefined;
    }
    return this;
  }

  /**
   * Create an absolutely-positioned container filling the panel div for one
   * flowchart's render engine. Ported from the legacy `createContainer()`.
   */
  private createContainer(): HTMLDivElement {
    const div = document.createElement('div');
    div.style.margin = 'auto';
    div.style.position = 'absolute';
    div.style.width = '100%';
    div.style.height = '100%';
    div.style.touchAction = 'none';
    div.style.border = 'none';
    div.style.cursor = 'default';
    div.style.right = '0px';
    div.style.left = '0px';
    div.style.bottom = '0px';
    div.style.top = '0px';
    this.parentDiv.appendChild(div);
    return div;
  }

  //############################################################################
  //### NAVIGATION (Req 4.7 — subject of Property 7, Task 8.3)
  //############################################################################
  /**
   * Number of flowcharts currently managed.
   */
  getFlowchartCount(): number {
    return this.flowcharts.length;
  }

  /**
   * Index of the current flowchart, or 0 when none is current.
   */
  getCurrentIndex(): number {
    if (this.currentFlowchart) {
      const index = this.flowcharts.indexOf(this.currentFlowchart);
      return index >= 0 ? index : 0;
    }
    return 0;
  }

  /**
   * The current flowchart, or `undefined` when no flowcharts are configured.
   */
  getCurrentFlowchart(): Flowchart | undefined {
    return this.currentFlowchart;
  }

  /** Name of the current flowchart (`Main` when none is current). */
  getCurrentFlowchartName(): string {
    return this.currentFlowchart !== undefined ? this.currentFlowchart.name : 'Main';
  }

  /**
   * Return a flowchart by name, by index, or the current one when no selector
   * is given. Ported from the legacy `getFlowchart()`.
   */
  getFlowchart(flowchart?: string | number): Flowchart | undefined {
    if (typeof flowchart === 'string') {
      return this.flowcharts.find((fc) => fc.name === flowchart);
    }
    if (typeof flowchart === 'number') {
      return this.flowcharts[flowchart];
    }
    return this.currentFlowchart ?? this.flowcharts[0];
  }

  /**
   * Set the current flowchart by index (clamped to `[0, N-1]`) or by name. The
   * previous current is sent to the back and the new one brought to the front,
   * so only the selected diagram is visible (multi-flowchart navigation, Req 4.7).
   */
  setCurrentFlowchart(selector: number | string): Flowchart | undefined {
    if (this.flowcharts.length === 0) {
      this.currentFlowchart = undefined;
      return undefined;
    }
    let target: Flowchart | undefined;
    if (typeof selector === 'number') {
      const index = this._clampIndex(selector);
      target = this.flowcharts[index];
    } else {
      target = this.getFlowchart(selector);
    }
    if (target === undefined) {
      return this.currentFlowchart;
    }
    if (this.currentFlowchart && this.currentFlowchart !== target) {
      this.currentFlowchart.toBack();
    }
    this.currentFlowchart = target;
    this.currentFlowchartName = target.name;
    target.toFront();
    return target;
  }

  /**
   * Advance to the next flowchart, bounded to the last index (no wrap-around).
   * A no-op when already at the last flowchart (Req 4.7 / Property 7).
   */
  nextFlowchart(): Flowchart | undefined {
    const index = this.getCurrentIndex();
    const next = this._clampIndex(index + 1);
    return this.setCurrentFlowchart(next);
  }

  /**
   * Step to the previous flowchart, bounded to index 0 (no wrap-around). A
   * no-op when already at the first flowchart (Req 4.7 / Property 7).
   */
  previousFlowchart(): Flowchart | undefined {
    const index = this.getCurrentIndex();
    const previous = this._clampIndex(index - 1);
    return this.setCurrentFlowchart(previous);
  }

  isCurrentFirst(): boolean {
    return this.getCurrentIndex() === 0;
  }

  isCurrentLast(): boolean {
    return this.getCurrentIndex() === this.flowcharts.length - 1;
  }

  isMultiFlowcharts(): boolean {
    return this.flowcharts.length > 1;
  }

  getFlowchartNames(): string[] {
    return this.flowcharts.map((f) => f.name);
  }

  getFlowcharts(): Flowchart[] {
    return this.flowcharts;
  }

  /** Clamp an index to the valid `[0, N-1]` range (empty list clamps to 0). */
  private _clampIndex(index: number): number {
    const last = this.flowcharts.length - 1;
    if (last < 0) {
      return 0;
    }
    if (index < 0) {
      return 0;
    }
    if (index > last) {
      return last;
    }
    return index;
  }

  private getFlowchartTmpName(): string {
    if (this.sequenceNumber === 0) {
      this.sequenceNumber = this.flowcharts.length;
    }
    return `Flowchart-${this.sequenceNumber++}`;
  }

  //###########################################################################
  //### EVENTS
  //###########################################################################
  private _on_global_debug_asked() {
    _log('📬', this.constructor.name, '_on_global_debug_asked');
    _log('🧰', this.constructor.name, this);
    GFLog.debug(`${this.constructor.name} debug`, this);
  }

  private _on_global_panel_closed() {
    _log('📬', this.constructor.name, '_on_global_panel_closed');
    this.free();
  }
}

/** The default RulesHandler data shape, re-exported for callers that need it. */
export type { TIRulesHandlerData };
