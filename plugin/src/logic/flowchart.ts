/**
 * flowchart — the Flowchart class, ported **with import swaps only** from the
 * legacy `src/flowchart_class.ts` (design.md: Logic_Layer, "flowchart_class /
 * FlowchartHandler: import swaps — owns XGraph, now constructed from GFContext
 * + container ref instead of `ctrl`", Req 4.5).
 *
 * A Flowchart owns one {@link XGraph} (the maxGraph render engine) and one
 * {@link StateHandler} (the per-cell state application), wiring the two together
 * so that when the graph is (re)built, states are re-initialised against the new
 * cells. The option accessors (type/source/zoom/scale/center/lock/grid/tooltip/
 * animation/background), the `_convert` migration, and the show/hide navigation
 * helpers are preserved verbatim. Only the imports are swapped:
 *   - `$GF` / `$gf: $GF`         -> `gf: LogicContext`        (Context_Seam)
 *   - `$GF.genUid`               -> `genUid`                  (logic/globals)
 *   - `$GF.notify` / `clearNotify` -> `gf.notify` / `gf.clearNotify`
 *   - `$GF.resolveVars`          -> `gf.interpolate`          (seam)
 *   - `XGraph` ctor drops `$gf`  -> `new XGraph(container, type, content, bus)`
 *   - `StateHandler`             -> engine/statesHandler
 *   - `GFDrawio.*`               -> engine/diagramCodec (`decode`/`encode`/
 *                                   `isEncoded`/`isValidXml`); URL download via
 *                                   `fetch` (no `eval`, no global bundle)
 *   - `gf.TFlowchartData`        -> `FlowchartOptions`        (types/options)
 *   - `gf.TSourceTypeKeys`       -> `SourceType`              (types/options)
 *   - `gf.TRuleMapOptions`       -> `TRuleMapOptions`         (logic/legacyTypes)
 *
 * The legacy `minify`/`prettify`/`setMap`/`unsetMap`/`enableDioREssources`
 * helpers were already commented out or Angular-util-bound in the source and
 * are not part of the state-application path, so they are omitted here (no
 * orphaned code).
 *
 * No `$GF`, `$scope`, Angular, `grafana/app`, `globalThis`, or `mx*` global
 * mutation.
 */
import { XGraph } from '../engine/XGraph';
import { StateHandler } from '../engine/statesHandler';
import { decode, encode, isEncoded, isValidXml } from '../engine/diagramCodec';
import { GFLog, genUid } from './globals';
import { GFEvents } from './flowchartingBase';
import type { LogicContext } from './logicContext';
import type { TRuleMapOptions } from './legacyTypes';
import type { FlowchartOptions, SourceType } from '../types/options';

// Debug
const DEBUG = false;
const _log = (...args: any) => {
  DEBUG && console.log(...args);
};

// Define signals
const flowchartSignalsArray = [
  'flowchart_initialized',
  'flowchart_updated',
  'flowchart_changed',
  'flowchart_freed',
  'graph_changed',
] as const;
type FlowchartSignals = typeof flowchartSignalsArray[number];

/**
 * Flowchart — owns an XGraph + StateHandler for one diagram source.
 *
 * @export
 * @class Flowchart
 */
export class Flowchart {
  data: FlowchartOptions;
  private container: HTMLDivElement;
  private xgraph: XGraph | undefined;
  private stateHandler: StateHandler | undefined;
  private readonly gf: LogicContext;
  uid: string;
  visible = false;
  reduce = true;
  events: GFEvents<FlowchartSignals> = GFEvents.create(flowchartSignalsArray);

  constructor(gf: LogicContext, name: string, container: HTMLDivElement, newData: FlowchartOptions, oldData?: any) {
    this.gf = gf;
    this.uid = genUid(this.constructor.name);
    this.data = newData;
    this.data.name = name;
    this.container = container;
    if (oldData) {
      this._convert(oldData);
    }
    this.init();
  }

  //############################################################################
  //### INIT/UPDATE/CHANGE/FREE
  //############################################################################

  init() {
    const funcName = 'init';
    GFLog.debug(`${this.constructor.name}.${funcName}() : ${this.uid}`);
    this.init_xgraph();
    this.init_stateHandler();
    this.gf.events.connect('debug_asked', this, this._on_global_debug_asked.bind(this));
    this.events.emit('flowchart_initialized', this);
  }

