/**
 * state — the per-cell State and its GFState sub-states, ported **with import
 * swaps only** from the legacy `src/state_class.ts` (design.md: Logic_Layer,
 * "state_class / StatesHandler: import swaps — references XCell/engine,
 * otherwise portable", Req 4.5).
 *
 * This module lives under `engine/` because state application is the point
 * where a rule result is pushed onto a maxGraph {@link XCell} (recolor / text /
 * style / animation / icon). The level-selection, highest-value accumulation,
 * match/apply cycle, and sub-state reset/prepare/apply bookkeeping are all
 * preserved verbatim. Only the imports are swapped:
 *   - `$GF` / `$gf: $GF`        -> `gf: LogicContext`            (Context_Seam)
 *   - `$GF.genUid`              -> `genUid`                      (logic/globals)
 *   - `$GF.getCurrentDate`      -> `getCurrentDate`              (logic/globals)
 *   - `GFVariables` (Angular)   -> ported `GFVariables`          (logic/globals,
 *                                  interpolation via `gf.interpolate`, no `eval`)
 *   - `XGraph` / `XCell`        -> engine/XGraph (maxGraph-backed)
 *   - `mxCell`                  -> `Cell`                        (@maxgraph/core)
 *   - `Rule`                    -> logic/rule
 *   - `EventMap`                -> logic/mapping
 *   - `TooltipHandler` / `ObjectMetric` -> logic/engineRefs (TooltipHandler is a
 *                                  forward-decl until Task 11; ObjectMetric is
 *                                  the concrete metric union)
 *   - `gf.*` key types          -> exported interfaces from logic/legacyTypes
 *
 * No `$GF`, `$scope`, Angular, `grafana/app`, `globalThis`, or `mx*` global
 * mutation.
 */
import { XGraph, XCell } from './XGraph';
import { TooltipHandler as TooltipHandlerImpl } from './tooltipHandler';
import { Rule } from '../logic/rule';
import { EventMap } from '../logic/mapping';
import { GFCONSTANT, GFLog, GFVariables, genUid, getCurrentDate } from '../logic/globals';
import { GFEvents } from '../logic/flowchartingBase';
import type { LogicContext } from '../logic/logicContext';
import type { ObjectMetric, TooltipHandler } from '../logic/engineRefs';
import type { TStyleColorKeys, TTypeEventKeys } from '../logic/legacyTypes';

const stateSignalsArray = ['state_initialized', 'state_updated', 'state_freed'] as const;
type StateSignals = typeof stateSignalsArray[number];

const DEBUG = false;
const _log = (...args: any) => {
  DEBUG && console.log(...args);
};

/**
 * State of one cell — accumulates the rules that match the cell, applies the
 * highest-level styling/text/link/event/tooltip/icon result, and restores the
 * defaults when rules no longer match.
 *
 * @export
 * @class State
 */
export class State {
  private readonly gf: LogicContext;
  xcell: XCell;
  uid: string;
  changed = false;
  matched = false;
  shapeState: ShapeState;
  tooltipState: TooltipState;
  iconState: IconState;
  eventState: EventState;
  textState: TextState;
  linkState: LinkState;
  private _variables: GFVariables;
  private _status: Map<string, any>;
  private _ObjStates: [ShapeState, TooltipState, IconState, EventState, TextState, LinkState];
  globalLevel = -1;
  highestFormattedValue = '';
  highestValue: any = undefined;
  tooltipHandler: TooltipHandler | null = null;
  reduce = true;
  private _rules: Map<string, Rule> = new Map();
  currRules: string[] = [];
  currMetrics: string[] = [];
  /** Serializes concurrent `update()` calls so each init->set->apply is atomic. */
  private _updateChain: Promise<void> = Promise.resolve();
  events: GFEvents<StateSignals> = GFEvents.create(stateSignalsArray);

  constructor(gf: LogicContext, xcell: XCell, xgraph: XGraph) {
    this.gf = gf;
    this.uid = genUid(this.constructor.name);
    this.xcell = xcell;
    this.shapeState = new ShapeState(xgraph, xcell);
    this.tooltipState = new TooltipState(xgraph, xcell);
    this.iconState = new IconState(xgraph, xcell);
    this.eventState = new EventState(xgraph, xcell);
    this.textState = new TextState(xgraph, xcell);
    this.linkState = new LinkState(xgraph, xcell);
    this._ObjStates = [
      this.shapeState,
      this.tooltipState,
      this.iconState,
      this.eventState,
      this.textState,
      this.linkState,
    ];
    // Local variables resolve Grafana template vars through the Context_Seam.
    this._variables = GFVariables.create((text: string) => this.gf.interpolate(text));
    this._status = new Map();
    this.tooltipHandler = null;
    this.init();
  }

