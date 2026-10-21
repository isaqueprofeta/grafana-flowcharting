/**
 * rule — the Rule domain class, ported **as-is (logic)** from the legacy
 * `src/rule_class.ts` (design.md: Logic_Layer, "rule_class: as-is logic, import
 * swaps", Req 4.1, 4.2, 4.3, 4.4).
 *
 * The threshold level-selection, color/gradient computation, metric matching,
 * value formatting, map authoring, and `_convert` migration are all preserved
 * verbatim. Only the imports are swapped:
 *   - `$GF.genUid`                 -> `genUid`                 (logic/globals)
 *   - `$GF.matchString`            -> `matchString`            (logic/logicHelpers)
 *   - `$GF.calculate*ForRatio/Value` -> logic/logicHelpers equivalents
 *   - `$GF.setFocus`               -> `gf.setFocus`            (seam)
 *   - `$gf: $GF`                   -> `gf: LogicContext`       (Context_Seam)
 *   - `$gf.notify/metricHandler/rulesHandler/setMappingCallBack` -> seam members
 *   - `grafana.formatValue`        -> `getValueFormat(unit)`   (@grafana/data, Req 3.5)
 *   - `grafana.getFormatedDate`    -> `dateTime().format()`    (@grafana/data, Req 3.6)
 *   - lodash `isFinite`/`isArray`  -> native `Number.isFinite`/`Array.isArray`
 *   - `gf.*` data types            -> exported interfaces from `logic/legacyTypes`
 *   - `State`/`ObjectMetric`       -> forward-declared `logic/engineRefs` shapes
 *                                     (concrete types land in Tasks 7 / 5)
 *
 * No `$GF`, `$scope`, Angular, `globalThis`, or `mx*` global mutation.
 */
import { dateTime, getValueFormat } from '@grafana/data';
import { GFEvents } from './flowchartingBase';
import { GFLog, genUid } from './globals';
import { calculateColorForRatio, calculateRatioForValue, calculateValueForRatio, matchString } from './logicHelpers';
import type { LogicContext } from './logicContext';
import type { ObjectMetric, State } from './engineRefs';
import { NumberTH, StringTH, DateTH, type ObjectTH, type ObjectTHData } from './threshold';
import {
  EventMap,
  ShapeMap,
  TextMap,
  LinkMap,
  ValueMap,
  RangeMap,
  type ObjectMap,
  type DataMap,
  type ShapeMapArray,
} from './mapping';
import type {
  TAggregationKeys,
  TColorOnKeys,
  TDateFormatKeys,
  TDirectionKeys,
  TGraphScaleKeys,
  TGraphSizeKeys,
  TGraphTypeKeys,
  TIRuleData,
  TLinkOnKeys,
  TMetricTypeKeys,
  TRuleMapData,
  TRuleMapOptions,
  TRuleMaps,
  TShapeMapData,
  TStyleColorKeys,
  TTextMapData,
  TTextMethodKeys,
  TTextOnKeys,
  TlinkMapData,
  TTooltipOnKeys,
  TTypeMap,
  TValueMapData,
  TValueTypeKeys,
} from './legacyTypes';

/** Numeric formatting ported off the legacy `grafana_func`, onto `@grafana/data`. */
function formatValue(value: any, unit: string, decimals: any): string {
  const fmt = getValueFormat(unit);
  const result = fmt(value, decimals);
  return `${result.prefix ?? ''}${result.text}${result.suffix ?? ''}`;
}

/** Date formatting ported off the legacy `grafana_func`, onto `@grafana/data`. */
function getFormatedDate(value: any, format: any): string {
  return dateTime(value).format(format);
}

// Debug
const DEBUG = false;
const _log = (...args: any) => {
  DEBUG && console.log(...args);
};

// Signal definition
const ruleSignalsArray = ['rule_initalized', 'rule_updated', 'rule_changed', 'rule_freed'] as const;
type RuleSignals = typeof ruleSignalsArray[number];

/**
 * Rule definition
 *
 * @export
 * @class Rule
 */
export class Rule {
  gf: LogicContext;
  data: TIRuleData;
  initialized = false;
  metrics: Map<string, ObjectMetric> = new Map();
  mapsObj: TRuleMaps = {
    shapes: [],
    texts: [],
    links: [],
    events: [],
  };
  valueMaps: ValueMap[] = [];
  rangeMaps: RangeMap[] = [];
  numberTH: NumberTH[] = [];
  stringTH: StringTH[] = [];
  dateTH: DateTH[] = [];
  FE_metricName: string | undefined;
  uid: string;
  removeClick = 2;
  states: Map<string, State> = new Map();
  shapeStates: Map<string, State> = new Map();
  textStates: Map<string, State> = new Map();
  linkStates: Map<string, State> = new Map();
  eventStates: Map<string, State> = new Map();
  highestLevel = -1;
  highestColor = '';
  highestFormattedValue = '';
  highestValue: any = undefined;
  execTimes = 0;
  events: GFEvents<RuleSignals> = GFEvents.create(ruleSignalsArray);

  /**
   * Creates an instance of Rule.
   */
  constructor(gf: LogicContext, pattern: string, newData: TIRuleData, oldData?: any) {
    this.gf = gf;
    this.uid = genUid(this.constructor.name);
    this.data = newData;
    this.data.pattern = pattern;
    if (oldData) {
      this._convert(oldData);
    }
    this.init();
    //TODO : needed ?
    this.change();
  }
  //############################################################################
  //### INIT/UPDATE/CHANGE/FREE
  //############################################################################

  update() {
    this.initCycle();
    this.events.emit('rule_updated', this);
    return this;
  }

  init() {
    this._eventsConnect();
    this.events.emit('rule_initalized', this);
    return this;
  }

  private _eventsConnect() {
    this.gf?.metricHandler?.events.connect('metric_created', this, this._on_metricHandler_metric_created.bind(this));
    this.gf?.metricHandler?.events.connect('metric_deleted', this, this._on_metricHandler_metric_deleted.bind(this));
    return this;
  }

  private _eventsDisconnect() {
    this.gf?.metricHandler?.events.connect('metric_created', this, this._on_metricHandler_metric_created.bind(this));
    this.gf?.metricHandler?.events.connect('metric_deleted', this, this._on_metricHandler_metric_deleted.bind(this));
    this.getThresholds().map(async (th) => {
      th.events.disconnect('threshold_changed', this);
    });
    return this;
  }

  change() {
    this.events.emit('rule_changed', this);
    return this;
  }

  async free() {
    await this.events.emit('rule_freed', this);
    this._eventsDisconnect();
    this.events.clear();
    return this;
  }

  clear(): this {
    this.shapeStates.clear();
    this.textStates.clear();
    this.linkStates.clear();
    return this;
  }

  //############################################################################
  //### ACCESSORS
  //############################################################################
  set reduce(v: boolean) {
    if (this.data.reduce !== v) {
      this.data.reduce = v;
    }
  }
  get reduce() {
    return this.data.reduce;
  }

  // NAME
  set name(v: string) {
    if (!v || v.length === 0 || v === this.data.alias) {
      return;
    }
    const exist = this.gf.rulesHandler?.getRule(v);
    if (exist) {
      this.gf.notify(`Rule with name ${v} already exit`, 'error');
    } else {
      this.data.alias = v;
    }
  }
  get name() {
    return this.data.alias;
  }

