/**
 * globals — portable, framework-agnostic globals ported from the legacy
 * `src/globals_class.ts` (design.md: Logic_Layer, Req 8.1, 8.2).
 *
 * Only the portable pieces are carried over:
 *   - GFCONSTANT  : static configuration + option lists (Angular-free).
 *   - GFLog       : leveled console logger.
 *   - GFTimer     : cancelable multi-step timer built on window.setTimeout.
 *   - GFTable     : resizable-table DOM helper.
 *   - path helpers: GFPaths — asset/path resolution from a configurable root.
 *
 * The Angular-coupled surface of the legacy module is intentionally dropped:
 *   - `$GF` (needs `$scope`/`ctrl`/`dashboard`/`templateSrv`) → Context_Seam (Task 4.2).
 *   - `GFVariables` / `GFPlugin.init` (bind Angular `$scope`/`templateSrv`) → Context_Seam.
 *   - `safe-eval` / `eval` usage → removed (no `eval`).
 *   - `gf.*` ambient types → local exported interfaces here (Task 4.3 owns the
 *     full options schema); no `gf.*` references remain.
 *
 * No `$GF`, `$scope`, Angular, `globalThis`, or `mx*` global mutation.
 */

// ---------------------------------------------------------------------------
// Portable local types (replacing the legacy `gf.*` ambient namespace)
// ---------------------------------------------------------------------------

/** A text/value option entry used by the various option lists. */
export interface GFSelect<V = string> {
  text: string;
  value: V;
}

/** An event-method descriptor (legacy `gf.TTypeEvent`). */
export interface GFEventMethod {
  text: string;
  value: string;
  type: 'text' | 'number';
  placeholder?: string;
  default?: string | number;
  typeahead?: string;
}

/** A single column definition for {@link GFTable} (legacy `gf.TTableColumn`). */
export interface GFTableColumn {
  id: string;
  index: number;
  label: string;
  desc?: string;
  width: string;
  align?: string;
  [key: string]: unknown;
}

/** Table data for {@link GFTable} (legacy `gf.TTableData`). */
export interface GFTableData {
  columns: GFTableColumn[];
  [key: string]: unknown;
}

/** Known column property keys that {@link GFTable} can read/write. */
export type GFTableProperty = 'id' | 'index' | 'label' | 'desc' | 'width' | 'align';

// ---------------------------------------------------------------------------
// GFCONSTANT — configuration + option lists (Angular-free)
// ---------------------------------------------------------------------------

export class GFCONSTANT {
  // CONFIG
  static readonly CONF_PATH_LIBS = 'libs/';
  static readonly CONF_PATH_DRAWIO = 'libs/drawio/';
  static readonly CONF_PATH_DRAWIOJS = 'libs/drawio/js';
  static readonly CONF_PATH_STATIC = 'static/';
  static readonly CONF_PATH_PARTIALS = 'partials/';
  static readonly CONF_PATH_STYLES = 'styles/';
  static readonly CONF_FILE_PLUGINJSON = './plugin.json';
  static readonly CONF_FILE_DEFAULTDIO = 'static/defaultGraph.drawio';
  static readonly CONF_FILE_DEFAULTCSV = 'static/defaultGraph.csv';
  static readonly CONF_FILE_SHAPESTXT = 'static/shapes.txt';
  static readonly CONF_NAME_APPJS = 'app.min.js';
  static readonly CONF_NAME_INTEGRATEJS = 'app.min.js';
  static readonly CONF_NAME_SHAPESJS = 'shapes.min.js';
  static readonly CONF_NAME_VIEWERJS = 'viewer.min.js';
  static readonly CONF_NAME_STATIC_VIEWERJS = 'viewer-static.min.js';
  static readonly CONF_DEFAULT_DRAWIOJS = GFCONSTANT.CONF_NAME_STATIC_VIEWERJS;
  static readonly CONF_FILE_DRAWIOLIB = `${GFCONSTANT.CONF_PATH_DRAWIOJS}/${GFCONSTANT.CONF_DEFAULT_DRAWIOJS}`;
  static readonly CONF_FILE_PRECONFIGJS = 'libs/drawio/js/PreConfig.js';
  static readonly CONF_FILE_POSTCONFIGJS = 'libs/drawio/js/PostConfig.js';
  static readonly CONF_FILE_VERSION = 'VERSION';
  static readonly CONF_TOOLTIPS_DELAY = 200;
  static readonly CONF_GRAPHHOVER_DELAY = 50;
  static readonly CONF_COLORS_STEPS = 5;
  static readonly CONF_COLORS_MS = 50;
  static readonly CONF_ANIMS_STEP = 10;
  static readonly CONF_ANIMS_MS = 50;
  static readonly CONF_GFMESSAGE_MS = 5000;
  static readonly CONF_BLINK_COLOR = '#f5f242';
  static readonly CONF_HIGHTLIGHT_COLOR = '#99ff33';
  static readonly CONF_EDITOR_URL = 'https://embed.diagrams.net/';
  static readonly CONF_EDITOR_THEME = 'kennedy';