  //############################################################################
  //### INIT/UPDATE/CHANGE/FREE/CLEAR
  //############################################################################
  init() {
    this._initCycle();
    this.gf.events.connect('data_updated', this, this._on_global_data_received.bind(this));
    this.gf.events.connect('data_processed', this, this._on_global_data_processed.bind(this));
    this.gf.rulesHandler?.events.connect('rule_changed', this, this._on_ruleHandler_rule_changed.bind(this));
    this.gf.rulesHandler?.events.connect('rule_updated', this, this._on_ruleHandler_rule_updated.bind(this));
    this.gf.rulesHandler?.events.connect('rule_created', this, this._on_ruleHandler_rule_created.bind(this));
    this.gf.rulesHandler?.events.connect('rule_deleted', this, this._on_ruleHandler_rule_deleted.bind(this));
    // Ingest rules that already exist when this state is created. Rules are
    // built (and their `rule_created` events emitted) in the FlowchartHandler
    // ctor *before* the flowcharts — and thus the per-cell states — exist, so a
    // freshly created state would otherwise never learn about the current rule
    // set and its `_rules` map would stay empty (no recolor on the periodic
    // `update()` path). Binding the existing rules here makes state creation
    // order-independent of rule creation.
    this.gf.rulesHandler?.getRules().forEach((rule) => this._updateRule(rule as unknown as Rule));
    this.events.emit('state_initialized', this);
    return this;
  }

  async update() {
    // Serialize concurrent updates. `update()` is driven by several sources
    // (the `data_processed` bus event fans out to every state, the panel's
    // data/options/time effects, and rule lifecycle events), so without a lock
    // the `await` points in `_initCycle`/`_setCycle` let a second update's
    // `_initCycle` reset `matched`/the sub-state keys *between* this update's
    // `_setCycle` (which computed the color) and its `_applyCycle` (which
    // commits it) — the recolor is then silently dropped. Chaining updates on a
    // single promise keeps each init -> set -> apply cycle atomic.
    this._updateChain = this._updateChain.then(() => this._runUpdate());
    return this._updateChain;
  }

  private async _runUpdate() {
    await this._initCycle();
    await this._setCycle();
    await this._applyCycle();
    this.events.emit('state_updated', this);
    return;
  }

  change() {
    return this;
  }

  clear(): this {
    this.currMetrics = [];
    this.currRules = [];
    return this;
  }

  async free() {
    this.clear();
    this.reset();
    this.gf.events.disconnect('data_updated', this);
    this.gf.events.disconnect('data_processed', this);
    this.gf.rulesHandler?.events.disconnect('rule_updated', this);
    this.gf.rulesHandler?.events.disconnect('rule_changed', this);
    this.gf.rulesHandler?.events.disconnect('rule_created', this);
    this.gf.rulesHandler?.events.disconnect('rule_deleted', this);
    this.events.clear();
    await this.events.emit('state_freed', this);
  }

  //############################################################################
  //### ACCESSORS
  //############################################################################
  getXCell(): XCell {
    return this.xcell;
  }

  getLevel(): number {
    return this.globalLevel;
  }

  //############################################################################
  //### LOGIC
  //############################################################################