  //METRIC
  set metric(v: string) {
    if (!v && v.length === 0) {
      return;
    }
    const m = v.split('/');
    const length = m.length;
    if (this.gf.metricHandler?.isMultipleType()) {
      if (length === 3) {
        if (m[0] === 'Tables') {
          this.data.metricType = 'table';
          this.data.refId = m[1];
          this.data.column = m[2];
        } else {
          this.gf.notify('Invalid name metric : ' + v, 'error');
          return;
        }
      } else if (length === 2) {
        if (m[0] === 'Series') {
          this.data.metricType = 'serie';
          this.data.pattern = m[1];
        } else {
          this.gf.notify('Invalid name metric : ' + v, 'error');
          return;
        }
      } else {
        this.gf.notify('Invalid name metric : ' + v, 'error');
        return;
      }
    } else if (this.gf.metricHandler?.isTypeOf('serie')) {
      this.data.metricType = 'serie';
      this.data.pattern = m[0];
    } else if (this.gf.metricHandler?.isTypeOf('table')) {
      this.data.metricType = 'table';
      this.data.refId = m[0];
      this.data.column = m[1];
    } else {
      this.gf.notify('Invalid name metric : ' + v, 'error');
      return;
    }
    this.change();
  }
  get metric() {
    let result = '';
    if (this.gf.metricHandler?.isMultipleType()) {
      if (this.data.metricType === 'serie') {
        result += 'Series/' + this.data.pattern;
      } else {
        result += 'Tables/' + this.data.refId + '/' + this.data.column;
      }
    } else {
      if (this.gf.metricHandler?.isTypeOf('serie')) {
        result = this.data.pattern;
      } else {
        result = this.data.refId + '/' + this.data.column;
      }
    }
    return result;
  }

  //METRIC TYPE
  set metricType(v: TMetricTypeKeys) {
    this.data.metricType = v;
  }
  get metricType() {
    return this.data.metricType;
  }

  //METRIC PATTERN
  set metricPattern(v: string) {
    if (!v || v.length === 0) {
      return;
    }
    if (this.metricType === 'serie') {
      if (this.data.pattern !== v) {
        this.data.pattern = v;
        this.change();
      }
    }
    if (this.metricType === 'table') {
    }
  }
  get metricPattern() {
    return this.data.pattern;
  }

  //METRIC TABLE
  set metricTable(v: string) {
    if (!v || v.length === 0 || this.data.refId === v) {
      return;
    }
    this.data.refId = v;
    this.change();
  }
  get metricTable() {
    return this.data.refId;
  }

  //METRIC COLUMN
  get metricColumn(): string {
    return this.data.column;
  }
  set metricColumn(v: string) {
    if (!v && v.length === 0 && this.data.column === v) {
      return;
    }
    this.data.column = v;
    this.change();
  }

  //HIDDEN
  set hidden(v: boolean) {
    if (this.data.hidden !== v) {
      this.data.hidden = v;
      this.change();
    }
  }
  get hidden() {
    return this.data.hidden;
  }

  // ENABLE TOOLTIP
  set tooltip(v: boolean) {
    if (this.data.tooltip !== v) {
      this.data.tooltip = v;
      this.change();
    }
  }
  get tooltip(): boolean {
    return this.data.tooltip;
  }
  // DISPLAY LABEL IN TOOLTIP
  set tooltipLabel(v: string) {
    if (this.data.tooltipLabel !== v) {
      this.data.tooltipLabel = v;
      this.change();
    }
  }
  get tooltipLabel(): string {
    return this.data.tooltipLabel;
  }
  // ENABLE TOOLTIP GRAPH
  set tooltipOn(v: TTooltipOnKeys) {
    if (!v || v.length === 0 || this.data.tooltipOn !== v) {
      this.data.tooltipOn = v;
      this.change();
    }
  }
  get tooltipOn(): TTooltipOnKeys {
    return this.data.tooltipOn;
  }
  // DISPLAY METADATA IN TOOLTIP
  set tooltipMetadata(v: boolean) {
    if (v !== this.data.tpMetadata) {
      this.data.tpMetadata = v;
      this.change();
    }
  }
  get tooltipMetadata(): boolean {
    return this.data.tpMetadata;
  }
  // COLORS TOOLTIP WITH COLOR
  set tooltipColors(v: boolean) {
    if (v !== this.data.tooltipColors) {
      this.data.tooltipColors = v;
      this.change();
    }
  }
  get tooltipColors(): boolean {
    return this.data.tooltipColors;
  }

  //GRAPH TYPE
  set tooltipForGraph(value: boolean) {
    if (this.data.tpGraph !== value) {
      this.data.tpGraph = value;
      this.change();
    }
  }
  get tooltipForGraph() {
    return this.data.tpGraph;
  }
  set graphDirection(v: TDirectionKeys) {
    if (!v || v.length === 0 || this.data.tpDirection !== v) {
      this.data.tpDirection = v;
      this.change();
    }
  }
  get graphDirection(): TDirectionKeys {
    return this.data.tpDirection;
  }

  //graphtype getter setter
  set graphType(v: TGraphTypeKeys) {
    if (!v || v.length === 0 || this.data.tpGraphType !== v) {
      this.data.tpGraphType = v;
      this.change();
    }
  }
  get graphType(): TGraphTypeKeys {
    return this.data.tpGraphType;
  }

  //graphSize getter setter
  set graphSize(v: TGraphSizeKeys) {
    if (!v || v.length === 0 || this.data.tpGraphSize !== v) {
      this.data.tpGraphSize = v;
      this.change();
    }
  }
  get graphSize(): TGraphSizeKeys {
    return this.data.tpGraphSize;
  }
  //graphLow getter setter
  set graphLow(v: number | null) {
    if (v !== this.data.tpGraphLow) {
      this.data.tpGraphLow = v;
      this.change();
    }
  }
  get graphLow(): number | null {
    return this.data.tpGraphLow;
  }
  //graphHigh getter setter
  set graphHigh(v: number | null) {
    if (v !== this.data.tpGraphHigh) {
      this.data.tpGraphHigh = v;
      this.change();
    }
  }
  get graphHigh(): number | null {
    return this.data.tpGraphHigh;
  }

  //graphScale getter setter
  set graphScale(v: TGraphScaleKeys) {
    if (!v || v.length === 0 || this.data.tpGraphScale !== v) {
      this.data.tpGraphScale = v;
      this.change();
    }
  }
  get graphScale(): TGraphScaleKeys {
    return this.data.tpGraphScale;
  }

  //AGGREGATION
  set aggregation(v: TAggregationKeys) {
    if (!v || this.data.aggregation === v) {
      return;
    }
    this.data.aggregation = v;
    this.change();
  }
  get aggregation(): TAggregationKeys {
    return this.data.aggregation;
  }

  // DATA TYPE (number, string or date)
  set dataType(v: TValueTypeKeys) {
    if (!v || this.data.type === v) {
      return;
    }
    this.data.type = v;
    this.change();
  }
  get dataType(): TValueTypeKeys {
    return this.data.type;
  }

  // DATA UNIT
  set dataUnit(v: string) {
    if (!v || v.length === 0 || this.data.type === v) {
      return;
    }
    this.data.unit = v;
    this.change();
  }
  get dataUnit(): string {
    return this.data.unit;
  }

  // DATA DECIMALS
  set dataDecimals(v: number) {
    if (!v) {
      v = 0;
    }
    if (v === this.data.decimals) {
      return;
    }
    this.data.decimals = v;
    this.change();
  }
  get dataDecimals(): number {
    return this.data.decimals;
  }

  //DATE FORMAT
  set value(v: TDateFormatKeys) {
    if (!v || v.length === 0 || this.data.dateFormat === v) {
      return;
    }
    this.data.dateFormat = v;
    this.change();
  }
  get dateFormat(): TDateFormatKeys {
    return this.data.dateFormat;
  }

  //SANITIZE
  set sanitize(v: boolean) {
    if (!v || this.data.sanitize === v) {
      return;
    }
    this.data.sanitize = v;
  }
  get sanitize() {
    return this.data.sanitize;
  }

  //getter setter mappingType
  set mappingType(v: number) {
    if (v !== this.data.mappingType) {
      this.data.mappingType = v;
      this.change();
    }
  }
  get mappingType() {
    return this.data.mappingType;
  }

  //THRESHOLDS
  //Getter setter invert
  set invert(v: boolean) {
    if (v !== this.data.invert) {
      this.data.invert = v;
      this.invertThesholdsColors();
    }
  }
  get invert() {
    return this.data.invert;
  }

  //Gradient
  set gradient(v: boolean) {
    if (v !== this.data.gradient) {
      this.data.gradient = v;
      this.change();
    }
  }
  get gradient() {
    return this.data.gradient;
  }