  // GLOBAL VARIABLE NAMES
  static readonly VAR_STG_SHAPES = 'shapestext';
  static readonly VAR_TBL_SHAPES = 'shapesarray';
  static readonly VAR_STR_VIEWERJS = 'viewer.min.js';
  static readonly VAR_STR_SHAPESJS = 'shapes.min.js';
  static readonly VAR_NUM_GHTIMESTAMP = 'graph-hover-timestamp';
  static readonly VAR_MAP_INTERVAL = 'interval';
  static readonly VAR_MAP_TIMEOUT = 'timeout';
  static readonly VAR_STR_RULENAME = '_rule';
  static readonly VAR_NUM_LEVEL = '_level';
  static readonly VAR_NUM_VALUE = '_value';
  static readonly VAR_STR_FORMATED = '_formated';
  static readonly VAR_STR_COLOR = '_color';
  static readonly VAR_STR_DATE = '_date';
  static readonly VAR_STR_METRIC = '_metric';

  // TRACE AND DEBUG
  static readonly VAR_GF_TRACE_PERF = true;

  // MXGRAPH STYLE KEY SETS
  static readonly MXGRAPH_STYLES_COLOR: string[] = [
    'fillColor',
    'strokeColor',
    'gradientColor',
    'fontColor',
    'labelBackgroundColor',
    'labelBorderColor',
    'imageBorder',
    'imageBackground',
  ];
  static readonly MXGRAPH_STYLES_EVENT_ANIM: string[] = [
    'barPos',
    'gaugePos',
    'fontSize',
    'opacity',
    'textOpacity',
    'rotation',
  ];
  static readonly MXGRAPH_STYLES_EVENT_STATIC: string[] = [
    'shape',
    'endArrow',
    'startArrow',
    'flipH',
    'flipV',
    'gradientDirection',
    'image',
  ];
  static readonly MXGRAPH_STYLES_EVENT: string[] = [
    ...GFCONSTANT.MXGRAPH_STYLES_EVENT_ANIM,
    ...GFCONSTANT.MXGRAPH_STYLES_EVENT_STATIC,
  ];
  static readonly MXGRAPH_STYLES_ANIM: string[] = [
    ...GFCONSTANT.MXGRAPH_STYLES_COLOR,
    ...GFCONSTANT.MXGRAPH_STYLES_EVENT_ANIM,
  ];
  static readonly MXGRAPH_STYLES_STATIC: string[] = [...GFCONSTANT.MXGRAPH_STYLES_EVENT_STATIC];
  static readonly MXGRAPH_STYLES: string[] = [...GFCONSTANT.MXGRAPH_STYLES_ANIM, ...GFCONSTANT.MXGRAPH_STYLES_STATIC];

  // COMPARATORS
  static readonly COMP_LT = 'lt';
  static readonly COMP_LE = 'le';
  static readonly COMP_EQ = 'eq';
  static readonly COMP_NE = 'ne';
  static readonly COMP_GE = 'ge';
  static readonly COMP_GT = 'gt';
  static readonly COMP_AL = 'al';

  // CONDITIONS
  static readonly TOOLTIP_APPLYON: GFSelect[] = [
    { text: 'Warning / Critical', value: 'wc' },
    { text: 'Always', value: 'a' },
  ];
  static readonly COLOR_APPLYON: GFSelect[] = [
    { text: 'Never', value: 'n' },
    { text: 'Warning / Critical', value: 'wc' },
    { text: 'Always', value: 'a' },
  ];
  static readonly TEXT_APPLYON: GFSelect[] = [
    { text: 'Never', value: 'n' },
    { text: 'When Metric Displayed', value: 'wmd' },
    { text: 'Warning / Critical', value: 'wc' },
    { text: 'Critical Only', value: 'co' },
  ];
  static readonly LINK_APPLYON: GFSelect[] = [
    { text: 'Warning / Critical', value: 'wc' },
    { text: 'Always', value: 'a' },
  ];