  /**
   * Define state according to the matched rules and their metrics, without
   * applying the display. A rule result recolors/styles/texts the cell when its
   * map pattern matches the cell identifier and the threshold level is eligible.
   */
  private async _setCycle(rule?: Rule) {
    const funcName = 'setCycle';
    GFLog.debug(`${this.constructor.name}.${funcName}() : ${this.uid}`);
    const rules = rule === undefined ? Array.from(this._rules.values()) : [rule];
    rules.forEach((r: Rule) => {
      let beginPerf = Date.now();
      if (!r.hidden) {
        const shapeMaps = r.getShapeMaps();
        const textMaps = r.getTextMaps();
        const linkMaps = r.getLinkMaps();
        const eventMaps = r.getEventMaps();
        this._variables.set(GFCONSTANT.VAR_STR_RULENAME, r.data.alias);
        const m = Array.from(r.getMetrics().values());
        m.forEach((metric: ObjectMetric) => {
         try {
          try {
            this.currMetrics.push(metric.getName());
            this._variables.set(GFCONSTANT.VAR_STR_METRIC, metric.getName());
          } catch (error) {
            GFLog.error(error);
          }
          const value = r.getValueForMetric(metric);
          const FormattedValue = r.getFormattedValue(value);
          const level = r.getThresholdLevel(value);
          const color = r.getThresholdColor(value);
          this._variables.set(GFCONSTANT.VAR_NUM_VALUE, value);
          this._variables.set(GFCONSTANT.VAR_STR_FORMATED, FormattedValue);
          this._variables.set(GFCONSTANT.VAR_NUM_LEVEL, level);
          this._variables.set(GFCONSTANT.VAR_STR_COLOR, color);
          this._variables.set(GFCONSTANT.VAR_STR_DATE, getCurrentDate());

          // SHAPE
          let matchedRule = false;
          let mapOptions = r.getShapeMapOptions();
          let cellValue = this.xcell.getDefaultValues(mapOptions) as string;
          shapeMaps.forEach((shape) => {
            let k: string = shape.data.style;
            if (!shape.hidden && shape.match(cellValue, mapOptions, this._variables)) {
              let v: any = color;
              if (shape.isEligible(level)) {
                matchedRule = true;
                this.matched = true;
                this.shapeState.set(k, v, level) && this._status.set(k, v);
              }

              // TOOLTIP
              if (r.toTooltipize(level)) {
                k = 'tooltip';
                v = true;
                this.tooltipState.set('tooltip', true, level) && this._status.set(k, v);
                this.tooltipState.setTooltip(r, metric, color, FormattedValue);
              }
              // ICONS
              if (r.toIconize(level)) {
                k = 'icon';
                v = true;
                this.iconState.set('icon', true, level) && this._status.set(k, v);
              }
            }
          });

          // TEXT
          mapOptions = r.getTextMapOptions();
          cellValue = this.xcell.getDefaultValues(mapOptions) as string;
          textMaps.forEach((text) => {
            const k = 'label';
            if (!text.hidden && text.match(cellValue, mapOptions, this._variables)) {
              if (text.isEligible(level)) {
                matchedRule = true;
                this.matched = true;
                const textScoped = this._variables.replaceText(FormattedValue);
                const v = text.getReplaceText(this.textState.getMatchValue(k), textScoped);
                this.textState.set(k, v, level) && this._status.set(k, v);
              }
            }
          });

          // EVENTS
          mapOptions = r.getEventMapOptions();
          cellValue = this.xcell.getDefaultValues(mapOptions) as string;
          eventMaps.forEach((event) => {
            const k = event.data.style;
            if (!event.hidden && event.match(cellValue, mapOptions, this._variables)) {
              if (event.isEligible(level)) {
                matchedRule = true;
                this.matched = true;
                const v = this._variables.eval(event.data.value);
                this.eventState.set(k, v, level) && this._status.set(k, v);
              }
            }
          });

          // LINK
          mapOptions = r.getEventMapOptions();
          cellValue = this.xcell.getDefaultValues(mapOptions) as string;
          linkMaps.forEach((link) => {
            const k = 'link';
            if (!link.hidden && link.match(cellValue, mapOptions, this._variables)) {
              if (link.isEligible(level)) {
                matchedRule = true;
                this.matched = true;
                const v = this._variables.replaceText(link.getLink());
                this.linkState.set(k, v, level) && this._status.set(k, v);
              }
            }
          });

          if (matchedRule) {
            this.currRules.push(r.data.alias);
            if (level > this.globalLevel) {
              this.globalLevel = level;
              this.highestValue = value;
              this.highestFormattedValue = FormattedValue;
            }
            if (level >= r.highestLevel) {
              r.highestLevel = level;
              r.highestValue = value;
              r.highestFormattedValue = FormattedValue;
              r.highestColor = color;
            }
          }
         } catch (error) {
           // A failure while evaluating one metric (e.g. building a tooltip)
           // must not abort the whole cycle: that would skip `_applyCycle` and,
           // because `update()` chains on a single promise, poison every later
           // update for this cell. Log and continue with the next metric so the
           // already-computed shape color is still applied.
           GFLog.error('Error evaluating metric for state', error);
         }
        });
      }
      let endPerf = Date.now();
      r.execTimes += endPerf - beginPerf;
    });
    return;
  }

