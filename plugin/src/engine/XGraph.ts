/**
 * XGraph / XCell — the maxGraph-backed render engine, rewritten from the legacy
 * `src/graph_class.ts` (`XGraph`) and `src/cell_class.ts` (`XCell`) onto
 * `@maxgraph/core` 0.25 (design.md: Render_Engine; Req 2.1, 2.2, 2.3, 2.4, 4.5).
 *
 * Adopts the Task 3 spike findings (plugin/src/engine/spike/MAXGRAPH_SPIKE.md):
 *   - XML is loaded via `ModelXmlSerializer.import` inside `model.batchUpdate`
 *     (NOT the legacy `mxCodec` + `beginUpdate/endUpdate`).
 *   - A cell style may be a `CellStyle` OBJECT or a legacy `key=value;` STRING;
 *     the `MXGRAPH_STYLES*` get/set port handles both (via drawioCustom helpers).
 *   - No `eval`, no `globalThis`/`window.mx*`/`mx*` namespace mutation.
 *
 * `drawio_custom` behaviors (CSV import, custom fonts, click handlers,
 * zoom/pan/animation/highlight) live in `engine/drawioCustom.ts` and are called
 * from here — none of them mutate globals.
 */
import {
  Cell,
  CellHighlight,
  CellOverlay,
  CellState,
  type CellStateStyle,
  FitPlugin,
  Geometry,
  Graph,
  InternalEvent,
  ModelXmlSerializer,
  Rectangle,
} from '@maxgraph/core';
import { decode, isEncoded } from './diagramCodec';
import {
  addExtFont,
  attachClickHandler,
  calculateIntervalCounter,
  colorScaleSteps,
  createSurround,
  fitDisplay,
  getStyleValue,
  importCsv,
  installExtFonts,
  lazyZoomPointer,
  normalizeStyle,
  removeSurround,
} from './drawioCustom';
import { GFCONSTANT, GFLog, GFTimer, genUid } from '../logic/globals';
import { GFEvents } from '../logic/flowchartingBase';
import { matchString } from '../logic/logicHelpers';
import type { TPropertieKey, TRuleMapOptions, TStyleColorKeys } from '../logic/legacyTypes';
import type { TooltipHandler } from '../logic/engineRefs';
import type { SourceType } from '../types/options';

// ---------------------------------------------------------------------------
// XGraph signals (ported from `xgraphSignalsArray`)
// ---------------------------------------------------------------------------

export const XGRAPH_SIGNALS = ['graph_initialized', 'graph_updated', 'graph_changed', 'graph_freed'] as const;
export type XGraphSignals = typeof XGRAPH_SIGNALS[number];

/** Default map options when callers don't supply one (ported from Rule default). */
export function defaultMapOptions(): TRuleMapOptions {
  return { identByProp: 'id', metadata: '', enableRegEx: true };
}

/** The bus a click handler emits on — the preserved global GFEvents. */
export interface XCellClickEmitter {
  emit(signal: 'xcell_clicked', payload?: unknown): unknown;
}

// ===========================================================================
// XCell
// ===========================================================================

/** Default/captured values for an {@link XCell} (ported from `gf.TXCellGF`). */
interface XCellDefaults {
  id?: string;
  value?: string;
  metadata?: Map<string, string>;
  link?: string | null;
  styles?: Map<string, string | null>;
  dimension?: Geometry | null;
}

type XCellValueKey = 'id' | 'value' | 'metadata' | 'link' | 'dimension' | 'styles';

/**
 * XCell — a thin wrapper around a maxGraph {@link Cell}, porting
 * `src/cell_class.ts`. Captures the cell's id / value / metadata / link /
 * styles / dimension on first access (so they can be restored), and exposes
 * style get/set over the `MXGRAPH_STYLES*` key sets, handling both the
 * `CellStyle` object form and the legacy style string form.
 */
export class XCell {
  readonly uid: string;
  readonly graph: Graph;
  readonly mxcell: Cell;
  percent = 100;

  private _defaults: XCellDefaults = {};
  private _isHidden = false;
  private _isHighlighted = false;
  private _isBlink = false;
  private _surroundHL: Map<string, CellHighlight> = new Map();
  private _tooltipEnabled = false;
  private _tooltipHandler: TooltipHandler | undefined;

  constructor(graph: Graph, mxcell: Cell) {
    this.graph = graph;
    this.mxcell = mxcell;
    this.uid = String(mxcell.getId() ?? genUid('xcell'));
    this._isHidden = !mxcell.isVisible();
  }

