/**
 * drawioCustom — a no-global-side-effect reimplementation of the behaviors the
 * legacy `src/drawio_custom.js` attached to the draw.io/mxGraph global bundle,
 * rebuilt on `@maxgraph/core` 0.25 (design.md: Render_Engine; Req 2.1, 2.2, 2.3,
 * 2.4, 4.5).
 *
 * The legacy module mutated the global draw.io runtime (`window[layout]`,
 * `mxUtils`, `mxResources`, `mxConstants`, `Editor.GOOGLE_FONTS`, `mxClient`,
 * ...). Every behavior here is instead expressed as a pure/instance-scoped
 * helper that takes a `Graph` (or the relevant primitives) explicitly. There is
 * **no `eval`**, and **no `globalThis`/`window.mx*`/`mx*` namespace mutation**:
 *
 *   - `importCsv`        — draw.io CSV → cells, using the maxGraph model API.
 *   - `addExtFont`       — inject a scoped `@font-face`/stylesheet `<link>`,
 *                          deduped by id (the one unavoidable DOM touch; it adds
 *                          a tagged element, it does not mutate any global API).
 *   - `attachClickHandler` — wire graph clicks to emit `xcell_clicked` on the bus.
 *   - color / anim / zoom / pan / highlight / blink step helpers — pure math +
 *     per-call timers, driving `CellStyle` mutations through the model.
 *
 * `XGraph`/`XCell` (engine/XGraph.ts) are the consumers of these helpers.
 */
import { Cell, CellHighlight, type CellStateStyle, Geometry, Graph, InternalEvent, Rectangle } from '@maxgraph/core';
import { GFLog } from '../logic/globals';
import { calculateColorForRatio } from '../logic/logicHelpers';

// ---------------------------------------------------------------------------
// Interval / step math (ported from `$GF.calculateIntervalCounter`, Angular-free)
// ---------------------------------------------------------------------------

/**
 * Produce `count` interpolated steps from `begin` to `end` (inclusive end),
 * matching the legacy `$GF.calculateIntervalCounter` used to animate numeric
 * styles, size and zoom. Returns `[... , end]` with `undefined` entries when a
 * bound is missing (legacy behavior).
 */
export function calculateIntervalCounter(
  begin: number | undefined,
  end: number | undefined,
  count: number
): Array<number | undefined> {
  const result: Array<number | undefined> = [];
  let step: number | undefined;
  let current: number | undefined;
  if (begin !== undefined && end !== undefined) {
    const distance = end - begin;
    step = Math.round(distance / count);
    current = begin;
  } else {
    step = undefined;
  }
  let index = 0;
  for (index = 0; index < count; index++) {
    if (step !== undefined && current !== undefined) {
      current += step;
    } else {
      current = undefined;
    }
    result.push(current);
  }
  result[index] = end;
  return result;
}

/**
 * Compute the color scale steps between `startColor` and `endColor`, preserving
 * the legacy `chroma.scale([start, end]).mode('lrgb').colors(steps + 1)` output
 * via the dependency-free `calculateColorForRatio` (same lrgb blend).
 */