  /**
   * Restore initial status of state without applying display.
   */
  _unsetState(): this {
    this.eventState.unset();
    this.textState.unset();
    this.linkState.unset();
    this.tooltipState.unset();
    this.iconState.unset();
    this.matched = false;
    return this;
  }

  getTextLevel(): string {
    return this.globalLevel === -1 ? '' : this.globalLevel.toString();
  }

  getStatus(key: string): string {
    let style: string | null | undefined = this._status.get(key);
    if (style !== undefined && style !== null) {
      return style;
    }
    style = this.xcell.getStyle(key);
    if (style === null) {
      style = '';
    }
    this._status.set(key, style);
    return style;
  }

  haveStatus(key: string): boolean {
    return this._status.has(key);
  }

  isShape(): boolean {
    return this.xcell.getMxCell().isVertex();
  }

  isConnector(): boolean {
    return this.xcell.getMxCell().isEdge();
  }

  getShapeName(): string {
    if (this.xcell) {
      const name = this.xcell.getStyle('shape');
      if (name === null) {
        return '';
      }
      return name;
    }
    return 'Unknown';
  }

  getShapeStyles(): string {
    if (this.xcell) {
      const style = this.xcell.getMxCell().getStyle();
      return typeof style === 'string' ? style : JSON.stringify(style ?? {});
    }
    return 'Unknown';
  }

  /**
   * Apply new state — push each sub-state onto the cell when the state matched
   * or changed.
   */
  private async _applyCycle() {
    const funcName = 'applyCycle';
    GFLog.debug(`${this.constructor.name}.${funcName}() : ${this.uid}`);
    if (this.matched || this.changed) {
      this.changed = true;
      return this._ObjStates.map(async (o: { apply: CallableFunction }) => {
        o.apply();
      });
    }
    return;
  }

  reset(): this {
    this._ObjStates.map(async (o: { reset: CallableFunction }) => {
      o.reset();
    });
    this._variables.clear();
    this._status.clear();
    this.globalLevel = -1;
    this.highestFormattedValue = '';
    this.highestValue = undefined;
    this.changed = false;
    return this;
  }

  private async _initCycle() {
    const funcName = 'initCycle';
    GFLog.debug(`${this.constructor.name}.${funcName}() : ${this.uid}`);
    if (this.changed) {
      await Promise.all(
        this._ObjStates.map(async (o: { prepare: CallableFunction }) => {
          o.prepare();
        })
      );
      this._variables.clear();
      this._status.clear();
      this.globalLevel = -1;
      this.highestFormattedValue = '';
      this.currMetrics = [];
      this.currRules = [];
      this.highestValue = undefined;
      this.matched = false;
    }
    return this;
  }

  highlightCell(): this {
    this.xcell.highlight();
    return this;
  }

  unhighlightCell(): this {
    this.xcell.highlight(false);
    return this;
  }

  //
  // Rules
  //
  private _matchRule(rule: Rule): boolean {
    let mapOptions = rule.getShapeMapOptions();
    let cellValue = this.xcell.getDefaultValues(mapOptions) as string;
    if (rule.matchShape(cellValue, mapOptions)) {
      return true;
    }
    mapOptions = rule.getTextMapOptions();
    cellValue = this.xcell.getDefaultValues(mapOptions) as string;
    if (rule.matchText(cellValue, mapOptions)) {
      return true;
    }
    mapOptions = rule.getLinkMapOptions();
    cellValue = this.xcell.getDefaultValues(mapOptions) as string;
    if (rule.matchLink(cellValue, mapOptions)) {
      return true;
    }
    mapOptions = rule.getEventMapOptions();
    cellValue = this.xcell.getDefaultValues(mapOptions) as string;
    if (rule.matchEvent(cellValue, mapOptions)) {
      return true;
    }
    return false;
  }

  private _updateRule(rule?: Rule): this {
    if (rule !== null && rule !== undefined) {
      if (this._matchRule(rule)) {
        this._rules.set(rule.uid, rule);
      } else {
        this._rules.delete(rule.uid);
      }
    }
    return this;
  }

  private _haveRule(rule: Rule): boolean {
    return this._rules.has(rule.uid);
  }