  /** Factory mirroring the legacy `XCell.refactore`. */
  static refactore(graph: Graph, mxcell: Cell): XCell {
    return new XCell(graph, mxcell);
  }

  // --- Default-value capture ------------------------------------------------

  private _initDefault(type: XCellValueKey): this {
    if (this._defaults[type] === undefined) {
      this._setDefault(type);
    }
    return this;
  }

  private _setDefault(type: XCellValueKey): unknown {
    switch (type) {
      case 'id':
        return (this._defaults.id = this.getId());
      case 'value':
        return (this._defaults.value = this.getLabel());
      case 'link':
        return (this._defaults.link = this.getLink());
      case 'dimension':
        return (this._defaults.dimension = this.getDimension());
      case 'metadata':
        return (this._defaults.metadata = this.getMetadatas());
      case 'styles':
        if (this._defaults.styles === undefined) {
          this._defaults.styles = new Map();
        }
        return this._defaults.styles;
      default:
        throw new Error(`Unknown type: ${type}`);
    }
  }

  getDefaultValue(type: TPropertieKey | 'link' | 'dimension'): unknown {
    this._initDefault(type);
    const v = this._defaults[type as XCellValueKey];
    return v === undefined ? null : v;
  }

  getValue(type: TPropertieKey | 'link'): unknown {
    switch (type) {
      case 'id':
        return this.getId();
      case 'value':
        return this.getLabel();
      case 'link':
        return this.getLink();
      case 'metadata':
        return this.getDefaultValue('metadata');
      default:
        throw new Error(`Type ${type} not implemented in getValue()`);
    }
  }

  // NB: `getValues` / `getDefaultValues` return `any` to preserve the legacy
  // `cell_class` contract — a string for id/value, or a string[] for metadata —
  // which the rules-layer matchers forward unchanged (see logic/engineRefs
  // `XCellLike`). Narrowing this to `unknown` would break those existing call
  // sites in rule.ts / state.ts.
  getValues(options: TRuleMapOptions = defaultMapOptions()): any {
    if (options.identByProp === 'metadata') {
      return this.getDefaultMetadatasValues(options.metadata, options.enableRegEx);
    }
    return this.getValue(options.identByProp);
  }

  getDefaultValues(options: TRuleMapOptions = defaultMapOptions()): any {
    if (options.identByProp === 'metadata') {
      return this.getDefaultMetadatasValues(options.metadata, options.enableRegEx);
    }
    return this.getDefaultValue(options.identByProp);
  }

  // --- ID -------------------------------------------------------------------

  getId(): string {
    return String(this.mxcell.getId() ?? '');
  }

  getDefaultId(): string {
    return this.getDefaultValue('id') as string;
  }

  setId(id: string): this {
    this._initDefault('id');
    this.mxcell.setId(id);
    return this;
  }

  restoreId(): this {
    return this.setId(this.getDefaultId());
  }

  // --- Label ----------------------------------------------------------------

  getLabel(): string {
    const value = this.mxcell.getValue();
    if (value != null && typeof value === 'object' && typeof (value as Element).getAttribute === 'function') {
      return (value as Element).getAttribute('label') ?? '';
    }
    return value == null ? '' : String(value);
  }

  getDefaultLabel(): string {
    return this.getDefaultValue('value') as string;
  }

  setLabel(label: string): this {
    this._initDefault('value');
    this.graph.cellLabelChanged(this.mxcell, label, false);
    return this;
  }

  restoreLabel(): this {
    return this.setLabel(this.getDefaultLabel());
  }

  // --- Link -----------------------------------------------------------------
  // draw.io stores a cell's hyperlink as a `link` attribute on the value node.

  getLink(): string | null {
    const value = this.mxcell.getValue();
    if (value != null && typeof value === 'object' && typeof (value as Element).getAttribute === 'function') {
      return (value as Element).getAttribute('link');
    }
    return this.graph.getLinkForCell(this.mxcell);
  }

  getDefaultLink(): string | null {
    return this.getDefaultValue('link') as string | null;
  }

  setLink(link: string | null): this {
    this._initDefault('link');
    const value = this.mxcell.getValue();
    if (value != null && typeof value === 'object' && typeof (value as Element).setAttribute === 'function') {
      if (link == null) {
        (value as Element).removeAttribute('link');
      } else {
        (value as Element).setAttribute('link', link);
      }
    }
    return this;
  }

  restoreLink(): this {
    return this.setLink(this.getDefaultLink());
  }

  // --- Metadata -------------------------------------------------------------

