/**
 * Feature: angular-to-react-migration, Property 6
 *
 * Property 6: Cell-identifier match predicate.
 * **Validates: Requirements 4.4**
 *
 * For any cell identifier and any pattern (a literal or a `/regex/flags`
 * regular expression), the shape / text / link / event map matcher SHALL
 * select the cell exactly when the pattern matches the identifier under the
 * configured identification property (id / value / metadata).
 *
 * The match predicate is `matchString` in `logic/logicHelpers.ts`, surfaced via
 * `XCell.match(pattern, options)` in `engine/XGraph.ts` (options.identByProp =
 * 'id' | 'value' | 'metadata') and through the shape/text/link/event maps'
 * `GFMap.match` in `logic/mapping.ts`. This test exercises the predicate at two
 * levels against an INDEPENDENT reference oracle (literal equality OR
 * `/regex/flags` test):
 *
 *   Part A — `matchString` directly, over the full (identifier, pattern) space.
 *   Part B — the `ShapeMap`/`TextMap`/`LinkMap`/`EventMap` `.match` surface,
 *            confirming the map matcher selects exactly when the predicate does
 *            under the configured identification property.
 *
 * Adapted from the legacy `spec/rule.test.ts` (which exercised `sm.match('Toto')`,
 * `rule.matchShape/matchText/matchLink`, and the `.*Toto.*` literal/regex
 * patterns) and promoted to fast-check properties over the whole input space.
 * The Angular-coupled `$GF.create($scope, templateSrv, dashboard, ctrl)` is
 * replaced by a minimal `LogicContext` stub — the same pattern as
 * `logic/threshold.test.ts` `stubContext` (the map `.match` path reads none of
 * the Grafana services).
 *
 * PRESERVED-LEGACY BOUNDARY (documented, encoded in the oracle, NOT worked
 * around in production): `matchString` guards with
 * `!str || !pattern || str.length === 0 || (typeof pattern === 'string' &&
 * pattern.length === 0)` → returns `false`. So an empty identifier never
 * matches (even against an empty or catch-all pattern), and an empty pattern
 * never matches. The reference oracle reproduces this guard exactly rather than
 * treating empty-string as a normal literal. The `GFMap.match` wrapper adds its
 * own `text.length === 0 → false` guard on top, which agrees with the predicate
 * guard. No genuine bug was found; the guard is intentional legacy behavior.
 *
 * Minimum 100 iterations per property (fast-check default numRuns is 100; set
 * explicitly below).
 */
import fc from 'fast-check';
import { getDefaultTimeRange } from '@grafana/data';
import { matchString, stringToRegEx } from './logicHelpers';
import { ShapeMap, TextMap, LinkMap, EventMap } from './mapping';
import type { ObjectMap } from './mapping';
import type { LogicContext } from './logicContext';
import type { TRuleMapOptions } from './legacyTypes';
import { GFEvents, GlobalSignals, GLOBAL_SIGNALS } from './flowchartingBase';

// ---------------------------------------------------------------------------
// Minimal LogicContext stub — replaces `$GF.create($scope, templateSrv,
// dashboard, ctrl)`. The map `.match` path touches none of the Grafana
// services; `events`/`setMappingCallBack` are the only members the GFMap
// constructor wires, and matching itself reads nothing off `gf`.
// ---------------------------------------------------------------------------
function stubContext(): LogicContext {
  const events = GFEvents.create<GlobalSignals>(GLOBAL_SIGNALS);
  return {
    notify: jest.fn(),
    clearNotify: jest.fn(),
    interpolate: (t: string) => t,
    getGrafanaVarNames: () => [],
    getTimeRange: () => getDefaultTimeRange(),
    theme: {} as any,
    eventBus: {} as any,
    subscribeSharedCrosshair: () => () => undefined,
    events,
    setMappingCallBack: () => undefined,
    getFullAvailableVarNames: () => [],
    setFocus: () => undefined,
  };
}