  // TYPES
  static readonly VALUE_TYPES: GFSelect[] = [
    { text: 'Number', value: 'number' },
    { text: 'String', value: 'string' },
    { text: 'Date', value: 'date' },
  ];
  static readonly METRIC_TYPES: GFSelect[] = [
    { text: 'Series', value: 'serie' },
    { text: 'Table', value: 'table' },
  ];
  static readonly SOURCE_TYPES: GFSelect[] = [
    { text: 'XML', value: 'xml' },
    { text: 'CSV', value: 'csv' },
  ];
  static readonly DIOTHEME_TYPES: GFSelect[] = [
    { text: 'Dark', value: 'dark' },
    { text: 'Light', value: 'kennedy' },
    { text: 'Mobile', value: 'minimal' },
    { text: 'atlas', value: 'atlas' },
  ];
  static readonly IDENT_TYPES: GFSelect[] = [
    { text: 'Id', value: 'id' },
    { text: 'Label', value: 'value' },
    { text: 'Metadata', value: 'metadata' },
  ];
  static readonly AGGREGATION_TYPES: GFSelect[] = [
    { text: 'First', value: 'first' },
    { text: 'First (not null)', value: 'first_notnull' },
    { text: 'Last', value: 'current' },
    { text: 'Last (not null)', value: 'current_notnull' },
    { text: 'Min', value: 'min' },
    { text: 'Max', value: 'max' },
    { text: 'Sum', value: 'total' },
    { text: 'Avg', value: 'avg' },
    { text: 'Count', value: 'count' },
    { text: 'Delta', value: 'delta' },
    { text: 'Range', value: 'range' },
    { text: 'Diff', value: 'diff' },
    { text: 'Time of last point', value: 'last_time' },
  ];
  static readonly TOOLTIP_GRAPH_TYPES: GFSelect[] = [
    { text: 'Line', value: 'line' },
    { text: 'Histogram', value: 'bar' },
  ];
  static readonly TOOLTIP_GRAPH_SCALE_TYPES: GFSelect[] = [
    { text: 'Linear', value: 'linear' },
    { text: 'Logarithmic', value: 'log' },
  ];
  static readonly TOOLTIP_GRAPH_SIZE_TYPES: GFSelect[] = [
    { text: 'Adjustable', value: '100%' },
    { text: 'Small', value: '100px' },
    { text: 'Medium', value: '200px' },
    { text: 'Large', value: '400px' },
  ];
  static readonly TOOLTIP_DIRECTION_TYPES: GFSelect[] = [
    { text: 'Vertical', value: 'v' },
    { text: 'Horizontal ', value: 'h' },
  ];
  static readonly COMPARATOR_TYPES: GFSelect[] = [
    { text: 'Always', value: 'al' },
    { text: 'Less than', value: 'lt' },
    { text: 'Less than or equal to', value: 'le' },
    { text: 'Equal to', value: 'eq' },
    { text: 'Not equal to', value: 'ne' },
    { text: 'Greater than or equal to', value: 'ge' },
    { text: 'Greater than ', value: 'gt' },
  ];
  static readonly VALUE_DATEFORMAT_TYPES: GFSelect[] = [
    { text: 'YYYY-MM-DD HH:mm:ss', value: 'YYYY-MM-DD HH:mm:ss' },
    { text: 'YYYY-MM-DD HH:mm:ss.SSS', value: 'YYYY-MM-DD HH:mm:ss.SSS' },
    { text: 'MM/DD/YY h:mm:ss a', value: 'MM/DD/YY h:mm:ss a' },
    { text: 'MMMM D, YYYY LT', value: 'MMMM D, YYYY LT' },
    { text: 'YYYY-MM-DD', value: 'YYYY-MM-DD' },
  ];
  static readonly VALUEMAPPINGTYPES: Array<GFSelect<number>> = [
    { text: 'Value to text', value: 1 },
    { text: 'Range to text', value: 2 },
  ];