export function colorScaleSteps(startColor: string, endColor: string, steps: number): string[] {
  const out: string[] = [];
  for (let i = 0; i <= steps; i++) {
    out.push(calculateColorForRatio(startColor, endColor, i / steps));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Style normalization — CellStyle object OR legacy `key=value;` string
// ---------------------------------------------------------------------------

/**
 * Normalize a maxGraph cell style into a mutable `CellStateStyle` object.
 * maxGraph 0.25 exposes a `CellStyle` object, but a legacy `key=value;` string
 * can still arrive (e.g. from CSV import or hand-authored XML). This accepts
 * both — the spike's required robustness (MAXGRAPH_SPIKE.md gap #2).
 */
export function normalizeStyle(style: unknown): CellStateStyle {
  if (style == null) {
    return {};
  }
  if (typeof style === 'object') {
    return { ...(style as CellStateStyle) };
  }
  if (typeof style === 'string') {
    return parseStyleString(style);
  }
  return {};
}

/** Parse a legacy `key=value;` (or `baseStyle;key=value`) style string. */
export function parseStyleString(style: string): CellStateStyle {
  const result: Record<string, unknown> = {};
  const parts = style.split(';');
  for (const part of parts) {
    if (part.length === 0) {
      continue;
    }
    const eq = part.indexOf('=');
    if (eq < 0) {
      // A bare token (base style name) — maxGraph expresses this via baseStyleNames.
      const names = (result.baseStyleNames as string[]) ?? [];
      names.push(part);
      result.baseStyleNames = names;
      continue;
    }
    const key = part.substring(0, eq);
    const raw = part.substring(eq + 1);
    const num = Number(raw);
    if (raw === '0' || raw === '1') {
      // Preserve booleans commonly encoded as 0/1 in mxGraph as numbers.
      result[key] = num;
    } else if (raw !== '' && !Number.isNaN(num)) {
      result[key] = num;
    } else {
      result[key] = raw;
    }
  }
  return result as CellStateStyle;
}

/** Read a single style key from a style that may be an object or a string. */
export function getStyleValue(style: unknown, key: string): string | null {
  const obj = normalizeStyle(style) as Record<string, unknown>;
  const value = obj[key];
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Custom fonts (scoped DOM injection, deduped — no global API mutation)
// ---------------------------------------------------------------------------

const GOOGLE_FONTS = 'https://fonts.googleapis.com/css?family=';

/**
 * Register an external font by name/url. Mirrors the legacy `addExtFont`: a
 * Google Fonts url is added as a `<link rel="stylesheet">`, anything else as an
 * inline `@font-face` `<style>`. Deduped by a stable `extFont_<name>` id so
 * re-registration is idempotent. This adds a tagged element to the document
 * head; it does not touch any global draw.io/mxGraph API.
 */
export function addExtFont(fontName: string, fontUrl: string, doc: Document = document): void {
  if (!fontName || !fontUrl) {
    return;
  }
  const fontId = `extFont_${fontName}`;
  if (doc.getElementById(fontId) !== null) {
    return;
  }
  const head = doc.getElementsByTagName('head')[0];
  if (!head) {
    return;
  }
  if (fontUrl.indexOf(GOOGLE_FONTS) === 0) {
    const link = doc.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', fontUrl);
    link.setAttribute('id', fontId);
    head.appendChild(link);
  } else {
    const style = doc.createElement('style');
    style.appendChild(
      doc.createTextNode(`@font-face {\n\tfont-family: "${fontName}";\n\tsrc: url("${fontUrl}");\n}`)
    );
    style.setAttribute('id', fontId);
    head.appendChild(style);
  }
}

/**
 * Parse and install the `extFonts` directive carried on an mxGraph model
 * (`name^url|name^url`), mirroring the legacy `_init_fonts`. Reads the raw
 * attribute from the decoded `<mxGraphModel extFonts="...">` root.
 */
export function installExtFonts(extFonts: string | null | undefined, doc: Document = document): void {
  if (!extFonts) {
    return;
  }
  try {
    const fonts = extFonts.split('|').map((ef) => {
      const parts = ef.split('^');
      return { name: parts[0], url: parts[1] };
    });
    for (const f of fonts) {
      addExtFont(f.name, f.url, doc);
    }
  } catch (e) {
    GFLog.error('ExtFonts format error:', (e as Error)?.message);
  }
}

// ---------------------------------------------------------------------------
// Click handling — emit `xcell_clicked` on a bus (no global side effects)
// ---------------------------------------------------------------------------

/** Minimal bus contract the click handler needs (the GFEvents `xcell_clicked`). */
export interface ClickEmitter {
  emit(signal: 'xcell_clicked', payload?: unknown): unknown;
}

/**
 * Attach a click handler to `graph` that emits `xcell_clicked` on `bus` with the
 * resolved payload (the caller maps the clicked `Cell` to its `XCell`). Mirrors
 * the legacy `_on_xgraph_mxcell_clicked`, but wired through `InternalEvent.CLICK`
 * on the graph (an `EventSource`) instead of monkey-patching `graph.click`.
 *
 * @returns a disposer that removes the listener.
 */
export function attachClickHandler(
  graph: Graph,
  bus: ClickEmitter,
  resolve: (cell: Cell | null) => unknown
): () => void {
  const listener = (_sender: unknown, evt: { getProperty: (k: string) => unknown }) => {
    const cell = (evt.getProperty('cell') as Cell | null) ?? null;
    bus.emit('xcell_clicked', resolve(cell));
  };
  graph.addListener(InternalEvent.CLICK, listener);
  return () => {
    // EventSource stores listeners in `eventListeners`; maxGraph exposes
    // removeListener on EventSource.
    (graph as unknown as { removeListener: (fn: Function) => void }).removeListener(listener);
  };
}

// ---------------------------------------------------------------------------
// Highlight / surround (ported from XCell.surround on CellHighlight)
// ---------------------------------------------------------------------------

/**
 * Create a `CellHighlight` surrounding the given cell's state with the supplied
 * color. Returns the highlight so the caller can later remove it (optionally
 * with a fade transition). Mirrors the legacy `surround`'s add branch.
 */
export function createSurround(graph: Graph, cell: Cell, color: string, opacity = 100): CellHighlight | null {
  const state = graph.getView().getState(cell);
  if (!state) {
    return null;
  }
  const strokeWidth = Math.max(5, Number(state.style?.strokeWidth ?? 1) + 4);
  const hl = new CellHighlight(graph, color, strokeWidth, false);
  hl.opacity = opacity;
  hl.highlight(state);
  return hl;
}

/**
 * Remove a surround highlight, optionally fading it out first (300ms), matching
 * the legacy `surround`'s remove branch.
 */
export function removeSurround(hl: CellHighlight, anim = true): void {
  const transition = 300;
  const shape = hl.shape;
  if (shape && shape.node) {
    if (anim) {
      const node = shape.node as unknown as { style: CSSStyleDeclaration };
      node.style.transition = `all ${transition}ms ease-in-out`;
      node.style.opacity = '0';
      window.setTimeout(() => hl.destroy(), transition);
    } else {
      hl.destroy();
    }
  } else {
    hl.destroy();
  }
}

// ---------------------------------------------------------------------------
// Zoom / pan helpers (pure view math, ported from XGraph fit/zoom)
// ---------------------------------------------------------------------------

/**
 * Fit the graph into its container with margin/max bounds, centering it — ported
 * from the legacy `_fitDisplay` (scaleAndTranslate math is identical).
 */
export function fitDisplay(graph: Graph, margin = 2, max = 3): void {
  const view = graph.getView();
  const bounds = graph.getGraphBounds();
  const container = graph.container;
  const cw = container.clientWidth - margin;
  const ch = container.clientHeight - margin;
  const scale = view.scale || 1;
  const w = bounds.width / scale;
  const h = bounds.height / scale;
  if (w <= 0 || h <= 0) {
    return;
  }
  const s = Math.min(max, Math.min(cw / w, ch / h));
  view.scaleAndTranslate(
    s,
    (margin + cw - w * s) / (2 * s) - bounds.x / scale,
    (margin + ch - h * s) / (2 * s) - bounds.y / scale
  );
}

/**
 * Lazy pointer zoom (ported from `lazyZoomPointer`). Returns the new cumulative
 * factor so the caller can track it.
 */
export function lazyZoomPointer(
  graph: Graph,
  cumulativeFactor: number,
  offsetX: number,
  offsetY: number
): number {
  const view = graph.getView();
  let dx = offsetX * 2;
  let dy = offsetY * 2;
  let factor = cumulativeFactor / view.scale;
  const scale = Math.round(view.scale * factor * 100) / 100;
  factor = scale / view.scale;
  if (factor > 1) {
    const f = (factor - 1) / (scale * 2);
    dx *= -f;
    dy *= -f;
  } else {
    const f = (1 / factor - 1) / (view.scale * 2);
    dx *= f;
    dy *= f;
  }
  view.scaleAndTranslate(scale, view.translate.x + dx, view.translate.y + dy);
  return scale;
}

// ---------------------------------------------------------------------------
// CSV import (ported from legacy `importCsv`, rebuilt on the maxGraph model API)
// ---------------------------------------------------------------------------

const CSV_VALID =
  /^\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*(?:,\s*(?:'[^'\\]*(?:\\[\S\s][^'\\]*)*'|"[^"\\]*(?:\\[\S\s][^"\\]*)*"|[^,'"\s\\]*(?:\s+[^,'"\s\\]+)*)\s*)*$/;
const CSV_VALUE =
  /(?!\s*$)\s*(?:'([^'\\]*(?:\\[\S\s][^'\\]*)*)'|"([^"\\]*(?:\\[\S\s][^"\\]*)*)"|([^,'"\s\\]*(?:\s+[^,'"\s\\]+)*))\s*(?:,|$)/g;

/**
 * Split one CSV line into an array of values. Ported verbatim from the legacy
 * `csvToArray` (same regexes); returns `null` for a malformed line.
 */
export function csvToArray(text: string): string[] | null {
  if (!CSV_VALID.test(text)) {
    return null;
  }
  const a: string[] = [];
  text.replace(CSV_VALUE, (_m0, m1, m2, m3) => {
    if (m1 !== undefined) {
      a.push((m1 as string).replace(/\\'/g, "'"));
    } else if (m2 !== undefined) {
      a.push((m2 as string).replace(/\\"/g, '"'));
    } else if (m3 !== undefined) {
      a.push(m3 as string);
    }
    return '';
  });
  if (/,\s*$/.test(text)) {
    a.push('');
  }
  return a;
}

/** A parsed CSV edge directive (`#connect: {...}`). */
interface CsvEdgeDef {
  from: string;
  to: string;
  label?: string;
  style?: string;
  invert?: boolean;
}

/** Trim helper (replaces legacy `mxUtils.trim`). */
function trim(s: string): string {
  return s.trim();
}

/**
 * Import a draw.io CSV document into the graph's model, mirroring the legacy
 * `importCsv` processing-instruction grammar (`#label`, `#style`, `#width`,
 * `#height`, `#connect`, `#namespace`, `#identity`, `#parent`, ...). Rebuilt on
 * the maxGraph API: `new Cell(...)`, `model.add`, `insertEdge`, `Geometry`.
 *
 * Layout directives (`#layout: ...`) are accepted but not auto-run here; the
 * cells land with their explicit geometry. (Legacy relied on draw.io's global
 * layout classes via `window[layout]`, which are intentionally not reintroduced.)
 */
export function importCsv(graph: Graph, text: string): void {
  const model = graph.getDataModel();
  const lines = text.split('\n');
  if (lines.length === 0) {
    return;
  }

  // Processing-instruction defaults (subset actually honored by the engine).
  let style: string | null = null;
  let labelTemplate: string | null = null;
  let namespace = '';
  let width = 'auto';
  let height = 'auto';
  let padding = 0;
  let identity: string | null = null;
  let parentAttr: string | null = null;
  const edges: CsvEdgeDef[] = [];
  let link: string | null = null;
  let ignore: string[] | null = null;

  let index = 0;
  while (index < lines.length && lines[index].charAt(0) === '#') {
    let line = lines[index];
    index++;
    // Join continuation lines ending in backslash.
    while (
      index < lines.length &&
      line.charAt(line.length - 1) === '\\' &&
      lines[index].charAt(0) === '#'
    ) {
      line = line.substring(0, line.length - 1) + trim(lines[index].substring(1));
      index++;
    }
    if (line.charAt(1) === '#') {
      continue; // a comment line (##)
    }
    const idx = line.indexOf(':');
    if (idx <= 0) {
      continue;
    }
    const key = trim(line.substring(1, idx));
    const value = trim(line.substring(idx + 1));
    switch (key) {
      case 'label':
        labelTemplate = value;
        break;
      case 'style':
        style = value;
        break;
      case 'namespace':
        if (value.length > 0 && value !== '-') {
          namespace = value;
        }
        break;
      case 'identity':
        if (value.length > 0 && value !== '-') {
          identity = value;
        }
        break;
      case 'parent':
        if (value.length > 0 && value !== '-') {
          parentAttr = value;
        }
        break;
      case 'width':
        width = value;
        break;
      case 'height':
        height = value;
        break;
      case 'padding':
        padding = parseFloat(value);
        break;
      case 'ignore':
        ignore = value.split(',');
        break;
      case 'link':
        link = value;
        break;
      case 'connect':
        try {
          edges.push(JSON.parse(value) as CsvEdgeDef);
        } catch (e) {
          GFLog.warn('Bad CSV #connect directive', value);
        }
        break;
      default:
        // layout, left, top, spacing, etc. — accepted, not applied here.
        break;
    }
  }

  if (lines[index] == null) {
    throw new Error('Invalid or missing CSV header');
  }

  // Header: attribute names (validated to XML-safe identifiers).
  const keys = csvToArray(lines[index]) ?? [];
  let identityIndex: number | null = null;
  let parentIndex: number | null = null;
  const attribs: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (identity === keys[i]) {
      identityIndex = i;
    }
    if (parentAttr === keys[i]) {
      parentIndex = i;
    }
    attribs.push(
      trim(keys[i])
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^\d+/, '')
        .replace(/_+$/, '')
    );
  }

  const label = labelTemplate ?? `%${attribs[0]}%`;

  // Lookups for edge resolution keyed by the `to` attribute name.
  const lookups: Record<string, Record<string, Cell>> = {};
  for (const e of edges) {
    if (lookups[e.to] == null) {
      lookups[e.to] = {};
    }
  }

  // Parse data rows.
  const rows: string[][] = [];
  for (let i = index + 1; i < lines.length; i++) {
    const values = csvToArray(lines[i]);
    if (values == null) {
      const short = lines[i].length > 40 ? lines[i].substring(0, 40) + '...' : lines[i];
      throw new Error(`${short} (${i}): contains validation errors`);
    }
    if (values.length > 0) {
      rows.push(values);
    }
  }

  const parent = graph.getDefaultParent();
  const inserted: Cell[] = [];
  let y = 0;

  model.batchUpdate(() => {
    for (const values of rows) {
      const id = identityIndex != null ? namespace + values[identityIndex] : null;
      const cellStyle = style || 'whiteSpace=wrap;html=1;';
      const cell = new Cell(label, new Geometry(0, y, 0, 0), cellStyle as unknown as CellStateStyle);
      cell.vertex = true;
      if (id != null) {
        cell.setId(id);
      }
      for (let j = 0; j < values.length; j++) {
        cell.setAttribute(attribs[j], values[j]);
      }

      // Resolve label template `%attr%` against the row.
      const resolvedLabel = label.replace(/%([^%]+)%/g, (_m, attr) => cell.getAttribute(attr, '') as string);
      cell.value = resolvedLabel;

      // Size.
      const w = width === 'auto' ? 120 + padding : parseFloat(width);
      const h = height === 'auto' ? 60 + padding : parseFloat(height);
      const geo = cell.getGeometry();
      if (geo) {
        geo.width = Number.isNaN(w) ? 120 : w;
        geo.height = Number.isNaN(h) ? 60 : h;
        y += geo.height + 40;
      }

      // Link.
      if (link != null && link !== 'link') {
        const url = cell.getAttribute(link, null);
        if (url != null) {
          cell.setAttribute('link', url);
        }
        cell.setAttribute(link, null);
      }

      model.add(parent, cell);
      inserted.push(cell);

      // Register this cell in the edge lookups.
      for (const e of edges) {
        const keyVal = cell.getAttribute(e.to, null);
        if (keyVal != null) {
          lookups[e.to][keyVal] = cell;
        }
      }
    }

    // Create edges from the `from` attribute references.
    for (const edge of edges) {
      for (const cell of inserted) {
        const tmp = cell.getAttribute(edge.from, null);
        if (tmp != null && tmp !== '') {
          cell.setAttribute(edge.from, null);
          const refs = String(tmp).split(',');
          for (const ref of refs) {
            const target = lookups[edge.to]?.[ref];
            if (target != null) {
              const src = edge.invert ? target : cell;
              const dst = edge.invert ? cell : target;
              graph.insertEdge(parent, null, edge.label ?? '', src, dst, edge.style as unknown as CellStateStyle);
            }
          }
        }
      }
    }

    // Strip ignored attributes.
    if (ignore != null) {
      for (const cell of inserted) {
        for (const attr of ignore) {
          cell.setAttribute(trim(attr), null);
        }
      }
    }
  });
}

/** Re-export the primitives used by consumers that build on these helpers. */
export { Rectangle, Geometry };
