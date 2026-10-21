/**
 * diagramCodec — pure-function port of the legacy pako encode/decode logic from
 * `src/drawio_base.ts` (GFDrawio.encode / decode / isEncoded / isValidXml).
 *
 * These are pure functions: no module-level mutable state, no globals, no `eval`.
 * Base64 handling is cross-environment (browser + jest/jsdom): it prefers the
 * DOM `atob`/`btoa` primitives and falls back to Node's `Buffer` so the same
 * module works under webpack in the browser and under jsdom in tests.
 *
 * Diagram pipeline (mirrors the legacy engine exactly):
 *   encode: encodeURIComponent -> pako.deflateRaw -> base64
 *   decode: unwrap <mxfile><diagram>..</diagram></mxfile> -> base64 -> binary
 *           -> pako.inflateRaw -> decodeURIComponent
 */
import { inflateRaw, deflateRaw } from 'pako';

/**
 * Decode a base64 string into a binary (latin1) string.
 * Prefers the DOM `atob` (present in browsers and jsdom); falls back to Buffer.
 */
function base64ToBinary(data: string): string {
  if (typeof atob === 'function') {
    return atob(data);
  }
  // Node fallback — mirrors legacy `Buffer.from(data, 'base64').toString('binary')`.
  return Buffer.from(data, 'base64').toString('binary');
}

/**
 * Encode a binary (latin1) string into base64.
 * Prefers the DOM `btoa` (present in browsers and jsdom); falls back to Buffer.
 */
function binaryToBase64(data: string): string {
  if (typeof btoa === 'function') {
    return btoa(data);
  }
  // Node fallback — mirrors legacy `Buffer.from(data, 'binary').toString('base64')`.
  return Buffer.from(data, 'binary').toString('base64');
}

/**
 * Parse an XML string into a Document using the DOM `DOMParser`
 * (available in browsers and in jsdom). Mirrors legacy `GFDrawio.parseXml`.
 */
function parseXml(xmlString: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(xmlString, 'text/xml');
}

/**
 * Read the text content of a node. Mirrors the legacy `getTextContent` helper
 * that tolerated both `textContent` and `text` property names.
 */
function getTextContent(node: unknown): string {
  const n = node as { textContent?: string; text?: string } | null;
  if (n == null) {
    return '';
  }
  // eslint-disable-next-line no-prototype-builtins
  return (n as any)[(n as any).hasOwnProperty('textContent') === undefined ? 'text' : 'textContent'] ?? '';
}

/**
 * Decode a pako-compressed, base64-encoded Diagram_XML into mxGraph XML.
 *
 * Unwraps a `<mxfile><diagram>...</diagram></mxfile>` wrapper to the inner
 * compressed payload before inflating. Throws on malformed input, matching the
 * legacy error surfaces (parseXml / Pako failures).
 *
 * @param data The encoded diagram string (optionally mxfile-wrapped).
 * @returns The decoded mxGraph XML string.
 */
export function decode(data: string): string {
  // 1. Unwrap <mxfile><diagram> to the inner compressed payload, if present.
  try {
    const node = parseXml(data).documentElement;
    if (node != null && node.nodeName === 'mxfile') {
      const diagrams = node.getElementsByTagName('diagram');
      if (diagrams.length > 0) {
        data = getTextContent(diagrams[0]);
      }
    }
  } catch (e) {
    throw new Error('parseXml : Unable to decode');
  }

  // 2. base64 -> binary string.
  data = base64ToBinary(data);

  // 3. binary -> inflated string via pako.inflateRaw.
  if (data.length > 0) {
    try {
      data = inflateRaw(
        Uint8Array.from(data, (c) => c.charCodeAt(0)),
        { to: 'string' }
      );
    } catch (e) {
      throw new Error('Pako : Unable to decode');
    }
  }

  // 4. decodeURIComponent to recover the original XML.
  try {
    data = decodeURIComponent(data);
  } catch (e) {
    throw new Error('Unable to decodeURIComponent');
  }
  return data;
}

/**
 * Encode mxGraph XML into a pako-compressed, base64-encoded Diagram_XML.
 *
 *   encodeURIComponent -> pako.deflateRaw -> base64
 *
 * @param data The mxGraph XML string.
 * @returns The encoded diagram string.
 */
export function encode(data: string): string {
  // 1. encodeURIComponent.
  try {
    data = encodeURIComponent(data);
  } catch (e) {
    throw new Error('Unable to encodeURIComponent');
  }

  // 2. deflateRaw -> binary string.
  if (data.length > 0) {
    try {
      const deflated = deflateRaw(data);
      // Chunked to avoid call-stack overflow on large arrays with String.fromCharCode.apply.
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < deflated.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(deflated.subarray(i, i + chunk)));
      }
      data = binary;
    } catch (e) {
      throw new Error('Pako : Unable to encode');
    }
  }

  // 3. binary -> base64.
  return binaryToBase64(data);
}

/**
 * Returns whether the given string is an encoded diagram (i.e. `decode` succeeds).
 * Mirrors the legacy `GFDrawio.isEncoded`.
 *
 * @param data The candidate string.
 * @returns `true` if the string decodes cleanly, `false` otherwise.
 */
export function isEncoded(data: string): boolean {
  try {
    decode(data);
  } catch (error) {
    return false;
  }
  return true;
}

/**
 * Validate decoded mxGraph XML. Decodes first if the source is encoded, then
 * checks the XML parses without a parser error and contains an `mxGraphModel`
 * (or `mxfile`) root — a pure, engine-free replacement for the legacy
 * `isValidXml`, which spun up a throwaway `Graph` + `mxCodec`.
 *
 * @param source The mxGraph XML or encoded diagram string.
 * @returns `true` if the source is valid mxGraph XML, `false` otherwise.
 */
export function isValidXml(source: string): boolean {
  try {
    let xml = source;
    if (isEncoded(source)) {
      xml = decode(source);
    }
    const doc = parseXml(xml);
    // A DOMParser error surfaces as a <parsererror> element in the document.
    if (doc.getElementsByTagName('parsererror').length > 0) {
      return false;
    }
    const root = doc.documentElement;
    if (root == null) {
      return false;
    }
    // Accept a bare mxGraphModel, a wrapping mxfile, or a document that
    // contains an mxGraphModel somewhere inside it.
    if (root.nodeName === 'mxGraphModel' || root.nodeName === 'mxfile') {
      return true;
    }
    return doc.getElementsByTagName('mxGraphModel').length > 0;
  } catch (error) {
    return false;
  }
}