  getMetadatas(): Map<string, string> {
    const result = new Map<string, string>();
    const value = this.mxcell.getValue();
    if (value != null && typeof value === 'object' && (value as Element).attributes) {
      const ignored = ['label', 'tooltip', 'placeholders', 'placeholder', 'link'];
      const attrs = (value as Element).attributes;
      for (let i = 0; i < attrs.length; i++) {
        const attr = attrs[i];
        if (!ignored.includes(attr.nodeName)) {
          result.set(attr.nodeName, attr.nodeValue ?? '');
        }
      }
    }
    return result;
  }

  getMetadata(key: string): string | null {
    return this.mxcell.getAttribute(key, null);
  }

  setMetadata(key: string, value: string | null): this {
    this._initDefault('metadata');
    this.mxcell.setAttribute(key, value);
    return this;
  }

  getDefaultMetadatasKeys(): string[] {
    const md = this.getDefaultValue('metadata') as Map<string, string> | null;
    return md ? Array.from(md.keys()) : [];
  }

  getDefaultMetadatasValues(name: string, regex = true): string[] {
    const md = this.getDefaultValue('metadata') as Map<string, string> | null;
    if (!md) {
      return [];
    }
    if (!regex && md.has(name)) {
      const value = md.get(name);
      return value != null ? [value] : [];
    }
    const values: string[] = [];
    for (const key of this.getDefaultMetadatasKeys()) {
      if (matchString(key, name, regex)) {
        const value = md.get(key);
        if (value != null) {
          values.push(value);
        }
      }
    }
    return values;
  }

  hasMetadataName(name: string): boolean {
    return this.getDefaultMetadatasKeys().includes(name);
  }

  private _matchMetadata(pattern: string, options: TRuleMapOptions): boolean {
    const values = this.getDefaultMetadatasValues(options.metadata, options.enableRegEx);
    return values.some((v) => matchString(v, pattern, options.enableRegEx));
  }

  // --- Styles (over the MXGRAPH_STYLES* key sets) --------------------------

  private _initDefaultStyle(style: string): this {
    if (this._defaults.styles === undefined) {
      this._defaults.styles = new Map();
    }
    if (!this._defaults.styles.has(style)) {
      this._setDefaultStyle(style);
    }
    return this;
  }

  private _setDefaultStyle(style: string): string | null {
    if (this._defaults.styles === undefined) {
      this._defaults.styles = new Map();
    }
    const value = this.getStyle(style);
    this._defaults.styles.set(style, value);
    return value;
  }

  /** Initial captured value of a style key. */
  getDefaultStyle(style: string): string | null {
    if (this._defaults.styles === undefined || !this._defaults.styles.has(style)) {
      return this._setDefaultStyle(style);
    }
    return this._defaults.styles.get(style) ?? null;
  }

  /**
   * Current value of a style key. Reads from the cell state's `CellStateStyle`
   * when available (object form), falling back to the cell's own style
   * (object OR legacy string) — the spike's required dual handling.
   */
  getStyle(style: string): string | null {
    const state = this.getMxCellState();
    if (state && state.style) {
      const v = (state.style as Record<string, unknown>)[style];
      if (v !== undefined && v !== null) {
        return String(v);
      }
    }
    // Fall back to the cell's declared style (object or legacy string).
    return getStyleValue(this.mxcell.getStyle(), style);
  }

  /** Set a style key on the cell, capturing its default first. */
  setStyle(style: string, value: string | null): this {
    this._initDefaultStyle(style);
    this.graph.setCellStyles(style as keyof CellStateStyle, value as never, [this.mxcell]);
    return this;
  }

  isStyleChanged(style: string): boolean {
    return this.getDefaultStyle(style) === this.getStyle(style);
  }

  restoreStyle(style: string): this {
    return this.setStyle(style, this.getDefaultStyle(style));
  }

  // --- Dimension ------------------------------------------------------------

  getDimension(): Geometry | null {
    return this.mxcell.getGeometry();
  }

  getDefaultDimension(): Geometry | null {
    return this.getDefaultValue('dimension') as Geometry | null;
  }

  setDimension(dim: Geometry | Rectangle): this {
    this.graph.resizeCell(this.mxcell, dim as Rectangle, true);
    return this;
  }

  restoreDimension(): this {
    const dim = this.getDefaultValue('dimension') as Geometry | null;
    if (dim) {
      this.setDimension(dim);
    }
    return this;
  }

  // --- Others ---------------------------------------------------------------

