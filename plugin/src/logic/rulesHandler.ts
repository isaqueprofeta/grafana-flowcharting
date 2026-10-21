/**
 * rulesHandler — the RulesHandler, ported **as-is (logic)** from the legacy
 * `src/rules_handler.ts` (design.md: Logic_Layer, "RulesHandler: as-is logic,
 * import swaps", Req 4.1).
 *
 * Rule ordering, add/remove/clone/move, and the `_convert` migration are
 * preserved verbatim. Only imports are swapped:
 *   - `$GF.genUid`   -> `genUid`      (logic/globals)
 *   - `$GF.setFocus` -> `gf.setFocus` (Context_Seam)
 *   - `$gf: $GF`     -> `gf: LogicContext`; `$gf.rulesHandler = this` preserved
 *   - lodash `sortBy`-> native `slice().sort` by `order`
 *   - `gf.*` types   -> exported interfaces from `logic/legacyTypes`
 *
 * No `$GF`, `$scope`, Angular, `globalThis`, or `mx*` global mutation.
 */
import { Rule } from './rule';
import { GFLog, genUid } from './globals';
import { GFEvents } from './flowchartingBase';
import type { LogicContext, RulesHandlerLike } from './logicContext';
import type { TIRuleData, TIRulesHandlerData } from './legacyTypes';

// Debug
const DEBUG = false;
const _log = (...args: any) => {
  DEBUG && console.log(...args);
};

// Define signals
const ruleHandlerSignalsArray = ['rule_created', 'rule_updated', 'rule_changed', 'rule_deleted'] as const;
type RuleHandlerSignals = typeof ruleHandlerSignalsArray[number];

/**
 * Rules Handler
 *
 * @export
 * @class RulesHandler
 */
export class RulesHandler implements RulesHandlerLike {
  private readonly gf: LogicContext;
  rules: Rule[];
  uid: string;
  data: TIRulesHandlerData;
  activeRuleIndex = 0;
  events: GFEvents<RuleHandlerSignals> = GFEvents.create(ruleHandlerSignalsArray);

  /**
   * Creates an instance of RulesHandler.
   */
  constructor(gf: LogicContext, data: TIRulesHandlerData, oldData?: any) {
    this.gf = gf;
    this.gf.rulesHandler = this;
    this.uid = genUid(this.constructor.name);
    this.rules = [];
    this.data = data;
    if (oldData) {
      this._convert(oldData);
    }
    this.init();
  }

  //############################################################################
  //### INIT/UPDATE/CHANGE/FREE
  //############################################################################
  clear(): this {
    GFLog.debug(this.constructor.name + '.clear()');
    this.rules.forEach((r) => r.clear());
    this.rules = [];
    this.data.rulesData = [];
    return this;
  }

  //
  // Updates
  //
  init(): this {
    GFLog.debug(this.constructor.name + '.init()');
    this.gf.events.connect('debug_asked', this, this._on_global_debug_asked.bind(this));
    this.gf.events.connect('panel_closed', this, this._on_global_panel_closed.bind(this));
    return this;
  }

  update(): this {
    GFLog.debug(this.constructor.name + '.refresh()');
    this.rules.forEach((r) => r.update());
    return this;
  }

  change(): this {
    GFLog.debug(this.constructor.name + '.change()');
    this.rules.forEach((r) => r.change());
    return this;
  }

  free(): this {
    GFLog.debug(this.constructor.name + '.free()');
    this.gf.events.disconnect('debug_asked', this);
    this.gf.events.disconnect('panel_closed', this);
    this.rules.forEach((r) => r.free());
    this.clear();
    this.events.clear();
    this.gf.rulesHandler = undefined;
    return this;
  }

  //############################################################################
  //### LOGIC
  //############################################################################

  setData(data: TIRulesHandlerData): this {
    this.data = data;
    return this;
  }

  /**
   * import datas in rule from current or old version
   */
  private _convert(obj: any): this {
    GFLog.info('RuleHandler.import()');
    this.clear();
    let index = 1;
    if (obj !== undefined && obj !== null) {
      // For version < 0.6.0
      let tmpRules: TIRuleData[];
      if (Array.isArray(obj)) {
        tmpRules = obj;
      } else {
        tmpRules = obj.rulesData;
      }
      // Fix bug of grafana 6+
      if (tmpRules.length > 0 && tmpRules[0].order !== undefined) {
        tmpRules = tmpRules.slice().sort((a, b) => a.order - b.order);
      }

      tmpRules.map(async (ruleData) => {
        const r = this.addRule('', ruleData);
        r.setOrder(index);
        index += 1;
        this.events.emit('rule_created', r);
      });
    }
    this.change();
    return this;
  }

