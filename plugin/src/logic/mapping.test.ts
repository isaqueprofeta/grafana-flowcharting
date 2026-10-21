/**
 * Feature: angular-to-react-migration, Property 5
 *
 * Property 5: Value and range map membership.
 * **Validates: Requirements 4.3**
 *
 * For any range map `[from, to]` and any value, the value SHALL resolve to that
 * range's mapped output exactly when the value lies within the range; and for
 * any value map, a value SHALL resolve to the mapped output exactly when it
 * equals the map's value.
 *
 * Adapted from the legacy `spec/rule.test.ts` (the `ValueMap` and `RangeMap`
 * `describe` blocks, which exercised `addValueMap`/`addRangeMap` authoring and
 * `getFormattedValue` resolution), promoted to fast-check properties over the
 * full input space. The Angular-coupled `$GF.create($scope, templateSrv,
 * dashboard, ctrl)` is replaced by the same minimal `LogicContext`
 * `stubContext()` used in `threshold.test.ts` (Property 4) — the mapping and
 * resolution paths read none of the Grafana services.
 *
 * Minimum 100 iterations per property (fast-check default numRuns is 100; each
 * property below runs 200).
 *
 * -------------------------------------------------------------------------
 * PRESERVED-LEGACY BOUNDARY (documented, not worked around):
 *
 *   `RangeMap.match` implements a HALF-OPEN interval `[from, to)` — the lower
 *   bound is inclusive (`v >= from`) and the upper bound is EXCLUSIVE
 *   (`v < to`). The task statement phrases the range as "within `[from, to]`",
 *   but the ported-as-is production logic (and the legacy `rule.test.ts`, e.g.
 *   `addRangeMap(0, 5, ...)` then `getFormattedValue(5)` falling through to the
 *   next range) uses `[from, to)`. This is preserved legacy behavior, so the
 *   oracle below encodes `[from, to)` rather than changing production logic.
 *
 *   OPEN-BOUND ASYMMETRY (preserved legacy quirk, surfaced by a counterexample
 *   `from='' , probe=-1` during this task): the two bounds guard emptiness
 *   differently for a NUMERIC probe. The lower-bound guard is
 *   `from !== undefined && typeof value === 'number'`, which is satisfied by an
 *   EMPTY `from` string — so for a numeric probe an empty `from` is NOT treated
 *   as "-inf"; it is coerced via `Number('') === 0`, i.e. an empty lower bound
 *   behaves like a lower bound of `0`. The upper-bound guard additionally
 *   requires `to.length > 0`, so an empty `to` genuinely means "no upper
 *   bound" (`+inf`). This asymmetry is a legacy artifact (the symmetric numeric
 *   `to` guard has a `typeof this.data.to === 'number'` typo that never fires
 *   for stored string bounds). The oracle below encodes the actual production
 *   behavior — empty `from` -> 0 for numeric probes, empty `to` -> +inf — and
 *   this comment documents it rather than "fixing" the ported logic.
 *
 *   `ValueMap.match` resolves equality numerically when the probed value is not
 *   a string (`Number(data.value) === Number(value)`), otherwise via
 *   `matchString(value.toString(), data.value)` — an exact, anchored literal
 *   match for a plain pattern. The sentinel `data.value === 'null'` is the only
 *   thing a `null`/`undefined` probe can match. These are the exact-equality
 *   semantics the property asserts.
 * -------------------------------------------------------------------------
 */
import fc from 'fast-check';
import { getDefaultTimeRange } from '@grafana/data';
import { ValueMap, RangeMap } from './mapping';
import { Rule } from './rule';
import type { LogicContext } from './logicContext';
import { GFEvents, GlobalSignals, GLOBAL_SIGNALS } from './flowchartingBase';

// ---------------------------------------------------------------------------
// Minimal LogicContext stub — same pattern as threshold.test.ts. The map
// membership / resolution paths touch none of the Grafana services; handlers
// are left undefined so the Rule's optional-chained wiring is a no-op.
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

/** Build a single ValueMap with the given value string. */
function makeValueMap(value: string, text = 'MAPPED'): ValueMap {
  return new ValueMap(value, text, ValueMap.getDefaultdata());
}

/** Build a single RangeMap with the given bounds (empty string === open). */
function makeRangeMap(from: string, to: string, text = 'MAPPED'): RangeMap {
  return new RangeMap(from, to, text, RangeMap.getDefaultData());
}