  getMxCell(): Cell {
    return this.mxcell;
  }

  getMxCellState(): CellState | null {
    return this.graph.getView().getState(this.mxcell);
  }

  isVertex(): boolean {
    return this.mxcell.isVertex();
  }

  isEdge(): boolean {
    return this.mxcell.isEdge();
  }

  // --- Visibility -----------------------------------------------------------

  hide(bool = true): void {
    const model = this.graph.getDataModel();
    if (!this._isHidden && bool) {
      model.setVisible(this.mxcell, false);
    } else if (this._isHidden && !bool) {
      model.setVisible(this.mxcell, true);
    }
    this._isHidden = bool;
  }

  show(): void {
    this.hide(false);
  }

  isHidden(): boolean {
    return this._isHidden;
  }

  // --- Highlight / surround / blink ----------------------------------------

  highlight(bool = true): void {
    const color = GFCONSTANT.CONF_HIGHTLIGHT_COLOR;
    if (!this._isHighlighted && bool) {
      this.surround(color, true, true);
    } else if (this._isHighlighted && !bool) {
      this.surround(color, true, false);
    }
    this._isHighlighted = bool;
  }

  unhighlight(): void {
    this.highlight(false);
  }

  isHighlighted(): boolean {
    return this._isHighlighted;
  }

  isSurrounded(color: string): boolean {
    return this._surroundHL.has(color);
  }

  surround(color: string, anim = true, bool = true): this {
    if (bool && !this.isSurrounded(color)) {
      const hl = createSurround(this.graph, this.mxcell, color, 100);
      if (hl) {
        this._surroundHL.set(color, hl);
      }
    } else if (!bool && this.isSurrounded(color)) {
      const hl = this._surroundHL.get(color);
      if (hl) {
        removeSurround(hl, anim);
        this._surroundHL.delete(color);
      }
    }
    return this;
  }

  unsurround(): this {
    this._surroundHL.forEach((hl, color) => {
      removeSurround(hl, false);
      this._surroundHL.delete(color);
    });
    return this;
  }

  blink(ms = 1000, bool = true): void {
    const timeId = `blink-${this.uid}`;
    const color = GFCONSTANT.CONF_BLINK_COLOR;
    if (bool && !this._isBlink) {
      const timer = GFTimer.create(timeId);
      timer.addStep(this.surround.bind(this, color, false, true), ms);
      timer.addStep(this.surround.bind(this, color, false, false), ms * 2);
      timer.setCyclic();
      timer.start();
    } else if (!bool && this._isBlink) {
      GFTimer.stop(timeId);
      this.surround(color, false, false);
    }
    this._isBlink = bool;
  }

  unblink(): void {
    this.blink(1000, false);
  }

  isBlink(): boolean {
    return this._isBlink;
  }

  // --- Collapse / fold (ported from cell_class.collapse/isCollapsed) -------

  /** Collapse (fold) or expand the cell. */
  collapse(bool = true): void {
    const collapsed = this.mxcell.isCollapsed();
    if (!collapsed && bool) {
      this.graph.foldCells(true, false, [this.mxcell], false, null);
    } else if (collapsed && !bool) {
      this.graph.foldCells(false, false, [this.mxcell], false, null);
    }
  }

  isCollapsed(): boolean {
    return this.mxcell.isCollapsed();
  }

  expand(): void {
    this.collapse(false);
  }

  // --- Tooltip handler attach (ported from cell_class.enableTooltip) -------
  // The legacy cell stored its tooltip enablement + handler in `gf.tooltip`;
  // here they live on the XCell. The concrete TooltipHandler lands in Task 11.

  enableTooltip(bool = true): this {
    this._tooltipEnabled = bool;
    if (!bool) {
      this._tooltipHandler?.destroy();
      this._tooltipHandler = undefined;
    }
    return this;
  }

  isTooltipEnabled(): boolean {
    return this._tooltipEnabled;
  }

  setTooltipHandler(tp: TooltipHandler): this {
    this._tooltipHandler = tp;
    return this;
  }

  getTooltipHandler(): TooltipHandler | undefined {
    return this._tooltipHandler;
  }

  // --- Overlay icon (ported from cell_class.addOverlay/removeOverlay) ------

  /** Add a warning/error overlay icon on the cell. */
  addOverlay(state: string): this {
    const image = this.graph.getWarningImage();
    const overlay = new CellOverlay(image, `State: ${state}`);
    this.graph.addCellOverlay(this.mxcell, overlay);
    return this;
  }

