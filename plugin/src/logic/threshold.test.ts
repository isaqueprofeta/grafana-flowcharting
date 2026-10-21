/**
 * Feature: angular-to-react-migration, Property 4
 *
 * Property 4: Threshold selection respects comparator and is monotonic.
 * **Validates: Requirements 4.2**
 *
 * For any metric value and any ordered set of number thresholds, the selected
 * threshold level SHALL be the highest level whose comparator (`ge`/`gt`) is
 * satisfied by the value; and for two values `a <= b` the level selected for
 * `b` SHALL be >= the level selected for `a`. The analogous comparator
 * semantics SHALL hold for string thresholds (`eq`/`ne`) and date thresholds
 * (`eq`/`ne`/`ge`/`gt`).
 *
 * Adapted from the legacy `spec/threshold.test.ts` (which exercised the same
 * `NumberTH`/`StringTH`/`DateTH` comparator `match` and the Rule-level
 * selection via `getThresholdLevel`), promoted to fast-check properties over
 * the full input space. The Angular-coupled `$GF.create($scope, templateSrv,
 * dashboard, ctrl)` is replaced by a minimal `LogicContext` stub (the Rule only
 * reaches `gf?.metricHandler?.events` with optional chaining and `gf.notify`,
 * neither of which the selection path touches) — same pattern as
 * `data/dataFrameAdapter.test.ts` `stubContext`.
 *
 * Minimum 100 iterations per property (fast-check default numRuns is 100).
 */
import fc from 'fast-check';
import { getDefaultTimeRange } from '@grafana/data';
import { NumberTH, StringTH, DateTH } from './threshold';
import { Rule } from './rule';
import type { LogicContext } from './logicContext';
import { GFEvents, GlobalSignals, GLOBAL_SIGNALS } from './flowchartingBase';

// ---------------------------------------------------------------------------
// Minimal LogicContext stub — replaces `$GF.create($scope, templateSrv,
// dashboard, ctrl)`. The threshold-selection path reads none of the Grafana
// services; `metricHandler`/`rulesHandler` are left undefined so the Rule's
// optional-chained event wiring is a no-op.
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

/** Build a number Rule with the given ordered threshold values (ascending). */
function makeNumberRule(values: number[]): Rule {
  const rule = new Rule(stubContext(), '.*', Rule.getDefaultData());
  rule.dataType = 'number';
  // Thresholds are authored base-first: index 0 is the floor (always matches),
  // then strictly ascending values with the `ge`/`gt` comparator under test.
  values.forEach((v, i) => {
    rule.addThreshold(i, `#${(i + 1).toString().padStart(6, '1')}`, v);
  });
  return rule;
}

