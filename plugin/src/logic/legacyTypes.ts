/**
 * legacyTypes — the internal `gf.*` data interfaces the preserved Logic_Layer
 * classes carry on their `data` fields, ported out of the ambient `src/index.d.ts`
 * namespace into plain exported TypeScript (design.md: Logic_Layer "import
 * swaps", Req 8.2; types de-ambient-ized like Task 4.3).
 *
 * These are the *engine-internal* shapes the rules / thresholds / mappings
 * classes persist and migrate between schema versions — distinct from the
 * clean-redesign panel Options_Schema in `types/options.ts`. They are preserved
 * verbatim so the ported algorithms (`import`/`_convert`/matching) stay
 * unchanged. No `gf.*` references, no Angular, no `mx*` globals.
 */

// --- Enumerated key unions ---------------------------------------------------

export type TMetricTypeKeys = 'table' | 'serie';
export type TValueTypeKeys = 'number' | 'string' | 'date';
export type TAggregationKeys =
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
  | 'last_time'
  | 'graph-hover';
export type TDateFormatKeys =
  | 'YYYY-MM-DD HH:mm:ss'
  | 'YYYY-MM-DD HH:mm:ss.SSS'
  | 'MM/DD/YY h:mm:ss a'
  | 'MMMM D, YYYY LT'
  | 'YYYY-MM-DD';

export type TPropertieKey = 'id' | 'value' | 'metadata';
export type TTypeMap = 'shape' | 'text' | 'link' | 'event';

export type TColorOnKeys = 'n' | 'wc' | 'a';
export type TTextOnKeys = 'n' | 'wmd' | 'wc' | 'co';
export type TLinkOnKeys = 'wc' | 'a';
export type TTooltipOnKeys = 'wc' | 'a';
export type TTextMethodKeys = 'content' | 'pattern' | 'as' | 'anl';
export type TDirectionKeys = 'v' | 'h';
export type TGraphTypeKeys = 'line' | 'bar';
export type TGraphScaleKeys = 'linear' | 'log';
export type TGraphSizeKeys = '100%' | '100px' | '200px' | '400px';

export type TStyleColorKeys =
  | 'fillColor'
  | 'strokeColor'
  | 'gradientColor'
  | 'fontColor'
  | 'labelBackgroundColor'
  | 'labelBorderColor'
  | 'imageBorder'
  | 'imageBackground';
export type TStyleAnimEventKey = 'barPos' | 'gaugePos' | 'fontSize' | 'opacity' | 'textOpacity' | 'rotation';
export type TStyleStaticEventKeys =
  | 'shape'
  | 'endArrow'
  | 'startArrow'
  | 'flipH'
  | 'flipV'
  | 'gradientDirection'
  | 'image';
export type TStyleEventKeys = TStyleAnimEventKey | TStyleStaticEventKeys;
export type TOtherEventKeys =
  | 'blink'
  | 'class'
  | 'visibility'
  | 'fold'
  | 'height'
  | 'width'
  | 'size'
  | 'text'
  | 'tpText'
  | 'tpMetadata'
  | 'class_mxEdgeFlow';
export type TTypeEventKeys = TStyleEventKeys | TOtherEventKeys;

export type TComparatorKeys = 'lt' | 'le' | 'eq' | 'ne' | 'ge' | 'gt' | 'al';

// --- Threshold comparators / data -------------------------------------------

export type TTHNumberComparator = 'ge' | 'gt';
export type TTHStringComparator = 'eq' | 'ne';
export type TTHDateComparator = 'eq' | 'ne' | 'ge' | 'gt';
export type TEventComparator = 'lt' | 'le' | 'eq' | 'ne' | 'ge' | 'gt' | 'al';
export type THDatePrecision = 'y' | 'M' | 'w' | 'd' | 'h' | 'm' | 's';