  //invertIcon
  set overlayIcon(v: boolean) {
    if (v !== this.data.overlayIcon) {
      this.data.overlayIcon = v;
      this.change();
    }
  }
  get overlayIcon() {
    return this.data.overlayIcon;
  }

  //############################################################################
  //### CONVERT/MIGRATION
  //############################################################################
  /**
   * import data in rule
   */
  private _convert(obj: any): this {
    if (!!obj.unit) {
      this.data.unit = obj.unit;
    }
    if (!!obj.type) {
      this.data.type = obj.type;
    }
    if (!!obj.metricType) {
      this.data.metricType = obj.metricType;
    }
    if (!!obj.alias) {
      this.data.alias = obj.alias;
    }
    if (!!obj.refId) {
      this.data.refId = obj.refId;
    }
    if (!!obj.column) {
      this.data.column = obj.column;
    }
    if (!!obj.aggregation) {
      this.data.aggregation = obj.aggregation;
    }
    if (!!obj.decimals || obj.decimals === 0) {
      this.data.decimals = obj.decimals;
    }

    if (!!this.data.reduce) {
      this.data.reduce = true;
    }

    // 0.7.0
    let colorOn: TColorOnKeys | undefined = undefined;
    if (!!obj.colorOn) {
      colorOn = obj.colorOn;
    }

    // 0.7.0
    let style: TStyleColorKeys | undefined = undefined;
    if (!!obj.style) {
      style = obj.style;
    }

    // 0.7.0
    let link = false;
    let linkUrl: string | undefined = undefined;
    let linkParams: boolean | undefined = undefined;
    if (!!obj.link) {
      link = obj.link;
    }
    if (!!obj.linkUrl) {
      linkUrl = obj.linkUrl;
    }
    if (!!obj.linkParams) {
      linkParams = obj.linkParams;
    }

    // 0.7.0
    let linkOn: TLinkOnKeys | undefined = undefined;
    if (!!obj.linkOn) {
      linkOn = obj.linkOn;
    }

    // 0.7.0
    let textOn: TTextOnKeys | undefined = undefined;
    if (!!obj.textOn) {
      textOn = obj.textOn;
    }

    // 0.7.0
    let textReplace: TTextMethodKeys | undefined = undefined;
    let textPattern: string | undefined = undefined;
    if (!!obj.textReplace) {
      textReplace = obj.textReplace;
    }
    if (!!obj.textPattern) {
      textPattern = obj.textPattern;
    }
    if (!!obj.pattern) {
      this.data.pattern = obj.pattern;
    }

    if (!!obj.dateColumn) {
      this.data.dateColumn = obj.dateColumn;
    }

    if (!!obj.dateFormat) {
      this.data.dateFormat = obj.dateFormat;
    }
    // TODO : Find best method to connect to events
    /******* BEGIN THRESHOLD NUMBER **********/
    this.data.numberTHData = [];
    this.numberTH = [];
    if (!!obj.thresholds && !!obj.colors) {
      let i = 0;
      let j = 0;
      obj.colors.forEach((cl: string | undefined) => {
        if (i === 0) {
          this._addNumberThreshold(i++, cl).events.connect(
            'threshold_changed',
            this,
            this._on_TH_threshold_changed.bind(this)
          );
        } else {
          let th = obj.thresholds[j++];
          if (typeof th === 'string' && th.length > 0) {
            th = parseFloat(th);
          }
          this._addNumberThreshold(i++, cl, th).events.connect(
            'threshold_changed',
            this,
            this._on_TH_threshold_changed.bind(this)
          );
        }
      });
    } else {
      if (!!obj.numberTHData) {
        let th: any[] = obj.numberTHData;
        if (th !== undefined && th != null && th.length > 0) {
          th.forEach((thdata: any) => {
            this._addNumberThreshold()
              .import(thdata)
              .events.connect('threshold_changed', this, this._on_TH_threshold_changed.bind(this));
          });
        }
      }
    }
    if (this.numberTH.length === 0) {
      this._addNumberThreshold(0, 'rgba(245, 54, 54, 0.9)', 0).events.connect(
        'threshold_changed',
        this,
        this._on_TH_threshold_changed.bind(this)
      );
      this._addNumberThreshold(1, 'rgba(237, 129, 40, 0.89)', 50).events.connect(
        'threshold_changed',
        this,
        this._on_TH_threshold_changed.bind(this)
      );
      this._addNumberThreshold(2, 'rgba(50, 172, 45, 0.97)', 80).events.connect(
        'threshold_changed',
        this,
        this._on_TH_threshold_changed.bind(this)
      );
    }
    /******* END THRESHOLD NUMBER **********/

    /******* BEGIN THRESHOLD STRING **********/
    let stringTH: any = [];
    this.data.stringTHData = [];
    this.stringTH = [];
    if (!!obj.stringThresholds) {
      stringTH = obj.stringThresholds.slice(0);
    }
    if (!!obj.stringWarning) {
      stringTH[1] = obj.stringWarning;
    }
    if (!!obj.stringCritical) {
      stringTH[0] = obj.stringCritical;
    }
    if (!!stringTH && obj.colors) {
      let i = 0;
      let j = 0;
      obj.colors.forEach((cl: string | undefined) => {
        if (i === 0) {
          this._addStringThreshold(i++, cl).events.connect(
            'threshold_changed',
            this,
            this._on_TH_threshold_changed.bind(this)
          );
        } else {
          let th = stringTH[j++];
          if (typeof th === 'number') {
            th = th.toString();
          }
          this._addStringThreshold(i++, cl, th).events.connect(
            'threshold_changed',
            this,
            this._on_TH_threshold_changed.bind(this)
          );
        }
      });
    } else {
      if (obj.stringTHData) {
        let th: any[] = obj.stringTHData;
        if (th !== undefined && th != null && th.length > 0) {
          th.forEach((thdata: any) => {
            this._addStringThreshold()
              .import(thdata)
              .events.connect('threshold_changed', this, this._on_TH_threshold_changed.bind(this));
          });
        }
      }
    }

    if (this.stringTH.length === 0) {
      this._addStringThreshold(0, 'rgba(245, 54, 54, 0.9)', '/.*/').events.connect(
        'threshold_changed',
        this,
        this._on_TH_threshold_changed.bind(this)
      );
      this._addStringThreshold(1, 'rgba(237, 129, 40, 0.89)', '/.*warning.*/').events.connect(
        'threshold_changed',
        this,
        this._on_TH_threshold_changed.bind(this)
      );
      this._addStringThreshold(2, 'rgba(50, 172, 45, 0.97)', '/.*(success|ok).*/').events.connect(
        'threshold_changed',
        this,
        this._on_TH_threshold_changed.bind(this)
      );
    }
    /******* END THRESHOLD STRING **********/

    /******* BEGIN THRESHOLD DATE **********/
    if (this.dateTH.length === 0) {
      this._addDateThreshold(0, 'rgba(245, 54, 54, 0.9)', '0d').events.connect(
        'threshold_changed',
        this,
        this._on_TH_threshold_changed.bind(this)
      );
      this._addDateThreshold(1, 'rgba(237, 129, 40, 0.89)', '-1d').events.connect(
        'threshold_changed',
        this,
        this._on_TH_threshold_changed.bind(this)
      );
      this._addDateThreshold(2, 'rgba(50, 172, 45, 0.97)', '-1w').events.connect(
        'threshold_changed',
        this,
        this._on_TH_threshold_changed.bind(this)
      );
    }
    /******* END THRESHOLD DATE **********/

    if (!!obj.invert || obj.invert === false) {
      this.data.invert = obj.invert;
    }

    if (!!obj.gradient || obj.gradient === false) {
      this.data.gradient = obj.gradient;
    }

    if (!!obj.overlayIcon || obj.overlayIcon === false) {
      this.data.overlayIcon = obj.overlayIcon;
    }
    if (!!obj.tooltip || obj.tooltip === false) {
      this.data.tooltip = obj.tooltip;
    }
    if (!!obj.tooltipLabel) {
      this.data.tooltipLabel = obj.tooltipLabel;
    }
    if (!!obj.tooltipColors || obj.tooltipColors === false) {
      this.data.tooltipColors = obj.tooltipColors;
    }
    if (!!obj.tooltipOn) {
      this.data.tooltipOn = obj.tooltipOn;
    }
    if (!!obj.tpDirection) {
      this.data.tpDirection = obj.tpDirection;
    }
    if (!!obj.tpMetadata) {
      this.data.tpMetadata = obj.tpMetadata;
    }
    if (!!obj.tpGraph || this.data.tpGraph === false) {
      this.data.tpGraph = obj.tpGraph;
    }
    if (!!obj.tpGraphSize) {
      this.data.tpGraphSize = obj.tpGraphSize;
    }
    if (!!obj.tpGraphType) {
      this.data.tpGraphType = obj.tpGraphType;
    }
    if (!!obj.tpGraphLow || obj.tpGraphLow === 0) {
      this.data.tpGraphLow = obj.tpGraphLow;
    }
    if (!!obj.tpGraphHigh || obj.tpGraphHigh === 0) {
      this.data.tpGraphHigh = obj.tpGraphHigh;
    }
    if (!!obj.tpGraphScale) {
      this.data.tpGraphScale = obj.tpGraphScale;
    }
    let maps: any = [];

    // SHAPES
    // <= 0.9.0
    if (!!obj.shapeProp) {
      this.data.mapsDat.shapes.options.identByProp = obj.shapeProp;
    }
    if (!!obj.shapeRegEx || obj.shapeRegEx === false) {
      this.data.mapsDat.shapes.options.enableRegEx = obj.shapeRegEx;
    }

    // 1.0.0
    if (!!obj.mapsDat) {
      if (!!obj.mapsDat.shapes) {
        this.data.mapsDat.shapes.options.identByProp =
          obj.mapsDat.shapes.options.identByProp !== undefined
            ? obj.mapsDat.shapes.options.identByProp
            : this.data.mapsDat.shapes.options.identByProp;
        this.data.mapsDat.shapes.options.enableRegEx = obj.mapsDat.shapes.options.enableRegEx;
        this.data.mapsDat.shapes.options.metadata = obj.mapsDat.shapes.options.metadata;
      }
    }

    maps = [];
    this.data.mapsDat.shapes.dataList = [];
    if (obj.shapeMaps !== undefined && obj.shapeMaps !== null) {
      // For 0.2.0
      maps = obj.shapeMaps;
    } else {
      // < 0.9.0
      if (obj.shapeData !== undefined && obj.shapeData !== null) {
        maps = obj.shapeData;
      } else {
        // 1.0.0
        maps = obj.mapsDat.shapes.dataList;
      }
    }

    if (maps !== undefined && maps !== null && maps.length > 0) {
      maps.forEach((shapeData: TShapeMapData) => {
        // 0.7.0
        if (!!style) {
          shapeData.style = style;
        }

        // 0.7.0
        if (!!colorOn) {
          shapeData.colorOn = colorOn;
        }
        this.addShapeMap().import(shapeData);
      });
    }

    // TEXT
    if (!!obj.textProp) {
      this.data.mapsDat.texts.options.identByProp = obj.textProp;
    }

    if (!!obj.textRegEx || obj.textRegEx === false) {
      this.data.mapsDat.texts.options.enableRegEx = obj.textRegEx;
    }

    if (!!obj.mapsDat) {
      if (!!obj.mapsDat.texts) {
        this.data.mapsDat.texts.options.identByProp =
          obj.mapsDat.texts.options.identByProp !== undefined
            ? obj.mapsDat.texts.options.identByProp
            : this.data.mapsDat.texts.options.identByProp;
        this.data.mapsDat.texts.options.enableRegEx = obj.mapsDat.texts.options.enableRegEx;
        this.data.mapsDat.texts.options.metadata = obj.mapsDat.texts.options.metadata;
      }
    }

    maps = [];
    this.data.mapsDat.texts.dataList = [];
    if (obj.textMaps !== undefined && obj.textMaps !== null) {
      // For 0.2.0
      maps = obj.textMaps;
    } else {
      // 0.9.1
      if (obj.textData !== undefined && obj.textData !== null) {
        maps = obj.textData;
      } else {
        maps = obj.mapsDat.texts.dataList;
      }
    }

    if (maps !== undefined && maps != null && maps.length > 0) {
      maps.forEach((textData: TTextMapData) => {
        // 0.7.0
        if (!!textReplace) {
          textData.textReplace = textReplace;
        }
        if (!!textPattern) {
          textData.textPattern = textPattern;
        }
        if (!!textOn) {
          textData.textOn = textOn;
        }

        this.addTextMap().import(textData);
      });
    }

    // LINK
    if (!!obj.linkProp) {
      this.data.mapsDat.links.options.identByProp = obj.linkProp;
    }

    if (!!obj.linkRegEx || obj.linkRegEx === false) {
      this.data.mapsDat.links.options.enableRegEx = obj.linkRegEx;
    }

    if (!!obj.mapsDat) {
      if (!!obj.mapsDat.links) {
        this.data.mapsDat.links.options.identByProp =
          obj.mapsDat.links.options.identByProp !== undefined
            ? obj.mapsDat.links.options.identByProp
            : this.data.mapsDat.links.options.identByProp;
        this.data.mapsDat.links.options.enableRegEx = obj.mapsDat.links.options.enableRegEx;
        this.data.mapsDat.links.options.metadata = obj.mapsDat.links.options.metadata;
      }
    }

    this.data.mapsDat.links.dataList = [];
    maps = [];
    if (obj.linkMaps !== undefined && obj.linkMaps !== null) {
      // For 0.2.0
      maps = obj.linkMaps;
    } else {
      // 0.9.1
      if (obj.linkData !== undefined && obj.linkData !== null) {
        maps = obj.linkData;
      } else {
        maps = obj.mapsDat.links.dataList;
      }
    }

    if (maps.length > 0) {
      maps.forEach((linkData: TlinkMapData) => {
        // 0.7.0
        if (!!linkUrl && link) {
          linkData.linkUrl = linkUrl;
        }
        if (!!linkParams && link) {
          linkData.linkParams = linkParams;
        }
        if (!!linkOn) {
          linkData.linkOn = linkOn;
        }
        this.addLinkMap().import(linkData);
      });
    }

    // EVENT
    // <= 0.9.0
    if (!!obj.eventProp) {
      this.data.mapsDat.events.options.identByProp = obj.eventProp;
    }
    if (!!obj.eventRegEx || obj.eventRegEx === false) {
      this.data.mapsDat.events.options.enableRegEx = obj.eventRegEx;
    }

    // 1.0.0
    if (!!obj.mapsDat) {
      if (!!obj.mapsDat.events) {
        this.data.mapsDat.events.options.identByProp =
          obj.mapsDat.events.options.identByProp !== undefined
            ? obj.mapsDat.events.options.identByProp
            : this.data.mapsDat.events.options.identByProp;
        this.data.mapsDat.events.options.enableRegEx = obj.mapsDat.events.options.enableRegEx;
        this.data.mapsDat.events.options.metadata = obj.mapsDat.events.options.metadata;
      }
    }

    this.data.mapsDat.events.dataList = [];
    maps = [];
    if (obj.eventData !== undefined && obj.eventData != null) {
      maps = obj.eventData;
    }
    if (obj.eventsMap !== undefined && obj.eventsMap !== null) {
      maps = obj.eventsMap.dataList;
    }
    if (obj.mapsDat && obj.mapsDat.events && obj.mapsDat.events.dataList) {
      maps = obj.mapsDat.events.dataList;
    }

    if (maps !== undefined && maps != null && maps.length > 0) {
      maps.forEach((eventData: any) => {
        this.addEventMap().import(eventData);
      });
    }

    this.data.mappingType = obj.mappingType || 1;

    // VALUES
    this.data.valueData = [];
    if (obj.valueData !== undefined && obj.valueData != null && obj.valueData.length > 0) {
      obj.valueData.forEach((valueData: TValueMapData) => {
        this.addValueMap('value', 'text').import(valueData);
        this.change();
      });
    }

    // RANGE
    this.data.rangeData = [];
    if (obj.rangeData !== undefined && obj.rangeData != null && obj.rangeData.length > 0) {
      obj.rangeData.forEach((rangeData: any) => {
        this.addRangeMap('from', 'to', 'text').import(rangeData);
        this.change();
      });
    }
    this.data.sanitize = obj.sanitize || false;
    this.data.newRule = false;
    return this;
  }