describe('Feature: angular-to-react-migration, Property 4 — threshold selection (comparator + monotonicity)', () => {
  // -------------------------------------------------------------------------
  // Part A — comparator semantics of the individual Threshold classes.
  // -------------------------------------------------------------------------

  describe('NumberTH comparator semantics (ge / gt)', () => {
    test('ge matches iff value >= threshold; gt matches iff value > threshold', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -1e9, max: 1e9, noNaN: true }),
          fc.double({ min: -1e9, max: 1e9, noNaN: true }),
          (threshold, value) => {
            const ge = new NumberTH('#000000', 'ge', threshold, NumberTH.getDefaultData());
            const gt = new NumberTH('#000000', 'gt', threshold, NumberTH.getDefaultData());
            expect(ge.match(value)).toBe(value >= threshold);
            expect(gt.match(value)).toBe(value > threshold);
          }
        ),
        { numRuns: 200 }
      );
    });

    test('a value satisfying gt always satisfies ge (gt is stricter than ge)', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -1e9, max: 1e9, noNaN: true }),
          fc.double({ min: -1e9, max: 1e9, noNaN: true }),
          (threshold, value) => {
            const ge = new NumberTH('#000000', 'ge', threshold, NumberTH.getDefaultData());
            const gt = new NumberTH('#000000', 'gt', threshold, NumberTH.getDefaultData());
            if (gt.match(value)) {
              expect(ge.match(value)).toBe(true);
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('StringTH comparator semantics (eq / ne)', () => {
    test('ne is the exact negation of eq for the same pattern/value', () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), (pattern, value) => {
          // Skip empty patterns: the StringTH value setter rejects empty
          // strings, so an empty pattern is outside the authored input space.
          fc.pre(pattern.length > 0);
          const eq = new StringTH('#000000', 'eq', pattern, StringTH.getDefaultData());
          const ne = new StringTH('#000000', 'ne', pattern, StringTH.getDefaultData());
          expect(ne.match(value)).toBe(!eq.match(value));
        }),
        { numRuns: 200 }
      );
    });

    test('the catch-all regex /.*/ matches every non-empty string under eq and nothing under ne', () => {
      fc.assert(
        fc.property(fc.string(), (value) => {
          // The preserved `matchString` treats an empty string as "no value to
          // match" (legacy `!str || str.length === 0` guard), so the catch-all
          // is asserted over the non-empty input space it actually governs.
          fc.pre(value.length > 0);
          const eq = new StringTH('#000000', 'eq', '/.*/', StringTH.getDefaultData());
          const ne = new StringTH('#000000', 'ne', '/.*/', StringTH.getDefaultData());
          expect(eq.match(value)).toBe(true);
          expect(ne.match(value)).toBe(false);
        }),
        { numRuns: 200 }
      );
    });
  });

  describe('DateTH comparator semantics (eq / ne / ge / gt)', () => {
    test('ne negates eq, and ge equals (gt OR eq) for the same reference date', () => {
      fc.assert(
        fc.property(
          // Reference and tested instants within a +/- ~1 year window (epoch ms),
          // kept above the DateTH year>1980 validity floor.
          fc.integer({ min: 1_600_000_000_000, max: 1_700_000_000_000 }),
          fc.integer({ min: 1_600_000_000_000, max: 1_700_000_000_000 }),
          (refMs, valueMs) => {
            const refDate = new Date(refMs).toISOString().slice(0, 10); // YYYY-MM-DD
            const value = new Date(valueMs).toISOString().slice(0, 10);

            const eq = new DateTH('#000000', 'eq', refDate, DateTH.getDefaultData());
            const ne = new DateTH('#000000', 'ne', refDate, DateTH.getDefaultData());
            const ge = new DateTH('#000000', 'ge', refDate, DateTH.getDefaultData());
            const gt = new DateTH('#000000', 'gt', refDate, DateTH.getDefaultData());

            const eqM = eq.match(value);
            // ne is the exact negation of eq.
            expect(ne.match(value)).toBe(!eqM);
            // ge holds exactly when gt holds OR eq holds (day precision).
            expect(ge.match(value)).toBe(gt.match(value) || eqM);
            // gt and eq are mutually exclusive.
            expect(gt.match(value) && eqM).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Part B — level selection respects comparator AND is monotonic.
  //
  // `_getIndexTHForValue` returns the highest threshold index (base-first,
  // ge/gt ascending) whose comparator chain is satisfied — i.e. the "highest
  // level whose comparator is satisfied". The property verifies both that
  // selection matches an independent reference scan and that it is monotonic
  // non-decreasing in the value.
  // -------------------------------------------------------------------------

  describe('Number threshold level selection', () => {
    // A generator for a strictly-ascending set of threshold values (2..5 of
    // them), modeling an "ordered set of number thresholds".
    const ascendingThresholds = fc
      .uniqueArray(fc.integer({ min: -1000, max: 1000 }), { minLength: 2, maxLength: 5 })
      .map((xs) => [...xs].sort((a, b) => a - b));

    /**
     * Independent reference: the highest index `i` such that every threshold
     * from 1..i matches the value (index 0 is the always-selected base). This
     * mirrors the legacy prefix-scan selection without reusing its code.
     */
    function expectedIndex(values: number[], value: number): number {
      let idx = 0;
      for (let i = 1; i < values.length; i++) {
        // Authored comparators default to `ge`; a strictly ascending set makes
        // the match set a contiguous prefix.
        if (value >= values[i]) {
          idx = i;
        } else {
          break;
        }
      }
      return idx;
    }

    test('selected index is the highest level whose ge comparator is satisfied', () => {
      fc.assert(
        fc.property(ascendingThresholds, fc.integer({ min: -2000, max: 2000 }), (values, value) => {
          const rule = makeNumberRule(values);
          const index = rule._getIndexTHForValue(value);
          expect(index).toBe(expectedIndex(values, value));
        }),
        { numRuns: 200 }
      );
    });

    test('for a <= b the selected level for b is >= the level for a (monotonic)', () => {
      fc.assert(
        fc.property(
          ascendingThresholds,
          fc.integer({ min: -2000, max: 2000 }),
          fc.integer({ min: -2000, max: 2000 }),
          (values, x, y) => {
            const a = Math.min(x, y);
            const b = Math.max(x, y);
            const rule = makeNumberRule(values);
            // Monotonic on the underlying index (higher value -> higher level).
            expect(rule._getIndexTHForValue(b)).toBeGreaterThanOrEqual(rule._getIndexTHForValue(a));
            // And on `getThresholdLevel`, which for the non-inverted rule maps
            // index -> (length-1-index); so the displayed level is monotonic
            // non-increasing as the value grows (the legacy level ordering).
            expect(rule.getThresholdLevel(b)).toBeLessThanOrEqual(rule.getThresholdLevel(a));
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