  removeRule(rule: Rule): this {
    if (rule !== null && rule !== undefined && this.hasRule(rule)) {
      this._rules.delete(rule.uid);
      this.change();
    }
    return this;
  }

  hasRule(rule?: Rule): boolean {
    if (rule) {
      return this._rules.has(rule.uid);
    }
    return false;
  }

  //###########################################################################
  //### EVENTS
  //###########################################################################
  private _on_global_data_received() {
    _log('📬', this.constructor.name, '_on_global_data_received');
  }

  private _on_global_data_processed() {
    _log('📬', this.constructor.name, '_on_global_data_processed');
    this.update();
  }

  private _on_ruleHandler_rule_changed(rule: Rule) {
    _log('📬', this.constructor.name, '_on_ruleHandler_rule_changed');
    if (this._haveRule(rule) || this._matchRule(rule)) {
      this._updateRule(rule);
      this.update();
    }
  }

  private _on_ruleHandler_rule_updated(rule: Rule) {
    _log('📬', this.constructor.name, '_on_ruleHandler_rule_updated');
    this._updateRule(rule);
  }

  private _on_ruleHandler_rule_created(rule: Rule) {
    _log('📬', this.constructor.name, '_on_ruleHandler_rule_created');
    this._updateRule(rule);
  }

  private _on_ruleHandler_rule_deleted(rule: Rule) {
    _log('📬', this.constructor.name, '_on_ruleHandler_rule_deleted');
    this.removeRule(rule);
  }
}

/**
 * Mother of sub states — a keyed match/change/level bookkeeping unit that knows
 * how to read (`default_core`), apply (`apply_core`), and restore (`reset_core`)
 * one family of cell properties.
 *
 * @class GFState
 */
export class GFState {
  xgraph: XGraph;
  xcell: XCell;
  keys: string[] = [];
  matchedKey: Map<string, boolean> = new Map();
  ackKey: Set<string> = new Set();
  changedKey: Map<string, boolean> = new Map();
  defaultValue: Map<string, any> = new Map();
  matchValue: Map<string, any> = new Map();
  static DEFAULTLEVEL = -1;
  matchLevel: Map<string, number> = new Map();

  constructor(xgraph: XGraph, xcell: XCell) {
    this.xgraph = xgraph;
    this.xcell = xcell;
    this.init_core();
  }

  init_core() {}

  addValue(key: string, value: any) {
    if (!this.hasKey(key)) {
      this.keys.push(key);
    }
    this.defaultValue.set(key, value);
    this.matchValue.set(key, value);
    this.matchLevel.set(key, GFState.DEFAULTLEVEL);
    this.matchedKey.set(key, false);
    this.changedKey.set(key, false);
  }

  hasKey(key: string): boolean {
    return this.keys.includes(key);
  }

  getDefaultValue(key: string): any | undefined {
    if (!this.hasKey(key)) {
      this.defaultValue.set(key, this.default_core(key));
    }
    return this.defaultValue.get(key);
  }

  getMatchValue(key: string): any | undefined {
    if (!this.hasKey(key)) {
      this.matchValue.set(key, this.getDefaultValue(key));
    }
    return this.matchValue.get(key);
  }

  getTargetValue(key: string): any | undefined {
    if (this.isMatched(key)) {
      return this.getMatchValue(key);
    }
    if (this.isChanged(key)) {
      return this.getDefaultValue(key);
    }
    return undefined;
  }

  ack(key: string): this {
    if (key !== undefined) {
      if (this.isMatched(key)) {
        this.matchedKey.set(key, false);
        this.changedKey.set(key, true);
      } else if (this.isChanged(key)) {
        this.matchedKey.set(key, false);
        this.changedKey.set(key, false);
      }
      this.ackKey.add(key);
    }
    return this;
  }

  isAcked(key: string) {
    return this.ackKey.has(key);
  }

  /**
   * Insert key and value if its level is >= the currently stored level.
   *
   * @returns {boolean} true if applied
   */
  set(key: string, value: any, level: number): boolean {
    let matchLevel = this.matchLevel.get(key);
    if (matchLevel === undefined) {
      const defaultValue = this.default_core(key);
      this.addValue(key, defaultValue);
      return this.set(key, value, level);
    }
    if (matchLevel <= level) {
      this.matchLevel.set(key, level);
      this.matchedKey.set(key, true);
      this.matchValue.set(key, value);
      return true;
    }
    return false;
  }