// ---------------------------------------------------------------------------
// Independent reference oracle.
//
// This reimplements the SPECIFIED semantics ("literal equality OR /regex/flags
// test", plus the preserved empty-string guard) WITHOUT reusing production
// code, so the property is a genuine cross-check rather than a tautology.
// ---------------------------------------------------------------------------

/** Does `pattern` look like a RegExp literal `/body/flags`? */
function isRegexLiteral(pattern: string): boolean {
  return pattern.charAt(0) === '/' && /^\/(.*?)\/(g?i?m?y?)$/.test(pattern);
}

/**
 * Reference predicate. `enableRegEx` mirrors the production flag: when false,
 * only literal string equality (never regex) is honored.
 *
 * Preserved-legacy guard: empty identifier or empty pattern → no match.
 */
function referenceMatch(id: string, pattern: string, enableRegEx: boolean): boolean {
  if (id.length === 0 || pattern.length === 0) {
    return false; // preserved `matchString` empty-string guard
  }
  // Exact string identity short-circuits in production (`str === pattern`)
  // before any regex handling, regardless of enableRegEx.
  if (id === pattern) {
    return true;
  }
  if (!enableRegEx) {
    // With regex disabled, a string pattern only matches by exact equality,
    // already handled above.
    return false;
  }
  if (isRegexLiteral(pattern)) {
    const m = pattern.match(/^\/(.*?)\/(g?i?m?y?)$/);
    if (!m) {
      return false;
    }
    try {
      return new RegExp(m[1], m[2]).test(id);
    } catch {
      return false;
    }
  }
  // A non-`/.../ ` pattern is matched as an anchored literal: `^pattern$`.
  try {
    return new RegExp(`^${pattern}$`).test(id);
  } catch {
    // An invalid anchored pattern yields a null regex in production → no match.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary cell identifier (id / value / metadata value). */
const arbIdentifier = fc.string({ maxLength: 24 });

/**
 * Arbitrary pattern spanning the authored input space:
 *   - a plain literal string (matched anchored),
 *   - a `/body/flags` regex literal built from a safe body + valid flag subset,
 *   - a handful of representative catch-all / anchored / alternation patterns.
 */
const arbRegexFlags = fc
  .subarray(['g', 'i', 'm', 'y'], { minLength: 0, maxLength: 4 })
  .map((fs) => fs.join(''));

const arbRegexBody = fc.oneof(
  fc.constant('.*'),
  fc.constant('.+'),
  fc.constant('[a-z]+'),
  fc.constant('\\d+'),
  fc.constant('foo|bar'),
  fc.constant('Toto'),
  fc.constant('.*Toto.*'),
  fc.stringMatching(/^[a-zA-Z0-9 _.-]{0,12}$/)
);

const arbRegexLiteral = fc.tuple(arbRegexBody, arbRegexFlags).map(([body, flags]) => `/${body}/${flags}`);

const arbLiteralPattern = fc.string({ maxLength: 16 });

const arbPattern = fc.oneof(
  arbLiteralPattern,
  arbRegexLiteral,
  fc.constantFrom('/.*/', '/^a/', 'exact', 'Toto', '/.*Toto.*/', '/[0-9]+/')
);

describe('Feature: angular-to-react-migration, Property 6 — cell-identifier match predicate', () => {
  // -------------------------------------------------------------------------
  // Part A — `matchString` agrees with the independent oracle for any
  // identifier and any literal-or-regex pattern (regex enabled).
  // -------------------------------------------------------------------------
  describe('matchString agrees with the independent reference (regex enabled)', () => {
    test('selects exactly when the pattern matches the identifier', () => {
      fc.assert(
        fc.property(arbIdentifier, arbPattern, (id, pattern) => {
          expect(matchString(id, pattern, true)).toBe(referenceMatch(id, pattern, true));
        }),
        { numRuns: 300 }
      );
    });

    test('with regex disabled, only exact literal equality matches', () => {
      fc.assert(
        fc.property(arbIdentifier, arbPattern, (id, pattern) => {
          expect(matchString(id, pattern, false)).toBe(referenceMatch(id, pattern, false));
        }),
        { numRuns: 300 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Part A' — the preserved empty-string boundary is honored at both ends.
  // -------------------------------------------------------------------------
  describe('preserved empty-string guard', () => {
    test('an empty identifier never matches, even against a catch-all pattern', () => {
      fc.assert(
        fc.property(arbPattern, (pattern) => {
          expect(matchString('', pattern, true)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    test('an empty pattern never matches any identifier', () => {
      fc.assert(
        fc.property(arbIdentifier, (id) => {
          expect(matchString(id, '', true)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    test('the catch-all /.*/ matches every non-empty identifier and nothing empty', () => {
      fc.assert(
        fc.property(arbIdentifier, (id) => {
          expect(matchString(id, '/.*/', true)).toBe(id.length > 0);
        }),
        { numRuns: 200 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Part B — the shape / text / link / event map matcher (`GFMap.match`)
  // surfaces the same predicate under the configured identification property.
  //
  // `GFMap.match(text, options)` resolves the map pattern then calls
  // `matchString(text, pattern, options.enableRegEx)` (after its own
  // null/empty guard). Here `text` is the cell identifier already extracted
  // under options.identByProp (id/value/metadata) — exactly what
  // `XCell.match` feeds it — so the map matcher must select precisely when the
  // reference predicate does.
  // -------------------------------------------------------------------------
  describe('map matcher selects exactly when the pattern matches the identifier', () => {
    const identProps = ['id', 'value', 'metadata'] as const;

    function makeOptions(identByProp: typeof identProps[number], enableRegEx: boolean): TRuleMapOptions {
      return { identByProp, metadata: '', enableRegEx };
    }

    function buildMap(kind: 'shape' | 'text' | 'link' | 'event', pattern: string): ObjectMap {
      const gf = stubContext();
      switch (kind) {
        case 'shape':
          return new ShapeMap(gf, pattern, ShapeMap.getDefaultData());
        case 'text':
          return new TextMap(gf, pattern, TextMap.getDefaultData());
        case 'link':
          return new LinkMap(gf, pattern, LinkMap.getDefaultData());
        case 'event':
          return new EventMap(gf, pattern, EventMap.getDefaultData());
      }
    }

    for (const kind of ['shape', 'text', 'link', 'event'] as const) {
      test(`${kind} map.match matches the reference across id/value/metadata`, () => {
        fc.assert(
          fc.property(
            arbIdentifier,
            arbPattern,
            fc.constantFrom(...identProps),
            fc.boolean(),
            (id, pattern, identByProp, enableRegEx) => {
              // An empty pattern is rejected by the map `pattern` setter and by
              // the predicate guard; skip it so the constructed map carries the
              // intended pattern (the empty-pattern guard is covered in Part A').
              fc.pre(pattern.length > 0);
              const map = buildMap(kind, pattern);
              const options = makeOptions(identByProp, enableRegEx);
              // The map matcher's result under the configured identification
              // property must equal the independent reference predicate.
              expect(map.match(id, options)).toBe(referenceMatch(id, pattern, enableRegEx));
            }
          ),
          { numRuns: 200 }
        );
      });
    }
  });

  // -------------------------------------------------------------------------
  // Part C — cross-check `matchString` against `stringToRegEx`: when a pattern
  // compiles to a RegExp, `matchString` must agree with that RegExp's `.test`
  // on any non-empty identifier (the surface `XCell.match` relies on).
  // -------------------------------------------------------------------------
  describe('matchString is consistent with stringToRegEx compilation', () => {
    test('a compiled pattern matches iff its RegExp tests true (non-empty id)', () => {
      fc.assert(
        fc.property(arbIdentifier, arbPattern, (id, pattern) => {
          fc.pre(id.length > 0 && pattern.length > 0);
          const reg = stringToRegEx(pattern);
          if (reg === null) {
            // An uncompilable pattern can only match by exact equality.
            expect(matchString(id, pattern, true)).toBe(id === pattern);
          } else {
            expect(matchString(id, pattern, true)).toBe(id === pattern || reg.test(id));
          }
        }),
        { numRuns: 300 }
      );
    });
  });
});