  /** Remove all overlays from the cell. */
  removeOverlay(): this {
    this.graph.removeCellOverlays(this.mxcell);
    return this;
  }

  // --- Zoom / resize (per-cell) --------------------------------------------

  zoom(percent = 100): void {
    const dim = this.getDefaultDimension();
    if (percent !== 100) {
      this._initDefault('dimension');
      if (dim) {
        const factor = percent / 100;
        const w = dim.width * factor;
        const h = dim.height * factor;
        const x = dim.x - (w - dim.width) / 2;
        const y = dim.y - (h - dim.height) / 2;
        this.setDimension(new Rectangle(x, y, w, h));
        this.percent = percent;
      }
    } else if (this.percent !== 100 && dim) {
      this.setDimension(dim);
      this.percent = 100;
    }
  }

  resize(width: number | undefined, height: number | undefined): void {
    this._initDefault('dimension');
    const dim = this.getDimension();
    if (dim) {
      let x = dim.x;
      let y = dim.y;
      x = width !== undefined && width < 0 ? x + width + dim.width : x;
      y = height !== undefined && height < 0 ? y + height + dim.height : y;
      const w = width !== undefined ? Math.abs(width) : dim.width;
      const h = height !== undefined ? Math.abs(height) : dim.height;
      this.setDimension(new Rectangle(x, y, w, h));
    }
  }

  // --- Match ----------------------------------------------------------------

  match(pattern: string, options: TRuleMapOptions): boolean {
    if (options.identByProp === 'id' || options.identByProp === 'value') {
      const value = this.getDefaultValue(options.identByProp) as string;
      return matchString(value, pattern, options.enableRegEx);
    }
    if (options.identByProp === 'metadata') {
      return this._matchMetadata(pattern, options);
    }
    throw new Error(`Unknown identByProp: ${String(options.identByProp)}`);
  }
}

// ===========================================================================
// XGraph
// ===========================================================================

/**
 * XGraph — the maxGraph render engine. Decodes a draw.io/mxGraph source (XML or
 * CSV) into a {@link Graph}, captures each cell as an {@link XCell}, exposes
 * lookup/match helpers the rules engine drives, and applies display options
 * (zoom, scale, center, lock, grid, tooltip, animation).
 */
export class XGraph {
  readonly uid: string;
  readonly container: HTMLElement;
  readonly events: GFEvents<XGraphSignals> = GFEvents.create(XGRAPH_SIGNALS);

  xcells: XCell[] = [];

  private _bus?: XCellClickEmitter;
  private _type: SourceType;
  private _definition: string;
  private _xmlGraph = '';
  private _csvGraph = '';
  private _graph?: Graph;
  private _initialized = false;
  private _detachClick?: () => void;

  // Display options (ported defaults from legacy XGraph).
  private _scale = true;
  private _tooltip = true;
  private _lock = true;
  private _center = true;
  private _animation = true;
  private _grid = false;
  private _zoomPercent = '1';
  private _cumulativeZoomFactor = 1;

  /**
   * @param container The host DOM element.
   * @param type `'xml'` or `'csv'`.
   * @param definition The raw source (mxGraph XML, an encoded diagram, or CSV).
   * @param bus Optional GFEvents bus for `xcell_clicked` emission.
   */
  constructor(container: HTMLElement, type: SourceType, definition: string, bus?: XCellClickEmitter) {
    this.uid = genUid('XGraph');
    this.container = container;
    this._type = type;
    this._definition = definition;
    this._bus = bus;
    this.init();
  }

  // --- Lifecycle ------------------------------------------------------------

  init(): this {
    if (this._type === 'xml') {
      this._xmlGraph = isEncoded(this._definition) ? decode(this._definition) : this._definition;
    } else {
      this._csvGraph = this._definition;
    }
    this.initGraph();
    return this;
  }

  initGraph(): this {
    if (this._initialized) {
      return this;
    }
    this._initMxGraph();
    this._display();
    this.updateOptions();
    this._initXCells();
    this._initialized = true;
    this.events.emit('graph_initialized', this);
    this.change();
    return this;
  }

  isInitialized(): boolean {
    return this._initialized;
  }

  change(): this {
    this.events.emit('graph_changed', this);
    return this;
  }

  update(): this {
    this.updateGraph();
    this.events.emit('graph_updated', this);
    return this;
  }

  clear(): void {
    this.xcells = [];
  }

