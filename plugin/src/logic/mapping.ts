/**
 * mapping — the shape / text / link / event maps and the value / range maps,
 * ported **as-is** from the legacy `src/mapping_class.ts` (design.md:
 * Logic_Layer "as-is — pure value/range/shape/text/link/event matching",
 * Req 4.3, 4.4).
 *
 * The matching algorithms (`match`, `isEligible`, `getReplaceText`,
 * `getFormattedText`, range membership) are preserved verbatim. Only imports
 * are swapped:
 *   - `$GF.genUid`       -> `genUid`        (logic/globals)
 *   - `$GF.matchString`  -> `matchString`   (logic/logicHelpers)
 *   - `$GF.stringToRegEx`-> `stringToRegEx` (logic/logicHelpers)
 *   - `GFPlugin.*`       -> `GFPaths.*`     (logic/globals)
 *   - `$gf: $GF`         -> `gf: LogicContext` (Context_Seam)
 *   - `GFVariables`      -> an injected `(text) => string` interpolator
 *                           (seam `gf.interpolate`), replacing `replaceText`
 *   - `gf.*` data types  -> exported interfaces from `logic/legacyTypes`
 *   - lodash `isString`  -> native `typeof === 'string'`
 *
 * No `$GF`, `$scope`, Angular, `globalThis`, or `mx*` global mutation.
 */
import { GFEvents } from './flowchartingBase';
import { GFCONSTANT, GFPaths, genUid } from './globals';
import { matchString, stringToRegEx } from './logicHelpers';
import type { LogicContext } from './logicContext';
import type { XCell } from './engineRefs';
import { Rule } from './rule';
import type {
  TColorOnKeys,
  TComparatorKeys,
  TDefObjMapData,
  TEventComparator,
  TEventMapData,
  TlinkMapData,
  TLinkOnKeys,
  TRangeMapData,
  TRuleMapOptions,
  TShapeMapData,
  TStyleColorKeys,
  TTextMapData,
  TTextMethodKeys,
  TTextOnKeys,
  TTypeEventElt,
  TTypeEventKeys,
  TTypeMap,
  TValueMapData,
} from './legacyTypes';

export type ObjectMap = ShapeMap | TextMap | LinkMap | EventMap;
export type ObjectMapArray = ShapeMapArray | TextMapArray | LinkMapArray | EventMapArray;
export type ShapeMapArray = ShapeMap[];
export type TextMapArray = TextMap[];
export type LinkMapArray = LinkMap[];
export type EventMapArray = EventMap[];
export type DataMap = TShapeMapData | TTextMapData | TlinkMapData | TEventMapData;

export type ObjectVMap = ValueMap | RangeMap;
export type DataVMap = TValueMapData | TRangeMapData;
export interface MapDataCommonProp {
  pattern: string;
  hidden: boolean;
}

/** Interpolator the maps use to resolve template variables in patterns. */
export type TextInterpolator = { replaceText(text: string): string };

// Debug
const DEBUG = false;
const _log = (...args: any) => {
  DEBUG && console.log(...args);
};

// Signal definition
const mappingSignalsArray = ['map_initalized', 'map_changed', 'map_freed'] as const;
type MappingSignals = typeof mappingSignalsArray[number];

abstract class GFMap<MapData extends TDefObjMapData> {
  gf: LogicContext;
  data: MapData;
  uid: string;
  type: TTypeMap = 'shape';
  options: TRuleMapOptions = Rule.getDefaultMapOptions();
  reduce = true;
  onMapping = false;
  events: GFEvents<MappingSignals> = GFEvents.create(mappingSignalsArray);
  static methods: any[] = [];
  constructor(gf: LogicContext, pattern: string, data: MapData, previousData?: any) {
    this.gf = gf;
    this.uid = genUid();
    this.data = data;
    this.data.pattern = pattern;
    if (previousData) {
      this.import(previousData);
    }
    this.init();
  }

  protected abstract _setType(): void;

  //############################################################################
  //### INIT/UPDATE/CHANGE/FREE
  //############################################################################
  init() {
    this._setType();
    this.events.emit('map_initalized', this);
    this.gf.events.connect('mapping_disabled', this, this._on_global_mapping_disabled.bind(this));
  }

  change() {
    this.events.emit('map_changed', this);
  }