  // METHODS
  static readonly TEXTMETHODS: Array<GFSelect & { placeholder?: string }> = [
    { text: 'All content', value: 'content' },
    { text: 'Substring', value: 'pattern', placeholder: '/RegEx/' },
    { text: 'Append (Space) ', value: 'as' },
    { text: 'Append (New line) ', value: 'anl' },
  ];
  static readonly COLORMETHODS: GFSelect[] = [
    { text: 'Shape Stroke/Border', value: 'strokeColor' },
    { text: 'Shape Fill', value: 'fillColor' },
    { text: 'Shape Gradient', value: 'gradientColor' },
    { text: 'Label font color', value: 'fontColor' },
    { text: 'Label background color', value: 'labelBackgroundColor' },
    { text: 'Label border color', value: 'labelBorderColor' },
    { text: 'Image background', value: 'imageBackground' },
    { text: 'Image border', value: 'imageBorder' },
  ];
  static readonly EVENTMETHODS: GFEventMethod[] = [
    { text: 'Shape : Change form (text)', value: 'shape', type: 'text', placeholder: 'Shape name' },
    { text: 'Shape : Rotate Shape (0-360)', value: 'rotation', type: 'number', placeholder: '0-360', default: 0 },
    { text: 'Shape : Blink (frequence ms)', value: 'blink', type: 'number', placeholder: 'Number in ms', default: 500 },
    { text: 'Shape : Hide/Show (0|1)', value: 'visibility', type: 'number', placeholder: '0 or 1', typeahead: '0|1' },
    { text: 'Shape : Height (number)', value: 'height', type: 'number', placeholder: 'Number of px' },
    { text: 'Shape : Width (number)', value: 'width', type: 'number', placeholder: 'Number of px' },
    { text: 'Shape : Resize (percent)', value: 'size', type: 'number', placeholder: 'percent' },
    { text: 'Shape : Opacity (0-100)', value: 'opacity', type: 'number', placeholder: '0-100', default: 100 },
    {
      text: 'Shape : Gradient direction',
      value: 'gradientDirection',
      type: 'text',
      placeholder: 'Direction name',
      default: 'south',
      typeahead: 'south|east|north|west',
    },
    {
      text: 'Shape : Collapse/Expande (0|1)',
      value: 'fold',
      type: 'number',
      placeholder: '0 or 1',
      typeahead: '0|1',
      default: '1',
    },
    { text: 'Shape : Change position in Bar (0-100)', value: 'barPos', type: 'number', placeholder: '0-100' },
    { text: 'Shape : Change position in Gauge (0-100)', value: 'gaugePos', type: 'number', placeholder: '0-100' },
    {
      text: 'Shape : Flip horizontally (0|1)',
      value: 'flipH',
      type: 'number',
      placeholder: '0 or 1',
      typeahead: '0|1',
    },
    { text: 'Shape : Flip vertically (0|1)', value: 'flipV', type: 'number', placeholder: '0 or 1', typeahead: '0|1' },
    {
      text: 'Arrow : change start marker (text)',
      value: 'startArrow',
      type: 'text',
      placeholder: 'Marker',
      typeahead:
        'none|classic|classicThin|block|blockThin|open|openThin|oval|diamond|diamondThin|openAsync|async|box|halfCircle|dash|cross|circlePlus|circle|ERone|ERmandOne|ERoneToMany|ERzeroToOne',
    },
    {
      text: 'Arrow : change end marker (text)',
      value: 'endArrow',
      type: 'text',
      placeholder: 'Marker',
      typeahead:
        'none|classic|classicThin|block|blockThin|open|openThin|oval|diamond|diamondThin|openAsync|async|box|halfCircle|dash|cross|circlePlus|circle|ERone|ERmandOne|ERoneToMany|ERzeroToOne',
    },
    {
      text: 'Arrow : Anime flow (frequence ms)',
      value: 'class_mxEdgeFlow',
      type: 'number',
      placeholder: 'Number in ms',
    },
    { text: 'Label : Replace text (text)', value: 'text', type: 'text', placeholder: 'Text' },
    { text: 'Label : Font Size (numeric)', value: 'fontSize', type: 'number', placeholder: 'Number' },
    { text: 'Label : Opacity (numeric)', value: 'textOpacity', type: 'number', placeholder: '0-100', default: 100 },
    { text: 'Image : Change URL (text)', value: 'image', type: 'text', placeholder: 'Url' },
    { text: 'Tooltip : Add/Change tooltip text', value: 'tpText', type: 'text', placeholder: 'text' },
    {
      text: 'Tooltip : Add/Change metadata key and value',
      value: 'tpMetadata',
      type: 'text',
      placeholder: 'key@value',
    },
  ];

  static readonly LOCALVARIABLENAMES: GFSelect[] = [
    { text: 'Name of the rule', value: GFCONSTANT.VAR_STR_RULENAME },
    { text: 'Current date', value: GFCONSTANT.VAR_STR_DATE },
    { text: 'Current color according to the thresholds', value: GFCONSTANT.VAR_STR_COLOR },
    { text: 'Current raw value according to the aggregation', value: GFCONSTANT.VAR_NUM_VALUE },
    { text: 'Current level according to the thresholds', value: GFCONSTANT.VAR_NUM_LEVEL },
    { text: 'Current formated value accordingto the type', value: GFCONSTANT.VAR_STR_FORMATED },
  ];
}

// ---------------------------------------------------------------------------
// GFLog — leveled console logger (ported as-is; no Angular coupling)
// ---------------------------------------------------------------------------

export enum GFLogLevel {
  DEBUG,
  INFO,
  WARN,
  ERROR,
}