  //############################################################################
  //### LOGIC
  //############################################################################

  getMetrics(): Map<string, ObjectMetric> {
    return this.metrics;
  }

  /**
   * Get default data
   */
  static getDefaultData(): TIRuleData {
    return {
      order: 1,
      pattern: '.*',
      unit: 'short',
      type: 'number',
      metricType: 'serie',
      alias: 'myRule',
      refId: 'A',
      column: 'Time',
      hidden: false,
      aggregation: 'current',
      decimals: 2,
      reduce: true,
      dateColumn: 'Time',
      dateFormat: 'YYYY-MM-DD HH:mm:ss',
      numberTHData: [],
      stringTHData: [],
      dateTHData: [],
      invert: false,
      gradient: false,
      overlayIcon: false,
      tooltip: false,
      tooltipLabel: '',
      tooltipColors: false,
      tooltipOn: 'a',
      tpDirection: 'v',
      tpMetadata: false,
      tpGraph: false,
      tpGraphSize: '100%',
      tpGraphType: 'line',
      tpGraphLow: null,
      tpGraphHigh: null,
      tpGraphScale: 'linear',
      mapsDat: {
        shapes: {
          options: Rule.getDefaultMapOptions(),
          dataList: [],
        },
        texts: {
          options: Rule.getDefaultMapOptions(),
          dataList: [],
        },
        links: {
          options: Rule.getDefaultMapOptions(),
          dataList: [],
        },
        events: {
          options: Rule.getDefaultMapOptions(),
          dataList: [],
        },
      },
      mappingType: 1,
      valueData: [],
      rangeData: [],
      sanitize: false,
      newRule: true,
    };
  }