  async apply(key?: string) {
    if (key !== undefined) {
      if (this.isMatched(key) && !this.isAcked(key)) {
        let value = this.getMatchValue(key);
        try {
          this.apply_core(key, value);
        } catch (error) {
          GFLog.error('Error on reset for key ' + key, error);
        }
        this.ack(key);
      } else if (this.isChanged(key) && !this.isAcked(key)) {
        this.reset(key);
        this.ack(key);
      }
    } else {
      this.keys.forEach((key) => {
        this.apply(key);
      });
    }
  }

  default_core(key: any): any {
    return null;
  }

  apply_core(key: any, value: any) {}

  isMatched(key?: string): boolean {
    if (key !== undefined) {
      return this.matchedKey.get(key) === true;
    }
    let matched = false;
    this.keys.forEach((key) => {
      matched = this.isMatched(key) || matched;
    });
    return matched;
  }

  isChanged(key?: string): boolean {
    if (key !== undefined) {
      return this.changedKey.get(key) === true;
    }
    let changed = false;
    this.keys.forEach((key) => {
      changed = this.isChanged(key) ? true : changed;
    });
    return changed;
  }

  getLevel(key?: string): number {
    if (key !== undefined) {
      let level = this.matchLevel.get(key);
      return level !== undefined ? level : GFState.DEFAULTLEVEL;
    }
    let level = GFState.DEFAULTLEVEL;
    this.keys.forEach((key) => {
      level = Math.max(this.getLevel(key), level);
    });
    return level;
  }

  unset(key?: string): this {
    if (key !== undefined) {
      this.matchValue.set(key, this.defaultValue.get(key));
      this.matchedKey.set(key, false);
      this.matchLevel.set(key, -1);
    } else {
      this.keys.forEach((key) => {
        this.unset(key);
      });
    }
    return this;
  }

  reset(key?: string): this {
    if (key !== undefined) {
      this.unset(key);
      let value = this.getDefaultValue(key);
      try {
        this.reset_core(key, value);
      } catch (error) {
        GFLog.error('Error on reset for key ' + key, error);
      }
      this.changedKey.set(key, false);
      this.matchedKey.set(key, false);
    } else {
      this.keys.forEach((key) => {
        this.reset(key);
      });
    }
    return this;
  }

  reset_core(key: any, value: any) {}

  prepare(): this {
    this.ackKey.clear();
    if (this.isChanged()) {
      this.unset();
    }
    return this;
  }
}

/**
 * Event SubState — applies the event-map outcomes (style/anim/size/zoom/blink/
 * visibility/fold/text/metadata) onto the cell.
 *
 * @class EventState
 * @extends {GFState}
 */
class EventState extends GFState {
  keys: TTypeEventKeys[] = [];
  geo:
    | {
        x: number;
        y: number;
        width: number;
        height: number;
      }
    | undefined = undefined;
  constructor(xgraph: XGraph, xcell: XCell) {
    super(xgraph, xcell);
    this.init_core();
  }

  init_core() {
    const dim = this.xcell.getDefaultDimension();
    this.geo = dim ? { x: dim.x, y: dim.y, width: dim.width, height: dim.height } : undefined;
  }

  default_core(key: TTypeEventKeys): any {
    return this._get(key);
  }

  apply_core(key: TTypeEventKeys, value: any) {
    if (value === undefined) {
      value = null;
    }
    this._set(key, value);
  }

  reset_core(key: TTypeEventKeys, value: any) {
    if (value === undefined) {
      value = null;
    }
    this._set(key, value);
  }