  update() {
    const funcName = 'refresh';
    GFLog.debug(`${this.constructor.name}.${funcName}() : ${this.uid}`);
    this.update_graph();
    this.events.emit('flowchart_updated', this);
  }

  change() {
    this.change_xgraph();
    this.events.emit('flowchart_changed', this);
  }

  async free() {
    this?.xgraph?.events.disconnect('graph_changed', this);
    this.gf.events.disconnect('debug_asked', this);
    this.xgraph?.free();
    this.stateHandler?.free();
    await this.events.emit('flowchart_freed', this);
    this.events.clear();
    this.clear();
  }

  clear(): this {
    this.xgraph?.clear();
    this.stateHandler?.clear();
    return this;
  }

  //############################################################################
  //### ACCESSORS
  //############################################################################
  // NAME
  set name(value: string) {
    if (!value || value.length === 0 || value === this.data.name) {
      return;
    }
    this.data.name = value;
  }
  get name() {
    return this.data.name;
  }

  // TYPE
  set type(value: SourceType) {
    if (this.data.type !== value) {
      this.data.type = value;
      this.change();
    }
  }
  get type() {
    return this.data.type;
  }

  // SOURCE
  set source(value: string) {
    if (this.type === 'xml') {
      if (this.data.xml === value) {
        return;
      }
      value = isEncoded(value) ? decode(value) : value;
      if (isValidXml(value) === false) {
        this.gf.notify('Invalid XML format', 'error');
        return;
      }
      this.data.xml = value;
    }
    if (this.type === 'csv') {
      if (this.data.csv === value) {
        return;
      }
      this.data.csv = value;
    }
    this.change();
  }
  get source() {
    return this.data.type === 'csv' ? this.data.csv : this.data.xml;
  }

  // DOWNLOAD
  set download(value: boolean) {
    if (value === this.data.download) {
      return;
    }
    this.data.download = value;
    this.change();
  }
  get download() {
    return this.data.download;
  }

  // URL
  set url(value: string) {
    if (value === this.data.url) {
      return;
    }
    this.data.url = value;
    this.change();
  }
  get url() {
    return this.data.url;
  }

  // BACKGROUND
  set background(value: string) {
    if (value !== this.data.bgColor) {
      this.data.bgColor = value ?? '';
      this._colorBackgroundContainer(value);
    }
  }
  get background() {
    return this.data.bgColor ?? '';
  }

  // SCALE
  set scale(value: boolean) {
    if (value === this.data.scale || !this.xgraph) {
      return;
    }
    this.data.scale = value;
    this.scaleGraph(value);
  }
  get scale() {
    return this.data.scale;
  }

  // CENTER
  set center(value: boolean) {
    if (value === this.data.center || !this.xgraph) {
      return;
    }
    this.data.center = value;
    this.centerGraph(value);
  }
  get center() {
    return this.data.center;
  }

  // TOOLTIP
  set tooltip(value: boolean) {
    if (value === this.data.tooltip || !this.xgraph) {
      return;
    }
    this.data.tooltip = value;
    this.enableTooltip(value);
  }
  get tooltip() {
    return this.data.tooltip;
  }

  // GRID
  set grid(value: boolean) {
    if (value === this.data.grid || !this.xgraph) {
      return;
    }
    this.data.grid = value;
    this.enableGrid(value);
  }
  get grid() {
    return this.data.grid;
  }

  // LOCK
  set lock(value: boolean) {
    if (value === this.data.lock || !this.xgraph) {
      return;
    }
    this.data.lock = value;
    this.enableLock(value);
  }
  get lock() {
    return this.data.lock;
  }

  // ANIMATION
  set animation(value: boolean) {
    if (value === this.data.enableAnim || !this.xgraph) {
      return;
    }
    this.data.enableAnim = value;
    this.enableAnimation(value);
  }
  get animation() {
    return this.data.enableAnim;
  }

  // ZOOM
  set zoom(value: string) {
    if (value === this.data.zoom || !this.xgraph) {
      return;
    }
    this.data.zoom = value;
    this.zoomGraph(value);
  }
  get zoom() {
    return this.data.zoom;
  }