  free(): this {
    GFLog.debug(`${this.constructor.name}.free() : ${this.uid}`);
    if (this._detachClick) {
      this._detachClick();
      this._detachClick = undefined;
    }
    this._graph?.destroy();
    this._graph = undefined;
    this.clear();
    this._initialized = false;
    this.events.emit('graph_freed', this);
    this.events.clear();
    return this;
  }

  // --- Source accessors -----------------------------------------------------

  set source(value: string) {
    if (this._type === 'xml') {
      this._xmlGraph = value;
    } else {
      this._csvGraph = value;
    }
  }

  get source(): string {
    return this._type === 'csv' ? this._csvGraph : this._xmlGraph;
  }

  getMxGraph(): Graph | undefined {
    return this._graph;
  }

  // --- maxGraph init --------------------------------------------------------

  private _initMxGraph(): void {
    const graph = new Graph(this.container);
    this._graph = graph;
    graph.setPanning(true);
    this.container.addEventListener('contextmenu', (e) => e.preventDefault());

    // Click handling — emit `xcell_clicked` on the bus (no monkey-patching).
    if (this._bus) {
      this._detachClick = attachClickHandler(graph, this._bus, (cell) =>
        cell ? this.getXCell(String(cell.getId())) : undefined
      );
    }

    // Double-click zooms into the cell (ported from eventDbClick).
    graph.addListener(InternalEvent.DOUBLE_CLICK, (_sender: unknown, evt: { getProperty: (k: string) => unknown }) => {
      const cell = evt.getProperty('cell') as Cell | null;
      if (cell) {
        const xcell = this.getXCell(String(cell.getId()));
        if (xcell) {
          this.lazyZoomCell(xcell);
        }
      }
    });
  }

  private _display(): this {
    const graph = this._graph;
    if (!graph) {
      throw new Error('Graph was not created');
    }
    const model = graph.getDataModel();
    try {
      if (this._type === 'xml') {
        model.batchUpdate(() => {
          model.clear();
          new ModelXmlSerializer(model).import(this._xmlGraph);
        });
        this._initFonts();
      } else {
        try {
          importCsv(graph, this._csvGraph);
        } catch (error) {
          GFLog.error('Bad CSV format', error);
        }
      }
    } catch (error) {
      GFLog.error('Error in draw', error);
    }
    return this;
  }

  private _initXCells(): void {
    const graph = this._graph;
    if (!graph) {
      return;
    }
    const model = graph.getDataModel();
    const all = (model as unknown as { cells?: Record<string, Cell> }).cells ?? {};
    this.xcells = Object.values(all).map((mxcell) => XCell.refactore(graph, mxcell));
  }

  private _initFonts(): void {
    const graph = this._graph;
    if (!graph) {
      return;
    }
    const model = graph.getDataModel() as unknown as { extFonts?: string };
    installExtFonts(model.extFonts);
  }

  // --- Options --------------------------------------------------------------

  updateOptions(): this {
    if (!this.isInitialized()) {
      return this;
    }
    this.zoomDisplay();
    this.enableTooltip();
    this.enableLock();
    this.scaleDisplay();
    this.centerDisplay();
    this.gridDisplay();
    this.enableAnimation();
    return this;
  }

  updateGraph(): this {
    if (!this.isInitialized() || !this._graph) {
      return this;
    }
    this._cumulativeZoomFactor = 1;
    this._graph.zoomActual();
    this.updateOptions();
    this._graph.refresh();
    return this;
  }

  enableLock(bool: boolean = this._lock): this {
    this._lock = bool;
    if (this._graph) {
      this._graph.setEnabled(!bool);
    }
    return this;
  }

  enableTooltip(bool: boolean = this._tooltip): this {
    this._tooltip = bool;
    if (this._graph) {
      this._graph.setTooltips(bool);
    }
    return this;
  }

  enableAnimation(bool: boolean = this._animation): this {
    this._animation = bool;
    return this;
  }

  isAnimated(): boolean {
    return this._animation;
  }

  centerDisplay(bool: boolean = this._center): this {
    this._center = bool;
    if (!this._graph) {
      return this;
    }
    this._graph.centerZoom = false;
    if (bool) {
      if (this._scale) {
        fitDisplay(this._graph);
      } else {
        this._graph.center(true, true);
      }
    } else {
      this._graph.center(false, false);
    }
    return this;
  }

  scaleDisplay(bool: boolean = this._scale): this {
    this._scale = bool;
    if (!this._graph) {
      return this;
    }
    if (!bool) {
      this.zoomDisplay();
      return this;
    }
    if (this._center) {
      fitDisplay(this._graph);
    } else {
      // maxGraph 0.25 moved `fit` to the FitPlugin (accessed via getPlugin).
      const fitPlugin = this._graph.getPlugin<FitPlugin>('fit');
      fitPlugin?.fit();
      this._graph.zoomActual();
    }
    return this;
  }