export class GFLog {
  static logLevel: GFLogLevel = GFLogLevel.WARN;
  static logEnable = true;
  static tagEnable = false;

  /**
   * If message must be displayed
   * @param level (DEBUG : 0, INFO : 1, WARN:2, ERROR:3)
   */
  static isEnable(level: number): boolean {
    if (GFLog.logEnable !== undefined && GFLog.logEnable === true) {
      if (GFLog.logLevel !== undefined && level >= GFLog.logLevel) {
        return true;
      }
    }
    return false;
  }

  static async debug(...args: unknown[]) {
    if (GFLog.isEnable(GFLogLevel.DEBUG)) {
      const title = args.shift();
      console.log(`GF DEBUG : ${title}`, ...args);
    }
  }

  static async warn(...args: unknown[]) {
    if (GFLog.isEnable(GFLogLevel.WARN)) {
      const title = args.shift();
      console.log(`GF WARN : ${title}`, ...args);
    }
  }

  static async info(...args: unknown[]) {
    if (GFLog.isEnable(GFLogLevel.INFO)) {
      const title = args.shift();
      console.log(`GF INFO : ${title}`, ...args);
    }
  }

  static async error(...args: unknown[]) {
    if (GFLog.isEnable(GFLogLevel.ERROR)) {
      const title = args.shift();
      console.log(`GF ERROR : ${title}`, ...args);
    }
  }
}

// ---------------------------------------------------------------------------
// uid — small framework-agnostic unique-id helper (replaces legacy `$GF.genUid`)
// ---------------------------------------------------------------------------

/**
 * Generate a short, collision-resistant unique id. Replaces the legacy
 * `$GF.genUid()` (which pulled in `nanoid` via the Angular `$GF` singleton) with
 * a dependency-free generator so this module stays framework-agnostic.
 *
 * @param name optional prefix, joined with a dash.
 */
export function genUid(name?: string): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return name ? `${name}-${id}` : id;
}

// ---------------------------------------------------------------------------
// GFPaths — asset/path resolution (ported from legacy GFPlugin, Angular-free)
// ---------------------------------------------------------------------------

/**
 * Resolves plugin asset paths from a configurable context root. The legacy
 * `GFPlugin` derived the root from Angular `$scope.$root.appSubUrl` and stored
 * `templateSrv`/`ctrl` on static fields; those Angular couplings are dropped.
 * The root is instead supplied explicitly (the Context_Seam / scaffold decides
 * the value), defaulting to the plugin's public path.
 */
export class GFPaths {
  static readonly DEFAULT_CONTEXT_ROOT = '/public/plugins/agenty-flowcharting-panel/';
  private static contextRoot: string = GFPaths.DEFAULT_CONTEXT_ROOT;

  private constructor() {}

  /** Set the context root used to resolve all asset paths. */
  static setContextRoot(root: string): void {
    GFPaths.contextRoot = root;
  }

  /** Root path for plugin assets. */
  static getRootPath(): string {
    return GFPaths.contextRoot;
  }

  /** Path for the `libs` directory. */
  static getLibsPath(): string {
    return `${GFPaths.getRootPath()}libs`;
  }

  /** Path for the draw.io libs directory. */
  static getDrawioPath(): string {
    return `${GFPaths.getLibsPath()}/drawio/`;
  }

  /** Path for static assets. */
  static getStaticPath(): string {
    return `${GFPaths.getRootPath()}/static/`;
  }

  /** mxBasePath — path for `mxClient.basePath`. */
  static getMxBasePath(): string {
    return `${GFPaths.getDrawioPath()}mxgraph/`;
  }

  /** Path for mxGraph styles. */
  static getMxStylePath(): string {
    return `${GFPaths.getDrawioPath()}styles/`;
  }

  /** Path for draw.io shape definitions. */
  static getShapesPath(): string {
    return `${GFPaths.getDrawioPath()}/shapes/`;
  }

  /** Path for HTML partials. */
  static getPartialPath(): string {
    return `${GFPaths.getRootPath()}partials/`;
  }

  /** Path for draw.io stencil JS. */
  static getStencilsPath(): string {
    return `${GFPaths.getDrawioPath()}/stencils/`;
  }

  /** Path for mxGraph CSS. */
  static getMxCssPath(): string {
    return `${GFPaths.getDrawioPath()}styles/`;
  }

  /** Path for mxGraph resources (CSS). */
  static getMxResourcePath(): string {
    return `${GFPaths.getMxBasePath()}css/`;
  }

  /** Path for mxGraph images. */
  static getMxImagePath(): string {
    return `${GFPaths.getMxBasePath()}images/`;
  }
}