  //############################################################################
  //### LOGIC
  //############################################################################
  private _convert(oldData: any): this {
    GFLog.info(`flowchart[${this.data.name}].import()`);
    if (!!oldData.download || this.data.download === false) {
      this.data.download = oldData.download;
    }
    // 0.3.0
    if (!!oldData.source) {
      this.data.type = oldData.source.type;
      this.data.xml = oldData.source.xml.value;
      this.data.url = oldData.source.url.value;
    }
    // 0.3.0
    if (!!oldData.options) {
      this.data.zoom = oldData.options.zoom;
      this.data.center = oldData.options.center;
      this.data.scale = oldData.options.scale;
      this.data.lock = oldData.options.lock;
      this.data.tooltip = oldData.options.tooltip;
      this.data.grid = oldData.options.grid;
      this.data.bgColor = oldData.options.bgColor;
    }
    if (!!oldData.type) {
      this.data.type = oldData.type;
    }
    if (!!oldData.xml) {
      this.data.xml = oldData.xml;
    }
    // 0.9.0
    if (!!oldData.csv) {
      this.data.csv = oldData.csv;
    }
    if (!!oldData.url) {
      this.data.url = oldData.url;
    }
    if (!!oldData.zoom) {
      this.data.zoom = oldData.zoom;
    }
    if (!!oldData.center || oldData.center === false) {
      this.data.center = oldData.center;
    }
    if (!!oldData.scale || oldData.scale === false) {
      this.data.scale = oldData.scale;
    }
    if (!!oldData.lock || oldData.lock === false) {
      this.data.lock = oldData.lock;
    }
    if (!!oldData.enableAnim || oldData.enableAnim === false) {
      this.data.enableAnim = oldData.enableAnim;
    }
    if (!!oldData.tooltip) {
      this.data.tooltip = oldData.tooltip;
    }
    if (!!oldData.grid || oldData.grid === false) {
      this.data.grid = oldData.grid;
    }
    if (!!oldData.bgColor) {
      this.data.bgColor = oldData.bgColor;
    }
    return this;
  }

  /**
   * Return the default data for a new flowchart.
   */
  static getDefaultData(): FlowchartOptions {
    return {
      name: 'Main',
      xml: '',
      csv: '',
      download: false,
      type: 'xml',
      url: 'http://<YourUrl>/<Your XML/drawio file/api>',
      zoom: '100%',
      center: true,
      scale: true,
      lock: true,
      enableAnim: true,
      tooltip: true,
      grid: false,
      bgColor: null,
    };
  }

  /**
   * Return data without functions to save json in grafana.
   */
  getData(): FlowchartOptions {
    return this.data;
  }

  init_stateHandler(): this {
    if (this.stateHandler) {
      this.stateHandler.free();
    }
    if (this.xgraph) {
      this.stateHandler = new StateHandler(this.gf, this.xgraph);
    }
    return this;
  }

  /**
   * Build (or rebuild) the XGraph from the resolved source, then re-wire states.
   */
  async init_xgraph() {
    try {
      return this.resolveSource().then((content) => {
        if (this.xgraph !== undefined) {
          this.xgraph.free();
        }
        // XGraph now takes (container, type, definition, bus) — the bus is the
        // preserved GFEvents so cell clicks emit `xcell_clicked`.
        this.xgraph = new XGraph(this.container, this.data.type, content, this.gf.events);
        this.xgraph.events.connect('graph_changed', this, this._on_flowchart_graph_changed.bind(this));
        this.update_graph();
        this.events.emit('graph_changed', this.xgraph);
      });
    } catch (error) {
      this.gf.notify('Unable to initialize graph', 'error');
      GFLog.error('Unable to initialize graph', error);
    }
    return;
  }

  change_xgraph(): this {
    try {
      this.init_xgraph();
      this.gf.clearNotify();
    } catch (error) {
      this.gf.notify('Unable to initialize graph', 'error');
      GFLog.error('Unable to initialize graph', error);
    }
    return this;
  }

  getStateHandler() {
    return this.stateHandler;
  }

  getXGraph() {
    return this.xgraph;
  }