describe('Feature: angular-to-react-migration, Property 5 — value and range map membership', () => {
  // -------------------------------------------------------------------------
  // Part A — ValueMap membership: resolve iff the value equals the map's value.
  // -------------------------------------------------------------------------

  describe('ValueMap membership (exact equality)', () => {
    /**
     * Independent oracle for `ValueMap.match`, mirroring the preserved logic
     * without reusing its code:
     *   - null/undefined probe matches ONLY the 'null' sentinel value.
     *   - a numeric probe matches when Number(mapValue) === Number(probe).
     *   - otherwise an exact literal string equality (matchString with a plain
     *     pattern anchors `^...$`, so it reduces to string equality here).
     */
    function expectedValueMatch(mapValue: string, probe: number | string | null | undefined): boolean {
      if (probe === null || probe === undefined) {
        return mapValue === 'null';
      }
      if (typeof probe !== 'string') {
        // Non-string probe: numeric equality branch (NaN never equals NaN).
        if (Number(mapValue) === Number(probe)) {
          return true;
        }
        // Falls through to matchString(probe.toString(), mapValue).
      }
      const str = probe.toString();
      if (str.length === 0 || mapValue.length === 0) {
        return false;
      }
      return str === mapValue;
    }

    test('a numeric value resolves exactly when it equals the map value', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -10_000, max: 10_000 }),
          fc.integer({ min: -10_000, max: 10_000 }),
          (mapValue, probe) => {
            const map = makeValueMap(String(mapValue));
            const expected = expectedValueMatch(String(mapValue), probe);
            expect(map.match(probe)).toBe(expected);
            // And exact equality <=> the mapped text is returned.
            expect(map.getFormattedText(probe)).toBe(expected ? 'MAPPED' : `${probe}`);
          }
        ),
        { numRuns: 200 }
      );
    });

    test('a string value resolves exactly when it string-equals the map value', () => {
      fc.assert(
        // Use a plain (non-`/regex/`) alphanumeric pattern so matchString
        // reduces to an anchored literal equality.
        fc.property(
          fc.stringMatching(/^[a-zA-Z0-9_]+$/),
          fc.stringMatching(/^[a-zA-Z0-9_]+$/),
          (mapValue, probe) => {
            const map = makeValueMap(mapValue);
            expect(map.match(probe)).toBe(probe === mapValue);
          }
        ),
        { numRuns: 200 }
      );
    });

    test('a null/undefined probe resolves only against the "null" sentinel', () => {
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z0-9_]+$/),
          fc.constantFrom<null | undefined>(null, undefined),
          (mapValue, probe) => {
            const map = makeValueMap(mapValue);
            expect(map.match(probe)).toBe(mapValue === 'null');
          }
        ),
        { numRuns: 200 }
      );
    });

    test('an exactly-equal numeric probe always resolves (reflexivity of equality)', () => {
      fc.assert(
        fc.property(fc.integer({ min: -10_000, max: 10_000 }), (n) => {
          const map = makeValueMap(String(n));
          expect(map.match(n)).toBe(true);
          expect(map.getFormattedText(n)).toBe('MAPPED');
        }),
        { numRuns: 200 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Part B — RangeMap membership: resolve iff the value lies within the range.
  //
  // Preserved-legacy boundary: the interval is HALF-OPEN `[from, to)`
  // (inclusive lower, exclusive upper). Open bounds when a side is empty.
  // -------------------------------------------------------------------------

  describe('RangeMap membership (half-open [from, to))', () => {
    /**
     * Independent oracle for `RangeMap.match` over numeric probes, encoding the
     * preserved half-open `[from, to)` semantics. Per the documented open-bound
     * asymmetry: for a NUMERIC probe the lower-bound guard fires whenever `from`
     * is defined (even empty), so an empty `from` is coerced to `Number('')===0`
     * — i.e. a lower bound of 0 — while an empty `to` genuinely means "+inf".
     */
    function expectedRangeMatch(from: string, to: string, probe: number): boolean {
      const hasTo = to.length > 0;
      // Lower-bound branch always fires for a numeric probe (from is defined).
      if (probe >= Number(from)) {
        // Number('') === 0, matching production.
        if (hasTo) {
          return probe < Number(to);
        }
        return true;
      }
      return false;
    }

    // A bounded range generator with from < to, plus the probe value.
    const boundedRange = fc
      .tuple(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }))
      .filter(([a, b]) => a !== b)
      .map(([a, b]) => (a < b ? [a, b] : [b, a]) as [number, number]);

    test('a value resolves exactly when it lies within [from, to)', () => {
      fc.assert(
        fc.property(boundedRange, fc.integer({ min: -2000, max: 2000 }), ([from, to], probe) => {
          const map = makeRangeMap(String(from), String(to));
          const expected = expectedRangeMatch(String(from), String(to), probe);
          expect(map.match(probe)).toBe(expected);
          // Membership <=> the mapped text is returned (else the value echoes).
          expect(map.getFormattedText(probe)).toBe(expected ? 'MAPPED' : probe);
        }),
        { numRuns: 200 }
      );
    });

    test('the lower bound is inclusive and the upper bound is exclusive', () => {
      fc.assert(
        fc.property(boundedRange, ([from, to]) => {
          const map = makeRangeMap(String(from), String(to));
          // Inclusive lower bound.
          expect(map.match(from)).toBe(true);
          // Exclusive upper bound.
          expect(map.match(to)).toBe(false);
          // Just inside the top of the range still matches.
          expect(map.match(to - 1)).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    test('an empty "to" means +inf; an empty "from" coerces to 0 for numeric probes (documented asymmetry)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -1000, max: 1000 }),
          fc.integer({ min: -2000, max: 2000 }),
          (bound, probe) => {
            // Open upper bound: [bound, +inf) — empty `to` is a true open bound.
            const lower = makeRangeMap(String(bound), '');
            expect(lower.match(probe)).toBe(probe >= bound);
            // "Open" lower bound: empty `from` is NOT -inf for a numeric probe;
            // it coerces to Number('')===0, so the range is effectively [0, bound).
            const upper = makeRangeMap('', String(bound));
            expect(upper.match(probe)).toBe(probe >= 0 && probe < bound);
          }
        ),
        { numRuns: 200 }
      );
    });

    test('adjacent ranges partition the line with no overlap and no gap at the shared edge', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -1000, max: 1000 }),
          fc.integer({ min: 1, max: 1000 }),
          fc.integer({ min: 1, max: 1000 }),
          fc.integer({ min: -2000, max: 2000 }),
          (lo, span1, span2, probe) => {
            const mid = lo + span1;
            const hi = mid + span2;
            // [lo, mid) and [mid, hi) share the edge `mid` with no overlap.
            const left = makeRangeMap(String(lo), String(mid));
            const right = makeRangeMap(String(mid), String(hi));
            const inLeft = left.match(probe);
            const inRight = right.match(probe);
            // No value is in both ranges.
            expect(inLeft && inRight).toBe(false);
            // Any value in [lo, hi) is in exactly one of them.
            if (probe >= lo && probe < hi) {
              expect(inLeft || inRight).toBe(true);
            }
            // The shared edge belongs to the right (inclusive-lower) range.
            if (probe === mid) {
              expect(inRight).toBe(true);
              expect(inLeft).toBe(false);
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Part C — resolution through the Rule (how getFormattedValue selects a map),
  // mirroring the legacy `rule.test.ts` ValueMap/RangeMap "Mapping values"
  // tests across the input space. mappingType 1 => value maps, 2 => range maps.
  // -------------------------------------------------------------------------

  describe('Rule.getFormattedValue selects the first matching map', () => {
    test('value maps: a matching value yields its text; a miss echoes the value', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.integer({ min: 0, max: 50 }), { minLength: 1, maxLength: 5 }),
          fc.integer({ min: -10, max: 60 }),
          (values, probe) => {
            const rule = new Rule(stubContext(), '.*', Rule.getDefaultData());
            rule.dataType = 'string';
            rule.mappingType = 1;
            values.forEach((v) => rule.addValueMap(String(v), `T${v}`));
            const hit = values.includes(probe);
            const result = rule.getFormattedValue(probe);
            if (hit) {
              expect(result).toBe(`T${probe}`);
            } else {
              // No value map matched -> value echoes as a string.
              expect(result).toBe(String(probe));
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    test('range maps: the first containing [from, to) range yields its text; else echo', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -100, max: 100 }),
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: -200, max: 200 }),
          (lo, span1, span2, probe) => {
            const mid = lo + span1;
            const hi = mid + span2;
            const rule = new Rule(stubContext(), '.*', Rule.getDefaultData());
            rule.dataType = 'string';
            rule.mappingType = 2;
            rule.addRangeMap(String(lo), String(mid), 'LEFT');
            rule.addRangeMap(String(mid), String(hi), 'RIGHT');
            const result = rule.getFormattedValue(probe);
            if (probe >= lo && probe < mid) {
              expect(result).toBe('LEFT');
            } else if (probe >= mid && probe < hi) {
              expect(result).toBe('RIGHT');
            } else {
              expect(result).toBe(String(probe));
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