  free() {
    this.clear();
    this.gf.events.disconnect('mapping_disabled', this);
    this.events.emit('map_freed', this);
  }

  clear() {
    this.events.clear();
  }

  //############################################################################
  //### CONVERT/MIGRATION
  //############################################################################
  /**
   * Import data from panel
   */
  import(obj: any): this {
    if (!!obj.metadata) {
      this.data.pattern = obj.metadata;
    }

    if (!!obj.pattern) {
      this.data.pattern = obj.pattern;
    }

    if (!!obj.hidden) {
      this.data.hidden = obj.hidden;
    }
    return this;
  }

  //############################################################################
  //### ACCESSORS
  //############################################################################
  // PATTERN
  get pattern(): string {
    return this.data.pattern;
  }
  set pattern(v: string) {
    if (!v || v.length === 0 || v === this.data.pattern) {
      return;
    }
    this.data.pattern = v;
    this.change();
  }

  //HIDDEN
  set hidden(v: boolean) {
    if (v === this.data.hidden) {
      return;
    }
    this.data.hidden = v;
    this.change();
  }
  get hidden(): boolean {
    return this.data.hidden;
  }

  //############################################################################
  //### LOGICS
  //############################################################################
  getData(): MapData {
    return this.data;
  }

  getType(): TTypeMap {
    return this.type;
  }

  setOptions(options: TRuleMapOptions): this {
    this.options = options;
    return this;
  }

  getOptions(): TRuleMapOptions {
    return this.options;
  }

  setPattern(xcell: XCell) {
    const result = xcell.getDefaultValues(this.options);
    if (Array.isArray(result)) {
      this.pattern = result[0];
    } else {
      this.pattern = result;
    }
  }

  static getDefaultMethods() {
    return this.methods;
  }

  static getDefaultPlaceHolder(value: string): string | undefined {
    const elt = this.methods.find((x) => x.value === value);
    if (elt !== undefined) {
      return elt.placeholder;
    }
    return undefined;
  }

  static getDefaultValue(value: string): string | undefined {
    const elt = this.methods.find((x) => x.value === value);
    if (elt !== undefined) {
      return elt.default;
    }
    return undefined;
  }

  /**
   * Return if text match pattern
   */
  match(
    text: string | null,
    options: TRuleMapOptions = Rule.getDefaultMapOptions(),
    variables?: TextInterpolator
  ): boolean {
    let pattern = this.data.pattern;
    if (variables !== undefined) {
      pattern = variables.replaceText(pattern);
    }
    if (text === undefined || text === null || text.length === 0) {
      return false;
    }
    return matchString(text, pattern, options.enableRegEx);
  }

  enableMapping(bool = true) {
    this.onMapping = bool;
    this.gf.setMappingCallBack(this.setPattern.bind(this));
  }

  /**
   * Export current data
   */
  export(): TDefObjMapData {
    return {
      pattern: this.data.pattern,
      hidden: this.data.hidden,
    };
  }
  //############################################################################
  //### EVENTS
  //############################################################################
  private _on_global_mapping_disabled() {
    _log('📬', this.constructor.name, '_on_global_mapping_disabled');
    this.onMapping = false;
  }
}

/**
 * ShapeMap class for mapping
 * @class ShapeMap
 * @extends GFMap
 */
export class ShapeMap extends GFMap<TShapeMapData> {
  protected _setType() {
    this.type = 'shape';
  }
  //############################################################################
  //### ACCESSORS
  //############################################################################
  set condition(v: TColorOnKeys) {
    if (!v || v.length === 0 || v === this.data.colorOn) {
      return;
    }
    this.data.colorOn = v;
    this.change();
  }
  get condition(): TColorOnKeys {
    return this.data.colorOn;
  }

  set style(v: TStyleColorKeys) {
    if (!v || v.length === 0 || v === this.data.style) {
      return;
    }
    this.data.style = v;
    this.change();
  }
  get style(): TStyleColorKeys {
    return this.data.style;
  }

  //############################################################################
  //### LOGIC
  //############################################################################
  static getDefaultData(): TShapeMapData {
    return {
      pattern: '',
      hidden: false,
      style: 'fillColor',
      colorOn: 'a',
    };
  }