  gridDisplay(bool: boolean = this._grid): this {
    this._grid = bool;
    if (bool) {
      this.container.style.backgroundImage =
        "url('data:image/gif;base64,R0lGODlhCgAKAJEAAAAAAP///8zMzP///yH5BAEAAAMALAAAAAAKAAoAAAIJ1I6py+0Po2wFADs=')";
    } else {
      this.container.style.backgroundImage = '';
    }
    return this;
  }

  zoomDisplay(percent: string = this._zoomPercent): this {
    this._zoomPercent = percent;
    if (!this.isInitialized() || !this._graph) {
      return this;
    }
    if (!this._scale) {
      if (percent && percent.length > 0 && percent !== '100%' && percent !== '0%') {
        const ratio = Number(percent.replace('%', '')) / 100;
        if (!Number.isNaN(ratio) && ratio > 0) {
          this._graph.zoomTo(ratio, true);
        }
      }
      this._graph.zoomActual();
    } else {
      fitDisplay(this._graph);
    }
    return this;
  }

  // --- Cell lookup ----------------------------------------------------------

  getXCells(): XCell[] {
    return this.xcells;
  }

  getXCell(id: string): XCell | undefined {
    return this.xcells.find((x) => x.getDefaultValue('id') === id);
  }

  getXCellValues(type: TPropertieKey): string[] {
    return this.getXCells().map((c) => c.getDefaultValue(type) as string);
  }

  findXCells(pattern: string, options: TRuleMapOptions = defaultMapOptions()): XCell[] {
    return this.getXCells().filter((x) => x.match(pattern, options));
  }

  getDefaultValues(options: TRuleMapOptions): string[] {
    return this.getXCellValues(options.identByProp);
  }

  getDefaultValuesWithKey(options: TRuleMapOptions): string[] {
    const values = new Set<string>();
    for (const xcell of this.getXCells()) {
      const datas = xcell.getDefaultValues(options) as string[];
      if (Array.isArray(datas)) {
        datas.forEach((v) => {
          if (v != null && v.length > 0) {
            values.add(v);
          }
        });
      }
    }
    return Array.from(values.keys());
  }

  // --- Highlight over cell sets --------------------------------------------

  async highlightXCells(pattern: string, options?: TRuleMapOptions, bool = true): Promise<void> {
    this.findXCells(pattern, options).forEach((x) => x.highlight(bool));
  }

  async unhighlightXCells(pattern: string, options?: TRuleMapOptions): Promise<void> {
    return this.highlightXCells(pattern, options, false);
  }

  async highlightCells(xcells: XCell[] = this.getXCells()): Promise<void> {
    xcells.forEach((x) => x.highlight(true));
  }

  async unhighlightCells(xcells: XCell[] = this.getXCells()): Promise<void> {
    xcells.forEach((x) => x.highlight(false));
  }

  // --- Style predicates -----------------------------------------------------

  static isMxGraphStyle(type: string): boolean {
    return GFCONSTANT.MXGRAPH_STYLES.includes(type);
  }

  static isMxGraphAnimStyle(type: string): boolean {
    return GFCONSTANT.MXGRAPH_STYLES_ANIM.includes(type);
  }

  static isMxGraphStaticStyle(type: string): boolean {
    return GFCONSTANT.MXGRAPH_STYLES_STATIC.includes(type);
  }

  // --- Animated style / color / size / zoom (color-step, anim-step) --------

  /**
   * Apply a color style to a cell, animating through `CONF_COLORS_STEPS` steps
   * over `CONF_COLORS_MS` when animation is enabled — ported from
   * `setAnimColorCell` (the `chroma.scale(...).colors(n)` sweep, replaced by the
   * dependency-free lrgb `colorScaleSteps`).
   */
  setAnimColorCell(xcell: XCell, style: TStyleColorKeys, color: string | null): this {
    if (this.isAnimated() && color) {
      const startColor = xcell.getStyle(style);
      if (startColor) {
        const timeId = `${style}-${this.uid}-${xcell.uid}`;
        const steps = colorScaleSteps(startColor, color, GFCONSTANT.CONF_COLORS_STEPS);
        const timer = GFTimer.create(timeId);
        const ms = GFCONSTANT.CONF_COLORS_MS;
        for (let i = 1; i < steps.length; i++) {
          timer.addStep(xcell.setStyle.bind(xcell, style, steps[i]), ms * i);
        }
        timer.start();
      } else {
        xcell.setStyle(style, color);
      }
    } else {
      xcell.setStyle(style, color);
    }
    return this;
  }