  /**
   * Return data with default value
   */
  static getDefaultData(): TIRulesHandlerData {
    return {
      rulesData: [Rule.getDefaultData()],
    };
  }

  /**
   * Return array of rules
   */
  getRules(): Rule[] {
    return this.rules;
  }

  /**
   * Get Rule at index or alias
   */
  getRule(value: number | string): Rule | null {
    if (typeof value === 'number') {
      return this.rules[value];
    }
    for (let index = 0; index < this.rules.length; index++) {
      const r = this.rules[index];
      if (value === r.name) {
        return r;
      }
    }
    return null;
  }

  /**
   * Add a new rule
   */
  addRule(pattern: string, previousData?: any): Rule {
    const data: TIRuleData = Rule.getDefaultData();
    const newRule = new Rule(this.gf, pattern, data, previousData);
    this.rules.push(newRule);
    this.data.rulesData.push(data);
    newRule.setOrder(this.countRules());
    newRule.events.connect('rule_updated', this, this._on_rule_rule_updated.bind(this));
    newRule.events.connect('rule_changed', this, this._on_rule_rule_changed.bind(this));
    return newRule;
  }

  /**
   * count number of rules
   */
  countRules(): number {
    if (this.rules !== undefined && Array.isArray(this.rules)) {
      return this.rules.length;
    }
    return 0;
  }

  /**
   * Redefine Order number of rules
   */
  setOrder(): this {
    const lg = this.rules.length;
    for (let index = 0; index < lg; index++) {
      const rule = this.rules[index];
      rule.setOrder(index + 1);
    }
    return this;
  }

  /**
   * Remove rule at index
   */
  removeRule(rule: Rule): this {
    GFLog.debug(this.constructor.name + '.removeRule()', rule);
    rule.events.disconnect('rule_updated', this);
    rule.events.disconnect('rule_changed', this);
    const index = rule.getOrder() - 1;
    rule.free();
    this.rules.splice(index, 1);
    this.data.rulesData.splice(index, 1);
    this.setOrder();
    return this;
  }

  /**
   * Clone rules at index in index - 1
   */
  cloneRule(rule: Rule): Rule {
    GFLog.debug(this.constructor.name + '.cloneRule()', rule);
    const index = rule.getOrder() - 1;
    const data = rule.getData();
    const newData: TIRuleData = Rule.getDefaultData();
    this.reduce();
    const newRule = new Rule(this.gf, newData.pattern, newData, data);
    newData.alias = `Copy of ${newData.alias}`;
    this.rules.splice(index, 0, newRule);
    this.data.rulesData.splice(index, 0, newData);
    newRule.data.reduce = false;
    this.activeRuleIndex = index;
    this.setOrder();
    this.gf.setFocus(newRule.uid);
    return newRule;
  }

  /**
   * Reduce all rules
   */
  reduce(): this {
    this.getRules().forEach((rule) => {
      rule.reduce = true;
    });
    return this;
  }

  /**
   * Move rule on index in index - 1
   */
  moveRuleToUp(rule: Rule) {
    const index = rule.getOrder() - 1;
    const first = 0;
    const rules = this.rules;
    const last = rules.length - 1;
    if (index !== first && last !== first) {
      const curr = rules[index];
      curr.setOrder(index);
      const before = rules[index - 1];
      before.setOrder(index + 1);
      rules[index - 1] = curr;
      rules[index] = before;
    }
  }

  /**
   * Move rule on index in index + 1
   */
  moveRuleToDown(rule: Rule) {
    const index = rule.getOrder() - 1;
    const first = 0;
    const rules = this.rules;
    const last = rules.length - 1;
    if (index !== last && last !== first) {
      const curr = rules[index];
      curr.setOrder(index + 2);
      const after = rules[index + 1];
      after.setOrder(index + 1);
      rules[index + 1] = curr;
      rules[index] = after;
    }
  }

  //#############################################################
  //### EVENTS
  //#############################################################
  private _on_rule_rule_updated(rule: Rule) {
    _log('📬', this.constructor.name, '_on_rule_rule_updated');
    this.events.emit('rule_updated', rule);
  }

  private _on_rule_rule_changed(rule: Rule) {
    _log('📬', this.constructor.name, '_on_rule_rule_changed');
    this.events.emit('rule_changed', rule);
  }

  private _on_global_debug_asked() {
    _log('📬', this.constructor.name, '_on_rule_rule_changed');
    _log('🗃️', this.constructor.name, this);
  }

  private _on_global_panel_closed() {
    this.free();
  }
}