export interface TTHData {
  color: string;
  comparator: string;
  value: unknown;
  level: number;
}
export interface TTHStringData extends TTHData {
  comparator: TTHStringComparator;
  value: string;
}
export interface TTHNumberData extends TTHData {
  comparator: TTHNumberComparator;
  value: number;
}
export interface TTHDateData extends TTHData {
  comparator: TTHDateComparator;
  value: string | number;
}

// --- Map options / data ------------------------------------------------------

export interface TRuleMapOptions {
  identByProp: TPropertieKey;
  metadata: string;
  enableRegEx: boolean;
}

export interface TDefObjMapData {
  pattern: string;
  hidden: boolean;
}
export interface TShapeMapData extends TDefObjMapData {
  style: TStyleColorKeys;
  colorOn: TColorOnKeys;
}
export interface TEventMapData extends TDefObjMapData {
  style: TTypeEventKeys;
  comparator: TComparatorKeys;
  eventOn: number;
  value: string;
}
export interface TTextMapData extends TDefObjMapData {
  textReplace: TTextMethodKeys;
  textPattern: string;
  textOn: TTextOnKeys;
}
export interface TlinkMapData extends TDefObjMapData {
  linkUrl: string;
  linkParams: boolean;
  linkOn: TLinkOnKeys;
}

// Range and value mapping
export interface TDefMapData {
  text: string | undefined;
  hidden: boolean;
}
export interface TRangeMapData extends TDefMapData {
  from: string | undefined;
  to: string | undefined;
}
export interface TValueMapData extends TDefMapData {
  value: string | undefined;
}

export type TMapDataArray = TShapeMapData[] | TTextMapData[] | TlinkMapData[] | TEventMapData[];

export interface TRuleMapData {
  options: TRuleMapOptions;
  dataList: TMapDataArray;
}
export interface TRuleShapeMapData extends TRuleMapData {
  dataList: TShapeMapData[];
}
export interface TRuleTextMapData extends TRuleMapData {
  dataList: TTextMapData[];
}
export interface TRuleLinkMapData extends TRuleMapData {
  dataList: TlinkMapData[];
}
export interface TRuleEventMapData extends TRuleMapData {
  dataList: TEventMapData[];
}

// --- Event method descriptor -------------------------------------------------

export type TTypeEventElt = {
  text: string;
  value: TTypeEventKeys;
  type: 'number' | 'text';
  placeholder: string;
  typeahead?: string;
  default?: any;
};

// --- Rule data ---------------------------------------------------------------

export interface TIRuleData {
  order: number;
  pattern: string;
  metricType: TMetricTypeKeys;
  alias: string;
  refId: string;
  column: string;
  aggregation: TAggregationKeys;
  unit: string;
  type: TValueTypeKeys;
  hidden: boolean;
  decimals: number;
  reduce: boolean;
  dateColumn: string;
  dateFormat: TDateFormatKeys;
  invert: boolean;
  gradient: boolean;
  overlayIcon: boolean;
  tooltip: boolean;
  tooltipLabel: string;
  tooltipColors: boolean;
  tooltipOn: TTooltipOnKeys;
  tpDirection: TDirectionKeys;
  tpMetadata: boolean;
  tpGraph: boolean;
  tpGraphSize: TGraphSizeKeys;
  tpGraphType: TGraphTypeKeys;
  tpGraphLow: number | null;
  tpGraphHigh: number | null;
  tpGraphScale: TGraphScaleKeys;
  mapsDat: {
    shapes: TRuleShapeMapData;
    texts: TRuleTextMapData;
    links: TRuleLinkMapData;
    events: TRuleEventMapData;
  };
  numberTHData: TTHNumberData[];
  stringTHData: TTHStringData[];
  dateTHData: TTHDateData[];
  mappingType: number;
  valueData: TValueMapData[];
  rangeData: TRangeMapData[];
  sanitize: boolean;
  newRule: boolean;
}

export interface TIRulesHandlerData {
  rulesData: TIRuleData[];
}

export interface TRuleMaps {
  shapes: unknown[];
  texts: unknown[];
  links: unknown[];
  events: unknown[];
}