  _set(key: TTypeEventKeys, value: any) {
    if (value === undefined || value === 'null') {
      value = null;
    }
    switch (key) {
      case 'class':
        throw new Error('Class not implemented');
      case 'text':
        value = String(value);
        this.xcell.setLabel(value);
        break;
      case 'tpMetadata':
        if (value !== null) {
          const tbl = String(value).split('@');
          if (tbl.length > 0) {
            let k: any = tbl.shift();
            let v: any = null;
            if (tbl.length > 0) {
              v = tbl.join('@');
            }
            this.xcell.setMetadata(k, v);
          }
        }
        break;
      case 'tpText':
        if (value === undefined || value === null || value.length === 0 || value === 'null') {
          value = null;
        }
        this.xcell.setMetadata('tooltip', value);
        break;
      case 'visibility':
        value = String(value);
        if (value === '0') {
          this.xcell.hide();
        } else if (value === '1') {
          this.xcell.hide(false);
        }
        break;
      case 'fold':
        value = String(value);
        if (value === '0') {
          this.xcell.collapse(true);
        } else if (value === '1') {
          this.xcell.collapse(false);
        }
        break;

      case 'height':
        if (value !== undefined) {
          const height = Number(value);
          const width = this.getTargetValue('width');
          this.ack('width');
          this.xgraph.setAnimSizeCell(this.xcell, width, height);
        }
        break;

      case 'width':
        if (value !== undefined) {
          const width = Number(value);
          const height = this.getTargetValue('height');
          this.ack('height');
          this.xgraph.setAnimSizeCell(this.xcell, width, height);
        }
        break;

      case 'size':
        if (this.geo !== undefined) {
          let percent = Number(value);
          this.xgraph.setAnimZoomCell(this.xcell, percent);
        }
        break;

      case 'blink':
        if (!!value) {
          this.xcell.blink(value);
        } else {
          this.xcell.blink(value, false);
        }
        break;

      default:
        const k: any = key;
        if (XGraph.isMxGraphAnimStyle(key)) {
          let beginValue = this._get(k);
          beginValue = beginValue === undefined ? EventMap.getDefaultValue(k) : beginValue;
          this.xgraph.setAnimStyleCell(this.xcell, k, value, beginValue);
        } else if (XGraph.isMxGraphStyle(k)) {
          this.xcell.setStyle(k, value);
        } else {
          throw new Error(`Unknow type ${k}`);
        }
        break;
    }
  }

  _get(key: TTypeEventKeys): any {
    switch (key) {
      case 'text':
        return this.xcell.getLabel();

      case 'visibility':
        return !this.xcell.isHidden();

      case 'height':
        return this.geo !== undefined ? this.geo.height : undefined;

      case 'width':
        return this.geo !== undefined ? this.geo.width : undefined;

      case 'tpText':
        return this.xcell.getMetadata('tooltip');

      case 'tpMetadata':
        return null;

      case 'size':
        return 100;

      case 'fold':
        return this.xcell.isCollapsed() === true ? '0' : '1';

      case 'blink':
        return this.xcell.isBlink();

      default:
        if (XGraph.isMxGraphStyle(key)) {
          const k: any = key;
          return this.xcell.getStyle(k);
        } else {
          throw new Error(`Unknow type ${key}`);
        }
    }
  }
}

/**
 * Text SubState — applies/restores the cell label.
 */
class TextState extends GFState {
  keys: string[] = [];
  constructor(xgraph: XGraph, xcell: XCell) {
    super(xgraph, xcell);
    this.init_core();
  }

  init_core() {}

  default_core(key: any): string | null {
    return this.xcell.getLabel();
  }

  apply_core(key: string, value: any) {
    this.xcell.setLabel(value);
  }

  reset_core(key: string, value: any) {
    this.xcell.restoreLabel();
  }
}

/**
 * Link SubState — applies/restores the cell hyperlink.
 */
class LinkState extends GFState {
  keys: string[] = [];
  constructor(xgraph: XGraph, xcell: XCell) {
    super(xgraph, xcell);
    this.init_core();
  }

  init_core() {}

  default_core(key: any): string | null {
    return this.xcell.getDefaultLink();
  }

  apply_core(key: string, value: any) {
    this.xcell.setLink(value);
  }

  reset_core(key: string, value: any) {
    this.xcell.restoreLink();
  }
}

/**
 * Shape SubState — applies the (animated) shape color and restores the default
 * style. This is the recolor path a rule result drives (Req 4.5).
 *
 * @class ShapeState
 * @extends {GFState}
 */
class ShapeState extends GFState {
  keys: TStyleColorKeys[] = [];
  fullStylesString: string | undefined;
  constructor(xgraph: XGraph, xcell: XCell) {
    super(xgraph, xcell);
    this.init_core();
  }

  init_core() {
    this.xcell.enableTooltip(false);
  }

  default_core(key: any): string | null {
    return this.xcell.getDefaultStyle(key);
  }

  apply_core(key: TStyleColorKeys, value: any) {
    if (value === undefined) {
      value = null;
    }
    this.xgraph.setAnimColorCell(this.xcell, key, value);
  }

  reset_core(key: TStyleColorKeys, value: any) {
    this.xcell.restoreStyle(key);
  }
}

