/**
 * Feature: angular-to-react-migration
 * Task 4.4 — Unit tests for the ported GFEvents bus and GFTimer.
 * Validates: Requirements 8.1
 *
 * Adapted from the legacy `spec/global_class.test.ts`. The Angular-coupled
 * surface of the legacy test (`$GF.create($scope, templateSrv, dashboard, ctrl)`,
 * `GFVariables`/`safe-eval`, `GFDrawio`) is dropped — those pieces moved to the
 * Context_Seam or were removed with `eval`. What remains are the framework-
 * agnostic pieces the migration preserves verbatim:
 *   - `genUid`  : replaces the legacy `$GF.genUid()` unique-id helper.
 *   - `GFEvents`: the publish/subscribe bus (declare / connect / emit / disconnect).
 *   - `GFTimer` : the cancelable, multi-step timer.
 */
import { GFEvents, GLOBAL_SIGNALS, GlobalSignals } from './flowchartingBase';
import { GFTimer, genUid } from './globals';

describe('globals — Feature: angular-to-react-migration (Task 4.4), Requirements 8.1', () => {
  // -------------------------------------------------------------------------
  // genUid — replaces the legacy `$GF.genUid()` id helper.
  // -------------------------------------------------------------------------
  describe('genUid', () => {
    test('returns a non-empty string', () => {
      const uid = genUid();
      expect(typeof uid).toBe('string');
      expect(uid.length).toBeGreaterThan(0);
    });

    test('is unique across calls', () => {
      expect(genUid()).not.toBe(genUid());
      const ids = new Set(Array.from({ length: 1000 }, () => genUid()));
      expect(ids.size).toBe(1000);
    });

    test('applies an optional name prefix', () => {
      const uid = genUid('rule');
      expect(uid.startsWith('rule-')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // GFEvents — the preserved publish/subscribe bus.
  // -------------------------------------------------------------------------
  describe('GFEvents subscribe/emit', () => {
    let bus: GFEvents<GlobalSignals>;

    beforeEach(() => {
      bus = GFEvents.create<GlobalSignals>(GLOBAL_SIGNALS);
    });

    afterEach(() => {
      bus.clear();
    });

    test('declares the full set of global signals', () => {
      expect(bus.countSignal()).toBe(GLOBAL_SIGNALS.length);
    });

    test('connect registers a subscriber and isConnected reports it', () => {
      const child = { uid: genUid('child') };
      expect(bus.isConnected('data_updated', child)).toBe(false);
      const ok = bus.connect('data_updated', child, () => undefined);
      expect(ok).toBe(true);
      expect(bus.isConnected('data_updated', child)).toBe(true);
    });

    test('emit invokes every connected callback with the payload', async () => {
      const childA = { uid: genUid('a') };
      const childB = { uid: genUid('b') };
      const receivedA: unknown[] = [];
      const receivedB: unknown[] = [];
      bus.connect('data_updated', childA, (payload: unknown) => receivedA.push(payload));
      bus.connect('data_updated', childB, (payload: unknown) => receivedB.push(payload));

      const payload = { value: 42 };
      await bus.emit('data_updated', payload);

      expect(receivedA).toEqual([payload]);
      expect(receivedB).toEqual([payload]);
    });

    test('emit only reaches subscribers of the emitted signal', async () => {
      const child = { uid: genUid('child') };
      let dataUpdatedCalls = 0;
      let variablesChangedCalls = 0;
      bus.connect('data_updated', child, () => {
        dataUpdatedCalls += 1;
      });
      bus.connect('variables_changed', child, () => {
        variablesChangedCalls += 1;
      });

      await bus.emit('data_updated');

      expect(dataUpdatedCalls).toBe(1);
      expect(variablesChangedCalls).toBe(0);
    });

    test('emit resolves with the collected callback results', async () => {
      const child = { uid: genUid('child') };
      bus.connect('data_updated', child, (payload: number) => payload * 2);
      const results = await bus.emit('data_updated', 21);
      expect(results).toEqual([42]);
    });

    test('a later connect for the same uid replaces the earlier callback', async () => {
      const child = { uid: genUid('child') };
      let firstCalls = 0;
      let secondCalls = 0;
      bus.connect('data_updated', child, () => {
        firstCalls += 1;
      });
      bus.connect('data_updated', child, () => {
        secondCalls += 1;
      });

      await bus.emit('data_updated');

      expect(firstCalls).toBe(0);
      expect(secondCalls).toBe(1);
    });

    test('disconnect stops a subscriber from receiving further emits', async () => {
      const child = { uid: genUid('child') };
      let calls = 0;
      bus.connect('data_updated', child, () => {
        calls += 1;
      });
      await bus.emit('data_updated');
      expect(calls).toBe(1);

      bus.disconnect('data_updated', child);
      expect(bus.isConnected('data_updated', child)).toBe(false);
      await bus.emit('data_updated');
      expect(calls).toBe(1);
    });

    test('connect throws for an object without a uid', () => {
      expect(() => bus.connect('data_updated', {} as any, () => undefined)).toThrow(/uid/);
    });

    test('connect throws for an undeclared signal', () => {
      const child = { uid: genUid('child') };
      expect(() => bus.connect('not_a_signal' as GlobalSignals, child, () => undefined)).toThrow(
        /no declared signal/
      );
    });

    test('clear removes all subscribers and declared signals', () => {
      const child = { uid: genUid('child') };
      bus.connect('data_updated', child, () => undefined);
      bus.clear();
      expect(bus.countSignal()).toBe(0);
      expect(bus.isConnected('data_updated', child)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // GFTimer — the preserved cancelable multi-step timer.
  // -------------------------------------------------------------------------
  describe('GFTimer', () => {
    let myTimer: GFTimer;

    beforeEach(() => {
      myTimer = GFTimer.create();
    });

    afterEach(() => {
      GFTimer.stop();
    });

    test('create registers a retrievable timer', () => {
      expect(GFTimer.get(myTimer.getUid())).not.toBeNull();
      expect(GFTimer.get(myTimer.getUid())).toBe(myTimer);
    });

    test('stop with the timer object removes it', () => {
      GFTimer.stop(myTimer);
      expect(GFTimer.get(myTimer.getUid())).toBeNull();
    });

    test('stop with the timer uid removes it', () => {
      GFTimer.stop(myTimer.uid);
      expect(GFTimer.get(myTimer.uid)).toBeNull();
    });

    describe('callback execution', () => {
      const stepTime = 100;
      const pauseTime = 500;
      let step = 0;
      const myfunc = () => {
        step += 1;
      };

      beforeEach(() => {
        step = 0;
      });

      test('runs each added step once', async () => {
        myTimer.addStep(myfunc, stepTime);
        myTimer.addStep(myfunc, stepTime);
        myTimer.addStep(myfunc, stepTime);
        myTimer.start();
        await new Promise((r) => setTimeout(r, pauseTime));
        expect(step).toBe(3);
        expect(myTimer.isFinished()).toBe(true);
      });

      test('repeats a single step for the configured iteration count', async () => {
        myTimer.addStep(myfunc, stepTime);
        myTimer.setIteration(3);
        expect(step).toBe(0);
        myTimer.start();
        await new Promise((r) => setTimeout(r, pauseTime));
        expect(step).toBe(3);
        expect(myTimer.isFinished()).toBe(true);
      });

      test('keeps running while cyclic and stops on stop()', async () => {
        myTimer.addStep(myfunc, stepTime);
        myTimer.setCyclic(true);
        let currentStep = step;
        expect(currentStep).toBe(0);
        myTimer.start();
        await new Promise((r) => setTimeout(r, pauseTime));
        expect(step).toBeGreaterThan(currentStep);
        currentStep = step;
        await new Promise((r) => setTimeout(r, pauseTime));
        expect(step).toBeGreaterThan(currentStep);
        expect(myTimer.isFinished()).toBe(false);
        GFTimer.stop(myTimer);
        currentStep = step;
        expect(myTimer.isFinished()).toBe(true);
        expect(currentStep).toBe(step);
      });
    });

    describe('async start', () => {
      const stepTime = 100;
      let step = 0;
      const fn = () => {
        step += 1;
      };

      beforeEach(() => {
        step = 0;
      });

      test('start does not run synchronously and is not finished immediately', () => {
        myTimer.addStep(fn, stepTime);
        myTimer.start();
        expect(step).toBe(0);
        expect(myTimer.isFinished()).toBe(false);
      });
    });
  });
});