// ---------------------------------------------------------------------------
// GFTable — resizable-table DOM helper (ported as-is, gf.* types localized)
// ---------------------------------------------------------------------------

export class GFTable {
  tableDiv: HTMLDivElement | undefined;
  tableData: GFTableData;
  pressed = false;
  headerTable: HTMLDivElement | undefined;
  bodyTable: HTMLDivElement | undefined;
  indexTable = 0;
  startX = 0;
  startWidth: any = 0;

  constructor(table: GFTableData, div?: HTMLDivElement) {
    this.tableData = table;
    this.tableDiv = div;
  }

  static create(table: GFTableData, div?: HTMLDivElement): GFTable {
    return new GFTable(table, div);
  }

  getWidth(id: string | number): string {
    return this.getColumnProperty(id, 'width');
  }

  getLeft(id: string | number): string {
    let sizes = 0;
    let found = false;
    this.tableData.columns.forEach((c) => {
      if (c.id !== id && found === false) {
        sizes += parseInt(c.width, 10);
      }
      if (c.id === id) {
        found = true;
      }
    });
    return `${sizes}px`;
  }

  getStyle(id: string | number): string {
    let style = '';
    if (this.haveProperty(id, 'width')) {
      const prop = this.getColumnProperty(id, 'width');
      style = `${style}width: ${prop};`;
    }
    if (this.haveProperty(id, 'align')) {
      const prop = this.getColumnProperty(id, 'align');
      style = `${style}text-align: ${prop};`;
    }
    return style;
  }

  getIndex(id: string): number {
    return this.getColumnProperty(id, 'index');
  }

  getId(index: number): string {
    return this.getColumnProperty(index, 'id');
  }

  getLabel(id: string | number): string {
    return this.getColumnProperty(id, 'label');
  }

  getDesc(id: string | number): string {
    return this.getColumnProperty(id, 'desc');
  }

  getColumnProperty(id: string | number, property: GFTableProperty): any {
    const result = `No value for property ${property}`;
    const isNumber = typeof id === 'number';
    for (let index = 0; index < this.tableData.columns.length; index++) {
      const element = this.tableData.columns[index];
      if ((isNumber && id === element.index) || (!isNumber && id === element.id)) {
        return element[property];
      }
    }
    return result;
  }

  haveProperty(id: string | number, property: GFTableProperty): boolean {
    const isNumber = typeof id === 'number';
    for (let index = 0; index < this.tableData.columns.length; index++) {
      const element = this.tableData.columns[index];
      if ((isNumber && id === element.index) || (!isNumber && id === element.id)) {
        return element[property] !== undefined && element[property] !== null;
      }
    }
    return false;
  }

  setColumnProperty(id: string | number, property: GFTableProperty, value: string): this {
    const isNumber = typeof id === 'number';
    for (let index = 0; index < this.tableData.columns.length; index++) {
      const element: any = this.tableData.columns[index];
      if ((isNumber && id === element.index) || (!isNumber && id === element.id)) {
        const prop: string = property;
        if (prop in element) {
          element[prop] = value;
        }
      }
    }
    return this;
  }

  findTableDiv(elt: HTMLElement): HTMLElement | undefined {
    if (elt !== null && elt !== undefined) {
      let node: any = elt;
      while (node !== null && this.tableDiv === undefined) {
        if (node.classList.contains('gf-table-main')) {
          this.tableDiv = node;
        } else {
          node = node.parentElement;
        }
      }
    }
    return this.tableDiv;
  }

  setTableDiv(div: HTMLDivElement) {
    this.tableDiv = div;
  }

  onMouseMove(event: MouseEvent) {
    if (this.pressed && this.headerTable && this.headerTable.parentNode) {
      const delta = event.pageX - this.startX;
      let width = this.startWidth + delta;
      if (width < 10) {
        width = 10;
      }
      this.headerTable.style.width = `${width}px`;
      if (this.bodyTable) {
        const rows = this.bodyTable.querySelectorAll('.gf-table-rows-resizable');
        Array.from(rows).forEach((r) => {
          const cells = r.querySelectorAll('.gf-table-cells-resizable');
          let index = 0;
          cells.forEach((cell) => {
            const node: any = cell;
            if (index === this.indexTable) {
              node.style.width = `${width}px`;
              this.setColumnProperty(index, 'width', `${width}px`);
            }
            index += 1;
          });
        });
      }
    }
  }