  /**
   * Return true or false for condition to colorize
   * 0.7.0 : Moved to shape
   */
  isEligible(level: number): boolean {
    if (level === -1) {
      return false;
    }
    if (this.data.colorOn === 'n') {
      return false;
    }
    if (this.data.colorOn === 'a') {
      return true;
    }
    if (this.data.colorOn === 'wc' && level >= 1) {
      return true;
    }
    return false;
  }

  import(obj: any): this {
    super.import(obj);
    if (!!obj.style) {
      this.data.style = obj.style;
    }
    if (!!obj.colorOn) {
      this.data.colorOn = obj.colorOn;
    }
    return this;
  }
}

/**
 * TextMap class for mapping
 * @class TextMap
 * @extends GFMap
 */
export class TextMap extends GFMap<TTextMapData> {
  protected _setType() {
    this.type = 'text';
  }

  //############################################################################
  //### ACCESSORS
  //############################################################################
  set condition(v: TTextOnKeys) {
    if (!v || v.length === 0 || v === this.data.textOn) {
      return;
    }
    this.data.textOn = v;
    this.change();
  }
  get condition(): TTextOnKeys {
    return this.data.textOn;
  }

  set method(v: TTextMethodKeys) {
    if (!v || v.length === 0 || v === this.data.textReplace) {
      return;
    }
    this.data.textReplace = v;
    this.change();
  }
  get method(): TTextMethodKeys {
    return this.data.textReplace;
  }

  set textToReplace(v: string) {
    if (!v || v.length === 0 || v === this.data.textPattern) {
      return;
    }
    this.data.textPattern = v;
    this.change();
  }
  get textToReplace(): string {
    return this.data.textPattern;
  }

  //############################################################################
  //### LOGIC
  //############################################################################
  static getDefaultData(): TTextMapData {
    return {
      pattern: '',
      hidden: false,
      textReplace: 'content',
      textPattern: '/.*/',
      textOn: 'wmd',
    };
  }

  /**
   * Return true or false for condition to change label
   */
  isEligible(level: number): boolean {
    if (this.data.textOn === 'wmd') {
      return true;
    }
    if (this.data.textOn === 'n') {
      return false;
    }
    if (this.data.textOn === 'wc' && level >= 1) {
      return true;
    }
    if (this.data.textOn === 'co' && level >= 2) {
      return true;
    }
    return false;
  }

  import(obj: any): this {
    super.import(obj);
    if (!!obj.textReplace) {
      this.data.textReplace = obj.textReplace;
    }
    if (!!obj.textPattern) {
      this.data.textPattern = obj.textPattern;
    }
    if (!!obj.textOn) {
      this.data.textOn = obj.textOn;
    }

    return this;
  }

  /**
   * Replace text according text options
   */
  getReplaceText(text: string, FormattedValue: string): string {
    if (this.data.textReplace === 'content') {
      return FormattedValue;
    }
    if (this.data.textReplace === 'pattern') {
      const regexVal = stringToRegEx(this.data.textPattern);
      if (regexVal && text.toString().match(regexVal)) {
        return text.toString().replace(regexVal, FormattedValue);
      }
      return text;
    }
    if (this.data.textReplace === 'as') {
      return `${text} ${FormattedValue}`;
    }
    if (this.data.textReplace === 'anl') {
      return `${text}\n${FormattedValue}`;
    }
    return text;
  }
}

/**
 * LinkMap class for mapping
 * @class LinkMap
 * @extends GFMap
 */
export class LinkMap extends GFMap<TlinkMapData> {
  protected _setType() {
    this.type = 'link';
  }

  //############################################################################
  //### ACCESSORS
  //############################################################################
  set condition(v: TLinkOnKeys) {
    if (!v || v.length === 0 || v === this.data.linkOn) {
      return;
    }
    this.data.linkOn = v;
    this.change();
  }
  get condition(): TLinkOnKeys {
    return this.data.linkOn;
  }

  set url(v: string) {
    if (!v || v.length === 0 || v === this.data.linkUrl) {
      return;
    }
    this.data.linkUrl = v;
    this.change();
  }
  get url(): string {
    return this.data.linkUrl;
  }

  set dasboardParams(v: boolean) {
    if (v === this.data.linkParams) {
      return;
    }
    this.data.linkParams = v;
    this.change();
  }
  get dashboardParams(): boolean {
    return this.data.linkParams;
  }