  /**
   * Apply all display options onto the graph.
   */
  update_graph(): this {
    this.scaleGraph();
    this.centerGraph();
    this.enableGrid();
    this.enableTooltip();
    this.enableLock();
    this.zoomGraph();
    this.enableAnimation();
    this._colorBackgroundContainer(this.data.bgColor);
    this.xgraph?.update();
    return this;
  }

  enableLock(bool: boolean = this.lock): this {
    if (this.xgraph) {
      this.xgraph.enableLock(bool);
    }
    return this;
  }

  enableAnimation(bool: boolean = this.animation): this {
    if (this.xgraph) {
      this.xgraph.enableAnimation(bool);
    }
    return this;
  }

  enableTooltip(bool: boolean = this.tooltip): this {
    if (this.xgraph) {
      this.xgraph.enableTooltip(bool);
    }
    return this;
  }

  scaleGraph(bool: boolean = this.scale): this {
    this.xgraph?.scaleDisplay(bool);
    return this;
  }

  private _colorBackgroundContainer(color: string | null = this.background): this {
    if (color) {
      this.container.style.backgroundColor = color;
    } else {
      this.container.style.backgroundColor = '';
    }
    return this;
  }

  /**
   * Names according to id or value, for the given map options.
   */
  getNamesByOptions(options: TRuleMapOptions, type: 'key' | 'value' = 'key'): string[] {
    let values: string[] = [];
    if (this.xgraph) {
      if (type === 'key') {
        values = this.xgraph.getDefaultValues(options);
      } else {
        values = this.xgraph.getDefaultValuesWithKey(options);
      }
    }
    return values;
  }

  centerGraph(bool: boolean = this.center): this {
    this.xgraph?.centerDisplay(bool);
    return this;
  }

  zoomGraph(percent: string = this.zoom): this {
    if (this.xgraph) {
      this.xgraph.zoomDisplay(this.data.zoom);
    }
    return this;
  }

  enableGrid(bool: boolean = this.grid): this {
    if (this.xgraph) {
      this.xgraph.gridDisplay(this.data.grid);
    }
    return this;
  }

  /**
   * Resolve the diagram source (csv|xml), downloading from the URL when
   * `download` is set. The legacy `GFDrawio.loadFile` global-bundle fetch is
   * replaced with a plain `fetch` (no `eval`, no global mutation); the empty-
   * source draw.io template path is deferred to the draw.io integration
   * (Task 12) and resolves to an empty definition here.
   */
  async resolveSource(replaceVarBool = true): Promise<string> {
    let content = '';
    if (this.download) {
      const url = this.gf.interpolate(this.data.url);
      this.gf.notify(`Loading content definition for ${this.data.name}`, 'info');
      try {
        const response = await fetch(url);
        content = await response.text();
      } catch (error) {
        GFLog.error('Unable to load content from url', error);
        content = '';
      }
      this.gf.clearNotify();
      if (content !== null && replaceVarBool) {
        content = this.gf.interpolate(content);
      }
    } else {
      content = this.source ?? '';
      if (isEncoded(content)) {
        content = decode(content);
      }
      content = replaceVarBool ? this.gf.interpolate(content) : content;
    }
    return content;
  }

  decode() {
    if (isEncoded(this.data.xml)) {
      this.data.xml = decode(this.data.xml);
    }
  }

  encode() {
    if (!isEncoded(this.data.xml)) {
      const xml = encode(this.data.xml);
      this.data.xml = xml ? xml : this.data.xml;
    }
  }

  getContainer(): HTMLDivElement {
    return this.container;
  }

  toFront(forceRefresh = false): this {
    this.visible = true;
    this.container.className = 'gf-flowchartShow';
    if (forceRefresh) {
      this.update_graph();
    }
    return this;
  }

  toBack(): this {
    this.visible = false;
    this.container.className = 'gf-flowchartHide';
    return this;
  }

  isVisible(): boolean {
    return this.visible;
  }

  //###########################################################################
  //### EVENTS
  //###########################################################################
  private _on_flowchart_graph_changed() {
    _log('📬', this.constructor.name, '_on_flowchart_graph_changed');
    if (this.xgraph) {
      this.init_stateHandler();
    }
  }

  private _on_global_debug_asked() {
    _log('📬', this.constructor.name, '_on_global_debug_asked');
    _log('🗃️', this.constructor.name, this);
  }
}