  onMouseDown(event: any) {
    this.pressed = true;
    this.startX = event.pageX;
    this.headerTable = event.currentTarget.parentElement;
    if (this.headerTable) {
      if (!this.tableDiv) {
        this.findTableDiv(this.headerTable);
      }
      if (this.headerTable.parentNode) {
        this.indexTable = Array.from(this.headerTable.parentNode.children).indexOf(this.headerTable);
      }
      this.headerTable.classList.add('gf-resizing');
      this.startWidth = parseInt(this.headerTable.style.width, 10);
      if (this.tableDiv) {
        const body: any = this.tableDiv.getElementsByClassName('gf-table-body')[0];
        this.bodyTable = body;
      } else {
        GFLog.error('Unable to find table definition with class gf-table-main');
      }
    }
  }

  onMouseUp(_event: MouseEvent) {
    this.pressed = false;
    if (this.headerTable) {
      this.headerTable.classList.remove('gf-resizing');
    }
  }
}

// ---------------------------------------------------------------------------
// GFTimer — cancelable, multi-step timer (ported as-is, $GF.genUid localized)
// ---------------------------------------------------------------------------

interface GFTimerStep {
  step: number;
  fn: CallableFunction;
  ms: number;
  running: boolean;
  runned: boolean;
  invalidated: boolean;
  tmId: number;
}

export class GFTimer {
  private _iteration = 0;
  private _cyclic = false;
  private _currentStep = 0;
  readonly uid: string;
  private static _timers: Map<string, GFTimer>;
  private _steps: GFTimerStep[];
  private _finished = false;

  private constructor(uid: string) {
    if (GFTimer._timers === undefined) {
      GFTimer._timers = new Map();
    }
    this._steps = [];
    this.uid = uid;
  }

  /** Return id of GFTimer */
  getUid(): string {
    return this.uid;
  }

  /** return true if timer is finished or not started */
  isFinished(): boolean {
    if (this._finished) {
      return true;
    }
    if (this._cyclic) {
      return false;
    }
    let allRunned = true;
    this._steps.forEach((step) => {
      allRunned = allRunned && step.runned;
    });
    return allRunned;
  }

  static async stop(timer?: string | GFTimer) {
    if (!GFTimer._timers) {
      GFTimer._timers = new Map();
    }

    if (typeof timer === 'string') {
      const result = GFTimer.get(timer);
      if (!result) {
        return;
      }
      timer = result;
    }

    if (timer) {
      // Remove one
      timer.cancel();
      GFTimer._timers.delete(timer.uid);
    } else {
      // Remove all
      const timers = Array.from(GFTimer._timers.values());
      await Promise.all(
        timers.map(async (gftimer) => {
          gftimer.cancel();
        })
      ).finally(() => {
        GFTimer._timers.clear();
      });
    }
  }

  /** Cyclic or not */
  setCyclic(bool = true): this {
    this._cyclic = bool;
    this._iteration = 0;
    return this;
  }

  /** Number of iteration */
  setIteration(it = 0): this {
    this._iteration = it;
    this._cyclic = false;
    return this;
  }

  _reinit(): this {
    this._currentStep = 0;
    this._steps.forEach((u) => {
      u.runned = false;
      u.invalidated = false;
    });
    return this;
  }

  /** stop & cancel timer */
  cancel(): this {
    this._steps.forEach((t) => {
      GFTimer._cleanStep(t);
    });
    this._finished = true;
    return this;
  }

  _getDefaultStepOption(): GFTimerStep {
    return {
      step: this._steps.length,
      fn: () => {},
      ms: 1000,
      running: false,
      runned: false,
      invalidated: false,
      tmId: 0,
    };
  }

  private static _cleanStep(step: GFTimerStep) {
    if (step !== undefined && step.invalidated === false && step.runned === false) {
      step.invalidated = true;
      GFTimer._stopTimeOut(step.tmId);
    }
  }

  private static _stopTimeOut(id: number) {
    try {
      if (id !== undefined) {
        window.clearTimeout(id);
      }
    } catch (error) {
      GFLog.warn('Failed to clear timeout thread', id, error);
    }
  }

  /**
   * Return a new timer
   * @param uid uniq id
   */
  static create(uid?: string): GFTimer {
    if (!uid) {
      uid = genUid();
    }
    GFTimer.stop(uid);
    const gftimer = new GFTimer(uid);
    GFTimer._timers.set(uid, gftimer);
    return gftimer;
  }

  /** Return a timer with uid if exists */
  static get(uid: string): GFTimer | null {
    if (GFTimer._timers) {
      const result = GFTimer._timers.get(uid);
      if (result) {
        return result;
      }
      return null;
    }
    return null;
  }

  /** Add a step function callback */
  addStep(fn: CallableFunction, ms: number): this {
    const unit = this._getDefaultStepOption();
    unit.fn = fn;
    unit.ms = ms;
    this._steps.push(unit);
    return this;
  }