  //############################################################################
  //### LOGICS
  //############################################################################
  static getDefaultData(): TlinkMapData {
    return {
      pattern: '',
      hidden: false,
      linkUrl: '',
      linkParams: false,
      linkOn: 'a',
    };
  }

  /**
   * Get defined link
   */
  getLink() {
    if (this.data.linkParams) {
      return this.data.linkUrl + window.location.search;
    }
    return this.data.linkUrl;
  }

  import(obj: any): this {
    super.import(obj);
    if (!!obj.linkUrl) {
      this.data.linkUrl = obj.linkUrl;
    }
    if (!!obj.linkParams) {
      this.data.linkParams = obj.linkParams;
    }
    if (!!obj.linkOn) {
      this.data.linkOn = obj.linkOn;
    }
    return this;
  }

  /**
   * Return true or false for condition to add/replace link
   */
  isEligible(level: number): boolean {
    if (this.data.linkOn === 'a') {
      return true;
    }
    if (this.data.linkOn === 'wc' && level >= 1) {
      return true;
    }
    return false;
  }
}

export class EventMap extends GFMap<TEventMapData> {
  static methods = GFCONSTANT.EVENTMETHODS;
  validComp: TEventComparator[] = ['lt', 'le', 'eq', 'ne', 'ge', 'gt', 'al'];
  static shapes: string[] = [];

  protected _setType() {
    this.type = 'event';
  }

  //############################################################################
  //### ACCESSORS
  //############################################################################
  set level(v: number) {
    if (v === this.data.eventOn) {
      return;
    }
    this.data.eventOn = v;
  }
  get level(): number {
    return this.data.eventOn;
  }

  set comparator(v: TEventComparator) {
    if (!v || v.length === 0 || v === this.data.comparator) {
      return;
    }
    this.data.comparator = v;
    this.change();
  }
  get comparator(): TEventComparator {
    return this.data.comparator as TEventComparator;
  }

  set animation(v: TTypeEventKeys) {
    if (!v || v.length === 0 || v === this.data.style) {
      return;
    }
    this.data.style = v;
    this.change();
  }
  get animation() {
    return this.data.style;
  }

  set value(v: string) {
    if (!v || v.length === 0 || v === this.data.value) {
      return;
    }
    this.data.value = v;
    this.change();
  }
  get value() {
    return this.data.value;
  }

  //############################################################################
  //### LOGIC
  //############################################################################
  static getDefaultData(): TEventMapData {
    return {
      pattern: '',
      hidden: false,
      style: 'shape',
      comparator: 'eq',
      eventOn: 0,
      value: '',
    };
  }

  getPlaceHolder(): string {
    const ph = EventMap.getDefaultPlaceHolder(this.data.style);
    return ph !== undefined ? ph : '';
  }

  isValidComp(comp: TEventComparator): boolean {
    return this.validComp.indexOf(comp) !== -1;
  }

  getTypeahead(): string[] {
    const self = this;
    let result = this.gf.getFullAvailableVarNames();
    const elt = EventMap.methods.find((x) => x.value === self.data.style) as TTypeEventElt | undefined;
    if (elt !== undefined && elt.typeahead !== undefined) {
      result = result.concat(elt.typeahead.split('|'));
      return result;
    }
    if (this.data.style === 'shape') {
      const shapes = this.getFormNames();
      Array.prototype.push.apply(result, shapes);
    }
    return result;
  }

  getValueByDefault(): string {
    const vbd = EventMap.getDefaultValue(this.data.style);
    return vbd !== undefined ? vbd : '';
  }

  getFormNames(): string[] {
    // Shape-name typeahead source. The legacy engine lazily read `shapes.txt`
    // via a synchronous `$GF.utils.loadFile`; the React scaffold has no sync
    // file read, so the already-populated cache is returned and the editor
    // (Task 10) is responsible for loading the list asynchronously. Matching
    // logic does not depend on this list.
    return EventMap.shapes;
  }

  /**
   * Return true or false for condition to colorize
   * 0.7.0 : Moved to shape
   */
  isEligible(level: number): boolean {
    switch (this.data.comparator) {
      case 'al':
        return true;
      case 'lt':
        return level < this.data.eventOn;
      case 'le':
        return level <= this.data.eventOn;
      case 'eq':
        return level === this.data.eventOn;
      case 'ne':
        return level !== this.data.eventOn;
      case 'ge':
        return level >= this.data.eventOn;
      case 'gt':
        return level > this.data.eventOn;
      default:
        return this.data.eventOn === -1 || level === this.data.eventOn;
    }
  }

