/**
 * Feature: angular-to-react-migration
 * Property 1: Diagram encode/decode round-trip
 * Validates: Requirements 2.5, 2.6
 *
 * For any valid mxGraph XML string, decode(encode(xml)) is equivalent to the
 * original xml. Adapted from the legacy `spec/pako.test.ts` reference.
 */
import fc from 'fast-check';
import { decode, encode, isEncoded, isValidXml } from './diagramCodec';

describe('diagramCodec — Feature: angular-to-react-migration, Property 1: Diagram encode/decode round-trip', () => {
  // A generator biased toward realistic mxGraph XML payloads: a mxGraphModel
  // wrapping a handful of cells with arbitrary (but XML-safe) attribute values.
  const xmlSafeText = fc
    .string({ minLength: 0, maxLength: 40 })
    // Keep characters that survive a decodeURIComponent/encodeURIComponent round
    // trip and are not XML-structural; the codec operates on the raw string, so
    // we exercise unicode and punctuation while avoiding raw angle brackets that
    // would change XML structure.
    .map((s) => s.replace(/[<>&"]/g, '_'));

  const mxGraphXmlArb: fc.Arbitrary<string> = fc
    .array(
      fc.record({
        id: fc.integer({ min: 2, max: 9999 }).map((n) => `c${n}`),
        value: xmlSafeText,
        x: fc.integer({ min: 0, max: 2000 }),
        y: fc.integer({ min: 0, max: 2000 }),
        w: fc.integer({ min: 1, max: 500 }),
        h: fc.integer({ min: 1, max: 500 }),
      }),
      { minLength: 1, maxLength: 8 }
    )
    .map((cells) => {
      const body = cells
        .map(
          (c) =>
            `<mxCell id="${c.id}" value="${c.value}" style="rounded=0;html=1;" vertex="1" parent="1">` +
            `<mxGeometry x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" as="geometry" /></mxCell>`
        )
        .join('');
      return `<mxGraphModel><root><mxCell id="0" /><mxCell id="1" parent="0" />${body}</root></mxGraphModel>`;
    });

  test('decode(encode(xml)) === xml for any valid mxGraph XML (>=100 iterations)', () => {
    fc.assert(
      fc.property(mxGraphXmlArb, (xml) => {
        const roundTripped = decode(encode(xml));
        expect(roundTripped).toBe(xml);
      }),
      { numRuns: 200 }
    );
  });

  test('round-trip also holds for arbitrary unicode strings (>=100 iterations)', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString({ minLength: 0, maxLength: 200 }), (s) => {
        expect(decode(encode(s))).toBe(s);
      }),
      { numRuns: 200 }
    );
  });

  // Example-based anchors alongside the property.
  test('encode output is recognized as an encoded diagram', () => {
    const xml = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
    const encoded = encode(xml);
    expect(isEncoded(encoded)).toBe(true);
    expect(decode(encoded)).toBe(xml);
  });

  test('isValidXml accepts decoded mxGraph XML and rejects garbage', () => {
    const xml = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
    expect(isValidXml(xml)).toBe(true);
    expect(isValidXml(encode(xml))).toBe(true);
    expect(isValidXml('not-xml-at-all <<< >>>')).toBe(false);
  });
});