/**
 * Tooltip SubState — builds the per-cell {@link TooltipHandler} and attaches it
 * to the cell when a rule's tooltip is eligible. The concrete TooltipHandler
 * (with sparkline) lands in Task 11; this drives it through the forward-declared
 * contract.
 */
class TooltipState extends GFState {
  keys: string[] = ['tooltip'];
  tooltipHandler: TooltipHandler | undefined;
  constructor(xgraph: XGraph, xcell: XCell) {
    super(xgraph, xcell);
    this.init_core();
  }

  init_core() {
    this.addValue('tooltip', false);
    this.tooltipHandler = undefined;
    this.xcell.enableTooltip(false);
  }

  setTooltip(rule: Rule, metric: ObjectMetric, color: string, value: string) {
    let tpColor: string | null = null;
    let label: string = rule.tooltipLabel;
    if (this.tooltipHandler === null || this.tooltipHandler === undefined) {
      this.tooltipHandler = TooltipState._createTooltipHandler();
    }
    if (rule.tooltip) {
      if (label === null || label.length === 0) {
        if (rule.metricType === 'serie') {
          label = metric.getName();
        }
        if (rule.metricType === 'table') {
          label = rule.metricColumn;
        }
      }
      if (rule.tooltipColors) {
        tpColor = color;
      }
      // METRIC
      const metricToolip = this.tooltipHandler
        .addMetric()
        .setLabel(label)
        .setValue(value)
        .setColor(tpColor)
        .setDirection(rule.graphDirection);
      // GRAPH
      if (rule.tooltipForGraph) {
        const graph = metricToolip.addGraph(rule.graphType);
        graph
          .setColor(tpColor)
          .setColumn(rule.metricColumn)
          .setMetric(metric)
          .setSize(rule.graphSize)
          .setScaling(rule.graphLow, rule.graphHigh)
          .setScale(rule.graphScale);
      }
    }
    // Metadata
    if (rule.tooltipMetadata) {
      this.tooltipHandler.addMetadata().setXCell(this.xcell);
    }
    // Date
    this.tooltipHandler.updateDate();
  }

  /**
   * Factory for the per-cell TooltipHandler. Task 11 ported the concrete
   * `TooltipHandler` (with an inline-SVG sparkline) into `engine/tooltipHandler`;
   * it satisfies the forward-declared `TooltipHandlerLike` contract, so the
   * state-application algorithm drives it unchanged.
   */
  private static _createTooltipHandler(): TooltipHandler {
    return new TooltipHandlerImpl();
  }

  async apply(key?: string) {
    if (key !== undefined && key === 'tooltip') {
      if (this.isMatched(key) && this.getMatchValue(key) === true) {
        if (this.tooltipHandler != null && this.tooltipHandler.isChecked()) {
          this.xcell.enableTooltip().setTooltipHandler(this.tooltipHandler);
        }
        super.apply(key);
      }
    } else {
      this.keys.forEach((key) => {
        this.apply(key);
      });
    }
  }

  prepare(): this {
    super.prepare();
    this.reset();
    return this;
  }

  reset(key?: string): this {
    if (key !== undefined && key === 'tooltip') {
      this.xcell.enableTooltip(false);
      this.tooltipHandler = undefined;
      super.reset(key);
    } else {
      this.keys.forEach((key) => {
        this.reset(key);
      });
    }
    return this;
  }
}

/**
 * Icon SubState — adds/removes a warning/error overlay icon on the cell.
 */
class IconState extends GFState {
  keys: string[] = [];
  constructor(xgraph: XGraph, xcell: XCell) {
    super(xgraph, xcell);
    this.init();
  }

  init() {}

  default_core(key: string): any {
    return false;
  }

  apply_core(key?: string): any {
    if (key !== undefined && key === 'icon') {
      if (this.isMatched(key) && this.getMatchValue(key) === true) {
        if (!this.isChanged(key)) {
          this.xcell.addOverlay(`WARNING/ERROR`);
        }
      } else if (this.isChanged(key)) {
        this.reset_core(key);
      }
    } else {
      this.keys.forEach((key) => {
        this.apply_core(key);
      });
    }
    return this;
  }

  reset_core(key?: string): any {
    if (key !== undefined && key === 'icon') {
      this.xcell.removeOverlay();
    } else {
      this.keys.forEach((key) => {
        this.reset_core(key);
      });
    }
    return this;
  }
}