  import(obj: any): this {
    super.import(obj);
    if (!!obj.style) {
      this.data.style = obj.style;
    }
    if (!!obj.comparator) {
      this.data.comparator = obj.comparator;
    }

    if (!!obj.eventOn) {
      this.data.eventOn = obj.eventOn;
      if (this.data.eventOn === -1) {
        this.data.comparator = 'al';
        this.data.eventOn = 0;
      }
    }
    if (!!obj.value) {
      this.data.value = obj.value;
    }
    return this;
  }
}

class VMAP<VMAPType extends { text: string | undefined; hidden: boolean }> {
  data: VMAPType;
  uid: string = genUid(this.constructor.name);
  reduce = true;
  events: GFEvents<MappingSignals> = GFEvents.create(mappingSignalsArray);
  constructor(data: VMAPType) {
    this.data = data;
    this.init();
  }

  //############################################################################
  //### INIT/UPDATE/CHANGE/FREE
  //############################################################################
  init(): void {
    this.events.emit('map_initalized', this);
  }

  change(): void {
    this.events.emit('map_changed', this);
  }

  free(): void {
    this.events.clear();
    this.events.emit('map_freed', this);
  }

  //############################################################################
  //### ACCESSORS GETTERS/SETTERS
  //############################################################################
  set hidden(v: boolean) {
    if (v !== this.data.hidden) {
      this.data.hidden = v;
      this.change();
    }
  }
  get hidden(): boolean {
    return this.data.hidden;
  }

  set text(v: string) {
    if (v !== this.data.text) {
      this.data.text = v.trim();
      this.change();
    }
  }
  get text(): string {
    return this.data.text ?? '';
  }

  //############################################################################
  //### LOGICS
  //############################################################################
  import(obj: any): this {
    if (!!obj.text) {
      this.data.text = obj.text;
    }
    return this;
  }

  getData(): VMAPType {
    return this.data;
  }
}

export class ValueMap extends VMAP<TValueMapData> {
  constructor(value = '', text = '', data: TValueMapData) {
    super(data);
    this.data.value = value;
    this.data.text = text;
    this.import(data);
  }

  //############################################################################
  //### ACCESSORS
  //############################################################################
  get value(): string {
    return this.data.value ?? '';
  }
  set value(v: string) {
    if (v !== this.data.value) {
      this.data.value = v;
      this.change();
    }
  }

  //############################################################################
  //### LOGICS
  //############################################################################
  static getDefaultdata(): TValueMapData {
    return {
      value: undefined,
      text: undefined,
      hidden: false,
    };
  }

  import(obj: any): this {
    this.data.value = obj.value || this.data.value || undefined;
    this.data.text = obj.text || this.data.text || undefined;
    this.data.hidden = obj.hidden || this.data.hidden || false;
    return this;
  }

  /**
   * Match value with datas
   */
  match(value: any): boolean {
    if (value === null || value === undefined) {
      if (this.data.value === 'null') {
        return true;
      }
      return false;
    }

    if (!(typeof value === 'string') && Number(this.data.value) === Number(value)) {
      return true;
    }
    return matchString(value.toString(), this.data.value);
  }

  /**
   * Get formatted value
   */
  getFormattedText(value: any): string {
    if (value === null || value === undefined) {
      if (this.data.value === 'null' || this.data.value === 'undefined') {
        return !!this.data.text ? this.data.text : '';
      }
    }
    if (this.match(value)) {
      return !!this.data.text ? this.data.text : '';
    }
    return `${value}`;
  }
}

export class RangeMap extends VMAP<TRangeMapData> {
  reduce = true;
  uid: string;
  constructor(from = '', to = '', text = '', data: TRangeMapData) {
    super(data);
    this.uid = genUid();
    this.data = data;
    this.data.from = from;
    this.data.to = to;
    this.data.text = text;
    this.data.hidden = false;
  }

