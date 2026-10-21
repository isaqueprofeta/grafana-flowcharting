// Exported Options_Schema — no gf.* ambient references.          [Req 5.1, 5.2]
//
// This is the clean-redesign panel options schema for the React migration.
// It restructures the legacy `gf.TFlowchartHandlerData` / `gf.TFlowchartData` /
// `gf.TIRuleData` ambient types (src/index.d.ts) into plain exported interfaces.
// See design.md "Data Models" for the authoritative shape and mapping notes.

// --- Supporting type aliases -------------------------------------------------

export type SourceType = 'xml' | 'csv';
export type DioTheme = 'dark' | 'kennedy' | 'minimal' | 'atlas';
export type ValueType = 'number' | 'string' | 'date';
export type Aggregation =
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
  | 'last_time';
export type Comparator = 'al' | 'lt' | 'le' | 'eq' | 'ne' | 'ge' | 'gt';

// --- Top-level options -------------------------------------------------------

export interface FlowchartingOptions {
  flowcharts: FlowchartOptions[];
  rules: RuleOptions[];
  editor: EditorOptions; // editor settings (was TFlowchartHandlerData top fields)
  inspect?: { enabled: boolean };
}

export interface EditorOptions {
  editorUrl: string; // was TFlowchartHandlerData.editorUrl
  editorTheme: DioTheme; // 'dark' | 'kennedy' | 'minimal' | 'atlas'
  allowDrawio: boolean; // was TFlowchartHandlerData.allowDrawio
}

// --- Flowchart (diagram source) ---------------------------------------------

export interface FlowchartOptions {
  // from gf.TFlowchartData
  name: string;
  type: SourceType;
  xml: string;
  csv: string;
  url: string;
  download: boolean;
  zoom: string;
  scale: boolean;
  center: boolean;
  lock: boolean;
  grid: boolean;
  enableAnim: boolean;
  tooltip: boolean;
  bgColor: string | null;
}

// --- Thresholds --------------------------------------------------------------

export interface NumberThreshold {
  level: number;
  color: string;
  comparator: 'ge' | 'gt';
  value: number;
}

export interface StringThreshold {
  level: number;
  color: string;
  comparator: 'eq' | 'ne';
  value: string;
}

export interface DateThreshold {
  level: number;
  color: string;
  comparator: 'eq' | 'ne' | 'ge' | 'gt';
  value: string | number;
}

// --- Value / range maps ------------------------------------------------------

export interface ValueMap {
  value?: string;
  text?: string;
  hidden: boolean;
}

export interface RangeMap {
  from?: string;
  to?: string;
  text?: string;
  hidden: boolean;
}

// --- Shape / text / link / event maps ---------------------------------------

export interface ShapeMap {
  pattern: string;
  style: string;
  colorOn: 'n' | 'wc' | 'a';
  hidden: boolean;
}

export interface TextMap {
  pattern: string;
  textReplace: 'content' | 'pattern' | 'as' | 'anl';
  textPattern: string;
  textOn: 'n' | 'wmd' | 'wc' | 'co';
  hidden: boolean;
}

export interface LinkMap {
  pattern: string;
  linkUrl: string;
  linkParams: boolean;
  linkOn: 'wc' | 'a';
  hidden: boolean;
}

export interface EventMap {
  pattern: string;
  style: string;
  comparator: Comparator;
  value: string;
  eventOn: number;
  hidden: boolean;
}

// --- Tooltip -----------------------------------------------------------------

export interface TooltipOptions {
  enabled: boolean; // was tooltip
  label: string; // tooltipLabel
  colors: boolean; // tooltipColors
  on: 'wc' | 'a'; // tooltipOn
  direction: 'v' | 'h'; // tpDirection
  metadata: boolean; // tpMetadata
  graph: boolean; // tpGraph (sparkline)
  graphType: 'line' | 'bar'; // tpGraphType
  graphSize: '100%' | '100px' | '200px' | '400px';
  graphScale: 'linear' | 'log';
  graphLow: number | null;
  graphHigh: number | null;
}

// --- Rule --------------------------------------------------------------------

export interface RuleOptions {
  // from gf.TIRuleData
  order: number;
  enabled: boolean; // replaces inverse of `hidden`
  pattern: string;
  // metric binding
  metricType: 'serie' | 'table';
  alias: string;
  refId: string;
  column: string;
  aggregation: Aggregation;
  type: ValueType;
  unit: string;
  decimals: number;
  dateColumn: string;
  dateFormat: string;
  // thresholds
  numberThresholds: NumberThreshold[]; // was numberTHData
  stringThresholds: StringThreshold[]; // was stringTHData
  dateThresholds: DateThreshold[]; // was dateTHData
  invert: boolean;
  // value / range maps
  mappingType: 1 | 2;
  valueMaps: ValueMap[]; // was valueData
  rangeMaps: RangeMap[]; // was rangeData
  // shape / text / link / event maps
  shapeMaps: ShapeMap[];
  textMaps: TextMap[];
  linkMaps: LinkMap[];
  eventMaps: EventMap[];
  mapOptions: {
    identByProp: 'id' | 'value' | 'metadata';
    metadata: string;
    enableRegEx: boolean;
  };
  // tooltip + sparkline
  tooltip: TooltipOptions;
  gradient: boolean;
  overlayIcon: boolean;
  sanitize: boolean;
}

// --- Defaults ----------------------------------------------------------------

export const defaultEditorOptions: EditorOptions = {
  editorUrl: 'https://embed.diagrams.net/',
  editorTheme: 'dark',
  allowDrawio: true,
};

export const defaultFlowchartingOptions: FlowchartingOptions = {
  flowcharts: [],
  rules: [],
  editor: defaultEditorOptions,
  inspect: { enabled: false },
};