  static getDefaultMapOptions(): TRuleMapOptions {
    return {
      identByProp: 'id',
      metadata: '',
      enableRegEx: true,
    };
  }

  /**
   * return data of rule
   */
  getData(): TIRuleData {
    return this.data;
  }

  /**
   * Highlight Cells in rule (mapping color text and link)
   */
  async highlightXCells() {
    if (this.states) {
      return Promise.all(
        Array.from(this.states.values()).map(async (state: State) => {
          state.highlightCell();
        })
      );
    }
    return;
  }

  /**
   * Highlight Cells in rule (mapping color text and link)
   */
  async unhighlightXCells() {
    if (this.states) {
      return Promise.all(
        Array.from(this.states.values()).map(async (state: State) => {
          state.unhighlightCell();
        })
      );
    }
    return;
  }

  enableMapping() {
    const cbm: CallableFunction[] = [];
    Object.values(this.mapsObj).forEach((map: unknown) => {
      (map as ObjectMap[]).forEach((m: ObjectMap) => {
        m.onMapping = true;
        cbm.push(m.setPattern.bind(m));
      });
    });
    this.gf.setMappingCallBack(cbm);
  }

  /**
   * Return the order of this rule
   * Grafana 6+ have a bug when reload dashboad, array are not in order
   */
  setOrder(order: number): this {
    this.data.order = order;
    return this;
  }

  /**
   * Return order of rule
   */
  getOrder(): number {
    return this.data.order;
  }

  /**
   * Invert color order
   */
  _invertColorOrder(): this {
    this._invertColorOrderFor(this.numberTH);
    this._invertColorOrderFor(this.stringTH);
    this._invertColorOrderFor(this.dateTH);
    return this;
  }

  _invertColorOrderFor(ths: ObjectTH[]): this {
    const colors: string[] = [];
    ths.forEach((th) => {
      colors.push(th.color);
    });
    colors.reverse();
    let i = 0;
    ths.forEach((TH) => {
      TH.color = colors[i++];
    });
    return this;
  }

  /**
   * Invert threshold
   */
  invertThesholds(): this {
    this._invertColorOrder();
    this.data.invert = !this.data.invert;
    return this;
  }

  /**
   * Invert threshold
   */
  invertThesholdsColors(): this {
    this._invertColorOrder();
    this.change();
    return this;
  }

  /**
   * Add a new threshold at the position index, if index is undefined, add to the end.
   */
  addThreshold(index?: number, color?: string, value?: any) {
    let th: ObjectTH;
    switch (this.data.type) {
      case 'number':
        th = this._addNumberThreshold(index, color, value);
        break;
      case 'string':
        th = this._addStringThreshold(index, color, value);
        break;
      case 'date':
        th = this._addDateThreshold(index, color, value);
        break;
      default:
        throw new Error('Type of threshold unknown : ' + this.data.type);
    }
    th.events.connect('threshold_changed', this, this._on_TH_threshold_changed.bind(this));
    return th;
  }

  /**
   * Return a Threshold class
   */
  getThreshold(index: number): ObjectTH {
    switch (this.data.type) {
      case 'number':
        return this.numberTH[index];
      case 'string':
        return this.stringTH[index];
      case 'date':
        return this.dateTH[index];
      default:
        throw new Error('Type of threshold unknown : ' + this.data.type);
    }
  }

  cloneThreshold(index: number): ObjectTH {
    const refth = this.getThreshold(index);
    if (refth !== undefined) {
      this.addThreshold(index, refth.color, refth.value).import(refth.getData());
    }
    this.change();
    return refth;
  }

  _addNumberThreshold(index?: number, color?: string, value?: number): NumberTH {
    const thfTable = this.numberTH;
    const thdTable = this.data.numberTHData;
    let finalColor = color;
    let finalValue = value;
    const data = NumberTH.getDefaultData();
    const nth = new NumberTH(data.color, data.comparator, data.value, data);
    const length = thdTable.length;
    if (index === undefined || length === 0) {
      index = length;
    }
    if (index > length - 1) {
      index = length - 1;
    }
    let ref = index;
    if (index === 0 && length > 1) {
      ref = 1;
    }

    if (length > 0) {
      const lth = thfTable[ref];
      nth.import(lth.getData());
      const ratio = 0.5;
      // Color
      if (finalColor === undefined) {
        let beginColor = lth.color;
        if (ref < length - 1 && index !== 0) {
          const endColor = thfTable[ref + 1].color;
          finalColor = calculateColorForRatio(beginColor, endColor, ratio);
        } else {
          finalColor = beginColor;
        }
        if (finalColor !== undefined) {
        }
      }
      // Value
      if (finalValue === undefined) {
        let beginValue = lth.value;
        if (ref < length - 1 && index !== 0) {
          const endValue = thfTable[ref + 1].value;
          finalValue = calculateValueForRatio(beginValue, endValue, ratio);
        } else {
          finalValue = beginValue;
        }
      }
    }
    if (finalColor !== undefined) {
      nth.color = finalColor;
    }
    if (finalValue !== undefined) {
      nth.value = finalValue;
    }
    thfTable.splice(index + 1, 0, nth);
    thdTable.splice(index + 1, 0, data);
    return nth;
  }

  private _addStringThreshold(index?: number, color?: string, value?: string): StringTH {
    const thfTable = this.stringTH;
    const thdTable = this.data.stringTHData;
    let finalColor = color;
    let finalValue = value;
    const data = StringTH.getDefaultData();
    const nth = new StringTH(data.color, data.comparator, data.value, data);
    const length = thdTable.length;
    if (index === undefined || length === 0) {
      index = length;
    }
    if (index > length - 1) {
      index = length - 1;
    }
    let ref = index;
    if (index === 0 && length > 1) {
      ref = 1;
    }

    if (length > 0) {
      const lth = thfTable[ref];
      nth.import(lth.getData());
      const ratio = 0.5;
      // Color
      if (finalColor === undefined) {
        let beginColor = lth.color;
        if (ref < length - 1 && index !== 0) {
          const endColor = thfTable[ref + 1].color;
          finalColor = calculateColorForRatio(beginColor, endColor, ratio);
        } else {
          finalColor = beginColor;
        }
        if (finalColor !== undefined) {
        }
      }
      // Value
      if (finalValue === undefined) {
        finalValue = lth.value;
      }
    }
    if (finalColor !== undefined) {
      nth.color = finalColor;
    }
    if (finalValue !== undefined) {
      nth.value = finalValue;
    }
    thfTable.splice(index + 1, 0, nth);
    thdTable.splice(index + 1, 0, data);
    return nth;
  }