  //############################################################################
  //### ACCESSORS
  //############################################################################
  get to(): string {
    return this.data.to ?? '';
  }
  set to(v: string) {
    if (v !== this.data.to) {
      this.data.to = v;
      this.change();
    }
  }
  get from(): string {
    return this.data.from ?? '';
  }
  set from(v: string) {
    if (v !== this.data.from) {
      this.data.from = v;
      this.change();
    }
  }

  //############################################################################
  //### LOGICS
  //############################################################################
  import(obj: any): this {
    this.data.from = !!obj.from ? obj.from : undefined;
    this.data.to = !!obj.to ? obj.to : undefined;
    this.data.text = !!obj.text ? obj.text : undefined;
    this.data.hidden = !!obj.hidden || obj.hidden === false ? obj.hidden : false;
    return this;
  }

  static getDefaultData(): TRangeMapData {
    return {
      from: undefined,
      to: undefined,
      text: undefined,
      hidden: false,
    };
  }

  /**
   * Match value
   */
  match(value: any): boolean {
    if (
      (value !== undefined && typeof value === 'string' && value.length > 0) ||
      (value !== undefined && typeof value === 'number')
    ) {
      let v = Number(value);
      if (
        (this.data.from !== undefined && typeof value === 'string' && this.data.from.length > 0) ||
        (this.data.from !== undefined && typeof value === 'number')
      ) {
        let from = Number(this.data.from);
        if (v >= from) {
          if (
            (this.data.to !== undefined && typeof this.data.to === 'string' && this.data.to.length > 0) ||
            (this.data.from !== undefined && typeof this.data.to === 'number')
          ) {
            let to = Number(this.data.to);
            return v < to;
          }
          return true;
        }
        return false;
      }
      // from is empty here
      if (
        (this.data.to !== undefined && typeof this.data.to === 'string' && this.data.to.length > 0) ||
        (this.data.to !== undefined && typeof this.data.to === 'number')
      ) {
        let to = Number(this.data.to);
        return v < to;
      }
      // from and to is empty
      return true;
    }
    return false;
  }

  /**
   * Return Formatted value
   */
  getFormattedText(value: any): string | undefined {
    if (this.match(value)) {
      return this.data.text;
    }
    return value;
  }
}

export class InteractiveMap {
  active = false;
  map: ObjectMap | null = null;
  xcell: XCell | null = null;
  focusId: string | null = null;
  value: string | null = null;
  options: TRuleMapOptions | null = null;
  callback: CallableFunction | null = null;
  container: HTMLDivElement | undefined;
  gf: LogicContext;
  constructor(gf: LogicContext, container?: HTMLDivElement) {
    this.gf = gf;
    this.container = container;
    this.init();
  }

  init(): this {
    this.active = false;
    this.map = null;
    this.xcell = null;
    this.focusId = null;
    this.value = null;
    this.options = null;
    this.callback = null;
    return this;
  }

  setContainer(container: HTMLDivElement): this {
    this.container = container;
    return this;
  }

  setFocus(focusId: string): this {
    this.focusId = focusId;
    return this;
  }

  setCallBack(fn: CallableFunction): this {
    this.callback = fn;
    return this;
  }

  isActive(): boolean {
    return this.active;
  }

  activate(): this {
    if (this.container) {
      this.container.style.cursor = `url("${GFPaths.getStaticPath()}cursor-marker.svg") 8 16, crosshair`;
      this.container.scrollIntoView();
      this.container.focus();
    }
    this.active = true;
    return this;
  }

  setOptions(options: TRuleMapOptions): this {
    this.options = options;
    return this;
  }

  getOptions(): TRuleMapOptions | null {
    return this.options;
  }

  setXCell(xcell: XCell): this {
    this.xcell = xcell;
    return this;
  }

  getXCell(): XCell | null {
    return this.xcell;
  }

  getMap(): ObjectMap | null {
    return this.map;
  }

  setMap(map: ObjectMap): this {
    this.map = map;
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  valide(): this {
    if (this.map !== null && this.value !== null) {
      this.map.pattern = this.value;
    }
    if (this.callback !== null) {
      this.callback(this.xcell);
    }
    if (this.focusId !== null) {
      this.gf.setFocus(this.focusId);
    }
    this.close();
    return this;
  }

  close(): this {
    if (this.container) {
      this.container.style.cursor = 'auto';
    }
    this.init();
    return this;
  }
}