  /** start the timer */
  start() {
    return Promise.all(
      this._steps.map(async (step: GFTimerStep) => {
        step.tmId = window.setTimeout(this._runnable.bind(this, step), step.ms);
      })
    );
  }

  private _runnable(step: GFTimerStep) {
    if (step.invalidated === false) {
      step.running = true;
      try {
        for (let i = this._currentStep; i < step.step; i++) {
          GFTimer._cleanStep(this._steps[i]);
        }
        step.fn();
      } catch (error) {
        GFLog.warn('Failed to run fn', error);
      }
      this._currentStep = step.step;
      step.running = false;
      step.runned = true;
      if (step.step === this._steps.length - 1) {
        if (this._cyclic || this._iteration > 1) {
          this._reinit();
          if (this._iteration > 0) {
            this._iteration = this._iteration - 1;
          }
          this.start();
        } else {
          GFTimer._timers.delete(this.uid);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// getCurrentDate — framework-agnostic "now" formatter (ported from
// `$GF.getCurrentDate`, which produced `YYYY-MM-DD HH:mm:ss`)
// ---------------------------------------------------------------------------

/**
 * Return the current date/time as `YYYY-MM-DD HH:mm:ss`. Ported verbatim from
 * the legacy `$GF.getCurrentDate()` (used to seed the `_date` local variable in
 * state application); the Angular `$GF` coupling is dropped.
 */
export function getCurrentDate(): string {
  const now = new Date();
  const pad = (n: number) => n.toLocaleString('en-US', { minimumIntegerDigits: 2, useGrouping: false });
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

// ---------------------------------------------------------------------------
// GFVariables — local variable store + template interpolation (ported from
// `globals_class.ts` `GFVariables`, Angular-free)
// ---------------------------------------------------------------------------

/**
 * A text interpolator the variable store delegates Grafana template-variable
 * resolution to. Supplied by the Context_Seam (`gf.interpolate`) so this stays
 * framework-agnostic — replacing the legacy `GFPlugin.getTemplateSrv().replace`
 * global reach.
 */
export type GFInterpolator = (text: string) => string;

/**
 * GFVariables — holds the per-cycle local variables set during state
 * application (`_rule`, `_level`, `_value`, `_formated`, `_color`, `_date`,
 * `_metric`) and substitutes them (plus Grafana template variables) into text.
 *
 * Ported from the legacy `GFVariables`. Two import swaps:
 *   - `GFPlugin.getTemplateSrv().replace` -> an injected {@link GFInterpolator}
 *     (the Context_Seam `gf.interpolate`);
 *   - `eval()`/`safe-eval` -> **removed** (no `eval`). The legacy `eval()` only
 *     ever resolved variable substitutions for event values, so `eval` now
 *     aliases `replaceText` — same substitution, no code execution.
 */
export class GFVariables {
  private _variables: Map<string, unknown> = new Map();
  private _interpolate: GFInterpolator;

  private constructor(interpolate?: GFInterpolator) {
    this._interpolate = interpolate ?? ((text: string) => text);
  }

  /** Create a variable store, optionally bound to a template interpolator. */
  static create(interpolate?: GFInterpolator): GFVariables {
    return new GFVariables(interpolate);
  }

  /** Set or redefine a local variable. */
  set(key: string, value: unknown): this {
    this._variables.set(key, value);
    return this;
  }

  /** Remove a local variable. */
  unset(key: string): this {
    this._variables.delete(key);
    return this;
  }

  /** Get a local variable value. */
  get(key: string): unknown {
    return this._variables.get(key);
  }

  /** Names of the declared local variables (without `${}`). */
  keys(): string[] {
    return Array.from(this._variables.keys());
  }

  /** The declared local variable names wrapped as `${name}`. */
  getVarsNames(): string[] {
    return this.keys().map((x) => '${' + x + '}');
  }

  /** Clear all local variables. */
  clear(): this {
    this._variables.clear();
    return this;
  }

  /**
   * Resolve Grafana template variables (via the injected interpolator) then
   * substitute the local variables. Mirrors the legacy `replaceText`.
   */
  replaceText(text: string): string {
    try {
      let out = this._interpolate(text);
      for (const [key, value] of this._variables) {
        out = out.replace('${' + key + '}', String(value));
      }
      return out;
    } catch (error) {
      return text;
    }
  }

  /**
   * Resolve variables in `text`. The legacy `eval()` ran the result through
   * `safe-eval`; since `eval` is forbidden here, this is a pure substitution
   * (the only use site — event map values — is a variable template).
   */
  eval(text: string): string {
    return this.replaceText(text);
  }
}