  _addDateThreshold(index?: number, color?: string, value?: string | number, previousData?: any): DateTH {
    const thfTable = this.dateTH;
    const thdTable = this.data.dateTHData;
    let finalColor = color;
    let finalValue = value;
    const data = DateTH.getDefaultData();
    const nth = new DateTH(data.color, data.comparator, data.value, data, previousData);
    const length = thdTable.length;
    if (index === undefined || length === 0) {
      index = length;
    }
    if (index > length - 1) {
      index = length - 1;
    }
    let ref = index;
    if (index === 0 && length > 1) {
      ref = 1;
    }

    if (length > 0) {
      const lth = thfTable[ref];
      nth.import(lth.getData());
      const ratio = 0.5;
      // Color
      if (finalColor === undefined) {
        let beginColor = lth.color;
        if (ref < length - 1 && index !== 0) {
          const endColor = thfTable[ref + 1].color;
          finalColor = calculateColorForRatio(beginColor, endColor, ratio);
        } else {
          finalColor = beginColor;
        }
        if (finalColor !== undefined) {
        }
      }
      // Value
      if (finalValue === undefined) {
        finalValue = lth.value;
      }
    }
    if (finalColor !== undefined) {
      nth.color = finalColor;
    }
    if (finalValue !== undefined) {
      nth.value = finalValue;
    }
    thfTable.splice(index + 1, 0, nth);
    thdTable.splice(index + 1, 0, data);
    return nth;
  }

  removeThreshold(index: number): this {
    const ths = this.getThresholds();
    const thd = this.getThresholdDatas();
    ths.splice(index, 1);
    thd.splice(index, 1);
    this.change();
    return this;
  }

  getThresholds(): ObjectTH[] {
    switch (this.data.type) {
      case 'number':
        return this.numberTH;
      case 'string':
        return this.stringTH;
      case 'date':
        return this.dateTH;
      default:
        throw new Error('Type of threshold unknown : ' + this.data.type);
    }
  }

  clearThresholds(): this {
    this._clearNumberThresholds();
    this._clearStringThresholds();
    this._clearDateThresholds();
    return this;
  }

  initThresholds(): this {
    this._initNumberThresholds();
    this._initStringThresholds();
    this._initDateThresholds();
    return this;
  }

  private _clearNumberThresholds(): this {
    this.data.numberTHData = [];
    this.numberTH = [];
    return this;
  }

  private _initNumberThresholds(): this {
    this._clearNumberThresholds();
    this._addNumberThreshold(0, 'rgba(245, 54, 54, 0.9)', 0);
    this._addNumberThreshold(1, 'rgba(237, 129, 40, 0.89)', 50);
    this._addNumberThreshold(2, 'rgba(50, 172, 45, 0.97)', 80);
    return this;
  }

  private _clearStringThresholds(): this {
    this.data.stringTHData = [];
    this.stringTH = [];
    return this;
  }

  private _initStringThresholds(): this {
    this._clearStringThresholds();
    this._addStringThreshold(0, 'rgba(245, 54, 54, 0.9)', '/.*/');
    this._addStringThreshold(1, 'rgba(237, 129, 40, 0.89)', '/.*warning.*/');
    this._addStringThreshold(2, 'rgba(50, 172, 45, 0.97)', '/.*(success|ok).*/');
    return this;
  }

  private _clearDateThresholds(): this {
    this.data.dateTHData = [];
    this.dateTH = [];
    return this;
  }

  private _initDateThresholds(): this {
    this._clearDateThresholds();
    this._addDateThreshold(0, 'rgba(245, 54, 54, 0.9)', '0d');
    this._addDateThreshold(1, 'rgba(237, 129, 40, 0.89)', '-1d');
    this._addDateThreshold(2, 'rgba(50, 172, 45, 0.97)', '-1w');
    return this;
  }

  getThresholdDatas(): ObjectTHData[] {
    switch (this.data.type) {
      case 'number':
        return this.data.numberTHData;
      case 'string':
        return this.data.stringTHData;
      case 'date':
        return this.data.dateTHData;
      default:
        throw new Error('Type of threshold unknown : ' + this.data.type);
    }
  }

  getThresholdCount(): number {
    return this.getThresholds().length;
  }

  //
  // Conditions
  //

  /**
   * Return true or false for condition to display icon warning
   */
  toIconize(level: number): boolean {
    if (this.data.overlayIcon === false) {
      return false;
    }
    if (this.data.overlayIcon === true && level >= 1) {
      return true;
    }
    return false;
  }

  /**
   * Return true or false for condition to display tooltip with values
   */
  toTooltipize(level: number): boolean {
    if (this.data.tooltip === false && this.data.tpMetadata === false) {
      return false;
    }
    if (this.data.tooltipOn === 'a') {
      return true;
    }
    if (this.data.tooltipOn === 'wc' && level >= 1) {
      return true;
    }
    return false;
  }

  /**
   * Return if state is matched
   */
  MatchState(state: State): boolean {
    const xcell = state.getXCell();
    let mapOptions = this.getShapeMapOptions();
    let value = xcell.getDefaultValues(mapOptions);
    if (this.matchShape(value, mapOptions)) {
      return true;
    }
    mapOptions = this.getTextMapOptions();
    value = xcell.getDefaultValues(mapOptions);
    if (this.matchText(value, mapOptions)) {
      return true;
    }
    mapOptions = this.getLinkMapOptions();
    value = xcell.getDefaultValues(mapOptions);
    if (this.matchLink(value, mapOptions)) {
      return true;
    }
    mapOptions = this.getEventMapOptions();
    value = xcell.getDefaultValues(mapOptions);
    if (this.matchEvent(value, mapOptions)) {
      return true;
    }
    return false;
  }

  //
  // Private methods maps
  //
  _matchMaps(type: TTypeMap, pattern: string | null, options: TRuleMapOptions = this._getMapsOptions(type)): boolean {
    const maps = this._getMapsObjType(type);
    let found = false;
    const length = maps.length;
    for (let index = 0; index < length; index++) {
      const map = maps[index];
      found = map.match(pattern, options);
      if (found) {
        break;
      }
    }
    return found;
  }

  _getMapsDat() {
    return this.data.mapsDat;
  }

  _getRuleMapsData(type: TTypeMap): TRuleMapData {
    return (this._getMapsDat() as any)[`${type}s`];
  }

  _getMapsObj() {
    return this.mapsObj;
  }

  _getMapsObjType(type: TTypeMap): ObjectMap[] {
    return (this._getMapsObj() as any)[`${type}s`];
  }

  _getMapsDatList(type: TTypeMap): DataMap[] {
    return this._getRuleMapsData(type).dataList;
  }

  _getMapsOptions(type: TTypeMap): TRuleMapOptions {
    return this._getRuleMapsData(type).options;
  }

  _addMaps(map: ObjectMap) {
    const maps = this._getMapsObjType(map.getType());
    const datas = this._getMapsDatList(map.getType());
    maps.push(map);
    datas.push(map.getData());
  }

  _removeMaps(map: number | ObjectMap, type: TTypeMap) {
    const maps = this._getMapsObjType(type);
    const datas = this._getMapsDatList(type);
    let index = -1;
    if (typeof map !== 'number') {
      index = maps.indexOf(map);
    }
    if (typeof map === 'number') {
      index = map;
    }
    if (index !== -1) {
      maps[index].events.disconnect('map_changed', this);
      maps[index].free();
      maps.splice(index, 1);
      datas.splice(index, 1);
    }
    this.change();
  }