  /**
   * Apply a numeric style to a cell, animating through `CONF_ANIMS_STEP` steps
   * over `CONF_ANIMS_MS` when enabled — ported from `setAnimStyleCell`.
   */
  async setAnimStyleCell(xcell: XCell, style: string, endValue: string | null, beginValue?: string): Promise<void> {
    if (this.isAnimated() && endValue !== null) {
      const end = Number(endValue);
      const begin = beginValue !== undefined ? Number(beginValue) : Number(xcell.getStyle(style));
      if (!Number.isNaN(end) && !Number.isNaN(begin) && end !== begin) {
        const timeId = `${style}-${this.uid}-${xcell.uid}`;
        const steps = calculateIntervalCounter(begin, end, GFCONSTANT.CONF_ANIMS_STEP);
        const timer = GFTimer.create(timeId);
        const ms = GFCONSTANT.CONF_ANIMS_MS;
        for (let i = 1; i < steps.length; i++) {
          const v = steps[i];
          timer.addStep(xcell.setStyle.bind(xcell, style, v === undefined ? endValue : String(v)), ms * i);
        }
        timer.start();
        return;
      }
    }
    xcell.setStyle(style, endValue);
  }

  /** Zoom a cell with animation (ported from `setAnimZoomCell`). */
  async setAnimZoomCell(xcell: XCell, percent: number): Promise<void> {
    if (this.isAnimated()) {
      const timeId = `setAnimZoomCell-${this.uid}-${xcell.getId()}`;
      const percents = calculateIntervalCounter(xcell.percent, percent, GFCONSTANT.CONF_ANIMS_STEP);
      const timer = GFTimer.create(timeId);
      const ms = GFCONSTANT.CONF_ANIMS_MS;
      for (let i = 1; i < percents.length; i++) {
        const p = percents[i];
        timer.addStep(xcell.zoom.bind(xcell, p === undefined ? percent : p), ms * i);
      }
      timer.start();
    } else {
      xcell.zoom(percent);
    }
  }

  /** Resize a cell with animation (ported from `setAnimSizeCell`). */
  async setAnimSizeCell(xcell: XCell, width: number | undefined, height: number | undefined): Promise<void> {
    const dim = xcell.getDimension();
    if (!dim) {
      return;
    }
    const wdir = width !== undefined && width >= 0 ? 1 : -1;
    const hdir = height !== undefined && height >= 0 ? 1 : -1;
    if (this.isAnimated()) {
      const timeId = `setAnimSizeCell-${this.uid}-${xcell.getId()}`;
      const widths = calculateIntervalCounter(dim.width * wdir, width, GFCONSTANT.CONF_ANIMS_STEP);
      const heights = calculateIntervalCounter(dim.height * hdir, height, GFCONSTANT.CONF_ANIMS_STEP);
      const timer = GFTimer.create(timeId);
      const ms = GFCONSTANT.CONF_ANIMS_MS;
      for (let i = 1; i < widths.length; i++) {
        timer.addStep(xcell.resize.bind(xcell, widths[i], heights[i]), ms * i);
      }
      timer.start();
    } else {
      xcell.resize(width, height);
    }
  }

  // --- Pointer/cell zoom (pan) ---------------------------------------------

  lazyZoomPointer(factor: number, offsetX: number, offsetY: number): void {
    if (!this._graph) {
      return;
    }
    this._cumulativeZoomFactor = factor;
    const scale = lazyZoomPointer(this._graph, factor, offsetX, offsetY);
    this._cumulativeZoomFactor = scale;
  }

  lazyZoomCenter(factor: number): void {
    this._graph?.zoomTo(factor, true);
  }

  lazyZoomCell(xcell: XCell): void {
    if (!this._graph || !xcell.isVertex()) {
      return;
    }
    const state = xcell.getMxCellState();
    if (state) {
      const bounds = new Rectangle(state.x, state.y, state.width, state.height);
      this._graph.zoomToRect(bounds);
      this._cumulativeZoomFactor = this._graph.getView().scale;
    }
  }

  // --- XML export -----------------------------------------------------------

  getXmlModel(): string {
    if (!this._graph) {
      return '';
    }
    return new ModelXmlSerializer(this._graph.getDataModel()).export();
  }
}