  //
  // SHAPE MAPS
  //
  addShapeMap(pattern = ''): ShapeMap {
    const data = ShapeMap.getDefaultData();
    const m = new ShapeMap(this.gf, pattern, data);
    m.setOptions(this.getShapeMapOptions());
    this._addMaps(m);
    m.events.connect('map_changed', this, this._on_map_map_changed.bind(this));
    return m;
  }

  cloneShapeMap(initial: ShapeMap): ShapeMap {
    return this.addShapeMap().import(initial);
  }

  removeShapeMap(map: number | ShapeMap): this {
    this._removeMaps(map, 'shape');
    return this;
  }

  getShapeMapOptions(): TRuleMapOptions {
    return this._getMapsOptions('shape');
  }

  getShapeMap(index: number): ShapeMap {
    const maps = this._getMapsObjType('shape');
    const map = maps[index];
    if (map instanceof ShapeMap) {
      return map;
    } else {
      throw new Error('map is not an instance of ShapeMap');
    }
  }

  getShapeMaps(): ShapeMapArray {
    const maps = (this._getMapsObj() as any)['shapes'];
    return maps;
  }

  matchShape(pattern: string | null, options: TRuleMapOptions = this.getShapeMapOptions()): boolean {
    return this._matchMaps('shape', pattern, options);
  }

  //
  // TEXT MAPS
  //
  addTextMap(pattern = ''): TextMap {
    const data = TextMap.getDefaultData();
    const m = new TextMap(this.gf, pattern, data);
    m.setOptions(this.getTextMapOptions());
    this._addMaps(m);
    m.events.connect('map_changed', this, this._on_map_map_changed.bind(this));
    return m;
  }

  cloneTextMap(initial: TextMap): TextMap {
    return this.addTextMap().import(initial);
  }

  removeTextMap(map: number | TextMap): this {
    this._removeMaps(map, 'text');
    return this;
  }

  getTextMapOptions(): TRuleMapOptions {
    return this._getMapsOptions('text');
  }

  getTextMap(index: number): TextMap {
    const maps = this._getMapsObjType('text');
    const map = maps[index];
    if (map instanceof TextMap) {
      return map;
    } else {
      throw new Error('map is not an instance of TextMap');
    }
  }

  getTextMaps(): TextMap[] {
    const maps = (this._getMapsObj() as any)['texts'];
    return maps;
  }

  matchText(pattern: string | null, options: TRuleMapOptions = this.getTextMapOptions()): boolean {
    return this._matchMaps('text', pattern, options);
  }

  //
  // EVENT MAPS
  //
  addEventMap(pattern = ''): EventMap {
    const data = EventMap.getDefaultData();
    const m = new EventMap(this.gf, pattern, data);
    m.setOptions(this.getEventMapOptions());
    this._addMaps(m);
    m.events.connect('map_changed', this, this._on_map_map_changed.bind(this));
    return m;
  }

  cloneEventMap(map: EventMap): EventMap {
    return this.addEventMap().import(map.getData());
  }

  removeEventMap(index: number | EventMap): this {
    this._removeMaps(index, 'event');
    return this;
  }

  getEventMapOptions(): TRuleMapOptions {
    return this._getMapsOptions('event');
  }

  getEventMap(index: number): EventMap {
    const maps = this._getMapsObjType('event');
    const map = maps[index];
    if (map instanceof EventMap) {
      return map;
    } else {
      throw new Error('map is not an instance of EventMap');
    }
  }

  getEventMaps(): EventMap[] {
    const maps = (this._getMapsObj() as any)['events'];
    return maps;
  }

  matchEvent(pattern: string | null, options: TRuleMapOptions = this.getEventMapOptions()): boolean {
    return this._matchMaps('event', pattern, options);
  }

  //
  // LINK MAPS
  //
  addLinkMap(pattern = ''): LinkMap {
    const data = LinkMap.getDefaultData();
    const m = new LinkMap(this.gf, pattern, data);
    m.setOptions(this.getLinkMapOptions());
    this._addMaps(m);
    m.events.connect('map_changed', this, this._on_map_map_changed.bind(this));
    return m;
  }

  cloneLinkMap(initial: LinkMap): LinkMap {
    return this.addLinkMap().import(initial);
  }

  removeLinkMap(index: number | LinkMap): this {
    this._removeMaps(index, 'link');
    return this;
  }

  getLinkMapOptions(): TRuleMapOptions {
    return this._getMapsOptions('link');
  }

  getLinkMap(index: number): LinkMap {
    const maps = this._getMapsObjType('link');
    const map = maps[index];
    if (map instanceof LinkMap) {
      return map;
    } else {
      throw new Error('map is not an instance of LinkMap');
    }
  }

  getLinkMaps(): LinkMap[] {
    const maps = (this._getMapsObj() as any)['links'];
    return maps;
  }

  matchLink(pattern: string | null, options: TRuleMapOptions = this.getLinkMapOptions()): boolean {
    return this._matchMaps('link', pattern, options);
  }

  //
  // STRING VALUE MAPS
  //
  addValueMap(value?: any, text?: string): ValueMap {
    const data: TValueMapData = ValueMap.getDefaultdata();
    const m = new ValueMap(value, text, data);
    m.events.connect('map_changed', this, this._on_map_map_changed.bind(this));
    this.valueMaps.push(m);
    this.data.valueData.push(data);
    this.change();
    return m;
  }

  cloneValueMap(index: number): ValueMap {
    const data = this.getValueMap(index).getData();
    return this.addValueMap().import(data);
  }

  removeValueMap(map: number | ValueMap): this {
    let index = -1;
    if (map instanceof ValueMap) {
      index = this.valueMaps.indexOf(map);
    }
    if (typeof map === 'number') {
      index = map;
      map = this.valueMaps[index];
    }
    if (index === -1) {
      throw new Error('map is not an instance of ValueMap');
    }
    map.events.disconnect('map_changed', this);
    map.free();
    this.data.valueData.splice(index, 1);
    this.valueMaps.splice(index, 1);
    this.change();
    return this;
  }

  getValueMap(index: number): ValueMap {
    return this.valueMaps[index];
  }

  getValueMaps(): ValueMap[] {
    return this.valueMaps;
  }

  //
  // STRING RANGE VALUE MAPS
  //
  addRangeMap(from?: any, to?: any, text?: any): RangeMap {
    const data = RangeMap.getDefaultData();
    const m = new RangeMap(from, to, text, data);
    m.events.connect('map_changed', this, this._on_map_map_changed.bind(this));
    this.rangeMaps.push(m);
    this.data.rangeData.push(data);
    this.change();
    return m;
  }

  cloneRangeMap(index: number): RangeMap {
    const data = this.getRangeMap(index).getData();
    const range = this.addRangeMap().import(data);
    this.change();
    return range;
  }

  removeRangeMap(map: number | RangeMap) {
    let index = -1;
    if (map instanceof RangeMap) {
      index = this.rangeMaps.indexOf(map);
    }
    if (typeof map === 'number') {
      index = map;
      map = this.rangeMaps[index];
    }
    if (index === -1) {
      throw new Error('map is not an instance of RangeMap');
    }
    map.events.disconnect('map_changed', this);
    map.free();
    this.data.rangeData.splice(index, 1);
    this.rangeMaps.splice(index, 1);
    this.change();
  }

  getRangeMap(index: number): RangeMap {
    return this.rangeMaps[index];
  }

  getRangeMaps(): RangeMap[] {
    return this.rangeMaps;
  }

  //
  // DIVERS
  //
  getExectedTime(): string {
    return typeof this.execTimes === 'number' ? `${this.execTimes.toFixed(2)} ms` : `${this.execTimes} ms`;
  }

  //
  // THRESHOLDS
  //
  /**
   * Get color according to value
   */
  getThresholdColor(value: any): string {
    switch (this.data.type) {
      case 'number':
        return this._getColorForNumberTH(value);
      case 'string':
        return this._getColorForStringTH(value);
      case 'date':
        return this._getColorForDateTH(value);
      default:
        throw new Error('Data type unknown' + this.data.type);
    }
  }

  _getColorForNumberTH(value: number): string {
    const index = this._getIndexNumberTHForValue(value);
    if (this.data.gradient) {
      if (index === 0) {
        return this.numberTH[index].color;
      }
      if (index === this.numberTH.length - 1) {
        return this.numberTH[index].color;
      }
      const beginColor = this.numberTH[index].color;
      const beginValue = this.numberTH[index].value;
      const endColor = this.numberTH[index + 1].color;
      const endValue = this.numberTH[index + 1].value;
      const ratio = calculateRatioForValue(beginValue, endValue, value);
      return calculateColorForRatio(beginColor, endColor, ratio);
    }
    return this.numberTH[index].color;
  }

  _getIndexTHForValue(value: any): number {
    switch (this.data.type) {
      case 'number':
        return this._getIndexNumberTHForValue(value);
      case 'string':
        return this._getIndexStringTHForValue(value);
      case 'date':
        return this._getIndexDateTHForValue(value);
      default:
        throw new Error('Type of threshold unknown : ' + this.data.type);
    }
  }

  _getIndexNumberTHForValue(value: number): number {
    let index = -1;
    for (let i = 0; i < this.numberTH.length; i++) {
      const th = this.numberTH[i];
      // Base
      if (i === 0) {
        index = i;
      } else {
        if (!th.hidden) {
          if (th.match(value)) {
            index = i;
          } else {
            break;
          }
        }
      }
    }
    return index;
  }

  _getIndexStringTHForValue(value: string): number {
    let index = -1;
    for (let i = 0; i < this.stringTH.length; i++) {
      const th = this.stringTH[i];
      // Base
      if (i === 0) {
        index = i;
      } else {
        if (!th.hidden && th.match(value)) {
          index = i;
        }
      }
    }
    return index;
  }

  _getColorForStringTH(value: string): string {
    return this.stringTH[this._getIndexStringTHForValue(value)].color;
  }

  _getIndexDateTHForValue(value: string): number {
    let index = -1;
    for (let i = 0; i < this.dateTH.length; i++) {
      const th = this.dateTH[i];
      // Base
      if (i === 0) {
        index = i;
      } else {
        if (!th.hidden && th.match(value)) {
          index = i;
        }
      }
    }
    return index;
  }

  _getColorForDateTH(value: string): string {
    return this.dateTH[this._getIndexDateTHForValue(value)].color;
  }

  /**
   * Get color according level (-1,0,1,2...)
   */
  getThresholdColorForLevel(level: number): string {
    const index = this.getThresholdIndexForLevel(level);
    const th = this.getThreshold(index);
    return th.color;
  }

  /**
   * Return an index for a level
   */
  getThresholdIndexForLevel(level: number): number {
    let length = this.getThresholds().length;
    if (this.data.invert) {
      return level;
    }
    return length - 1 - level;
  }

  /**
   * Return Level according to value and rule options
   */
  getThresholdLevel(value: any): number {
    let index = this._getIndexTHForValue(value);
    let length = this.getThresholds().length;
    if (this.data.invert && index !== -1) {
      return index;
    }
    if (index !== -1) {
      return length - 1 - index;
    }
    return index;
  }

  /**
   * Get the level according objet TH
   */
  getThresholdLevelForTH(th: ObjectTH): number {
    const ths = this.getThresholds();
    const index = ths.indexOf(th);
    if (index !== -1) {
      return this.data.invert ? index : this.getThresholdCount() - 1 - index;
    }
    return index;
  }

  /**
   * Get the level according index
   */
  getThresholdLevelForIndex(index: number): number {
    if (index !== -1) {
      return this.data.invert ? index : this.getThresholdCount() - 1 - index;
    }
    return index;
  }

  /**
   * Get value for this metric
   */
  getValueForMetric(metric: ObjectMetric): string | number | null {
    if (this.matchMetric(metric)) {
      try {
        const value = metric.getValue(this.data.aggregation, this.data.column);
        return value;
      } catch (error) {
        GFLog.error('Datapoint for metric is null', error);
        return null;
      }
    }
    return '-';
  }

  /**
   * Get formatting value according unit
   */
  getFormattedValueForMetric(metric: ObjectMetric): string {
    const formattedValue = this.getValueForMetric(metric);
    return this.getFormattedValue(formattedValue);
  }

  /**
   * Format a one value according rule
   */
  getFormattedValue(value: any) {
    // Number
    if (this.data.type === 'number') {
      if (!Number.isFinite(value)) {
        return 'null';
      }
      if (value === null || value === void 0) {
        return '-';
      }
      let decimals = this._decimalPlaces(value);
      decimals = typeof this.data.decimals === 'number' ? Math.min(this.data.decimals, decimals) : decimals;
      return formatValue(value, this.data.unit, this.data.decimals);
    }

    if (this.data.type === 'string') {
      if (value === null || value === void 0) {
        value = 'null';
      }

      if (Array.isArray(value)) {
        value = value.join(', ');
      }
      const mappingType = this.data.mappingType || 0;
      if (mappingType === 1 && this.valueMaps) {
        for (let i = 0; i < this.valueMaps.length; i += 1) {
          const map = this.valueMaps[i];
          if (!map.hidden && map.match(value)) {
            return map.getFormattedText(value);
          }
        }
        return value.toString();
      }

      if (mappingType === 2 && this.rangeMaps) {
        for (let i = 0; i < this.rangeMaps.length; i += 1) {
          const map = this.rangeMaps[i];
          if (!map.hidden && map.match(value)) {
            return map.getFormattedText(value);
          }
        }
        return value.toString();
      }

      if (value === null || value === void 0) {
        return 'null';
      }
    }

    if (this.data.type === 'date') {
      if (value === undefined || value === null) {
        return '-';
      }

      if (Array.isArray(value)) {
        value = value[0];
      }

      let d = getFormatedDate(value, this.data.dateFormat);
      return d;
    }
    return value;
  }

  $sanitize(value: any) {
    throw new Error('Method not implemented.');
  }

  _decimalPlaces(num: string) {
    const match = ('' + num).match(/(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
    if (!match) {
      return 0;
    }
    return Math.max(
      0,
      // Number of digits right of decimal point.
      (match[1] ? match[1].length : 0) -
        // Adjust for scientific notation.
        (match[2] ? +match[2] : 0)
    );
  }

  initCycle(): this {
    this.highestLevel = -1;
    this.highestFormattedValue = '';
    this.highestColor = '';
    this.highestValue = '';
    this.execTimes = 0;
    return this;
  }

  /**
   * Return boolean if metrics is matched by rule
   */
  matchMetric(metric: ObjectMetric): boolean {
    if (this.data.metricType === 'serie' && metric.type === 'serie') {
      return matchString(metric.getName(), this.data.pattern);
    }
    if (this.data.metricType === 'table' && metric.type === 'table') {
      return metric.getName() === this.data.refId;
    }
    return false;
  }

  clearMetrics(): this {
    this.metrics.clear();
    return this;
  }

  hasMetric(metric: ObjectMetric): boolean {
    return this.metrics.has(metric.uid);
  }

  //#############################################################
  //### EVENTS
  //#############################################################
  private _on_metricHandler_metric_deleted(metric: ObjectMetric) {
    _log('📬', this.constructor.name, '_on_metricHandler_metric_deleted');
    if (this.metrics.has(metric.uid)) {
      this.metrics.delete(metric.uid);
      this.update();
    }
  }

  private _on_metricHandler_metric_created(metric: ObjectMetric) {
    _log('📬', this.constructor.name, '_on_metricHandler_metric_created');
    if (this.matchMetric(metric)) {
      this.metrics.set(metric.uid, metric);
      this.update();
    }
  }

  private _on_TH_threshold_changed() {
    _log('📬', this.constructor.name, '_on_TH_threshold_changed');
    this.change();
  }

  private _on_map_map_changed() {
    _log('📬', this.constructor.name, '_on_map_map_changed');
    this.change();
  }
}
