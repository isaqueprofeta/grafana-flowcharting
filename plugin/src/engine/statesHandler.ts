/**
 * statesHandler — the StateHandler, ported **with import swaps only** from the
 * legacy `src/states_handler.ts` (design.md: Logic_Layer, "StatesHandler:
 * import swaps", Req 4.5).
 *
 * It owns one {@link State} per {@link XCell} of an {@link XGraph} and fans the
 * update/change/clear lifecycle out to them. The algorithm is preserved
 * verbatim; only imports are swapped:
 *   - `$GF` / `$gf: $GF`   -> `gf: LogicContext`  (Context_Seam)
 *   - `$GF.genUid`         -> `genUid`            (logic/globals)
 *   - `XGraph` / `XCell`   -> engine/XGraph
 *   - `State`              -> engine/state
 *
 * No `$GF`, `$scope`, Angular, `globalThis`, or `mx*` global mutation.
 */
import { State } from './state';
import { XGraph, XCell } from './XGraph';
import { GFLog, genUid } from '../logic/globals';
import { GFEvents } from '../logic/flowchartingBase';
import type { LogicContext } from '../logic/logicContext';

// Debug
const DEBUG = false;
const _log = (...args: any) => {
  DEBUG && console.log(...args);
};

// Define signals
const stateHandlerSignalsArray = ['state_created', 'state_updated', 'state_changed', 'state_deleted'] as const;
type StateHandlerSignals = typeof stateHandlerSignalsArray[number];

/**
 * States Handler class
 *
 * @export
 * @class StateHandler
 */
export class StateHandler {
  private readonly gf: LogicContext;
  states: Map<string, State>;
  xgraph: XGraph;
  edited = false;
  uid: string;
  events: GFEvents<StateHandlerSignals> = GFEvents.create(stateHandlerSignalsArray);

  constructor(gf: LogicContext, xgraph: XGraph) {
    this.gf = gf;
    this.uid = genUid(this.constructor.name);
    this.states = new Map();
    this.xgraph = xgraph;
    this.init();
  }

  //############################################################################
  //### INIT/UPDATE/CHANGE/FREE
  //############################################################################
  update(): this {
    const funcName = 'refresh';
    GFLog.debug(`${this.constructor.name}.${funcName}() : ${this.uid}`);
    this.states.forEach((s) => s.update());
    return this;
  }

  change(): this {
    const funcName = 'change';
    GFLog.debug(`${this.constructor.name}.${funcName}() : ${this.uid}`);
    this.states.forEach((s) => s.change());
    return this;
  }

  init(): this {
    const funcName = 'init';
    GFLog.debug(`${this.constructor.name}.${funcName}() : ${this.uid}`);
    this._eventsConnect();
    this.init_states();
    return this;
  }

  free() {
    this.states.forEach(async (s) => {
      s.free();
      await this.events.emit('state_deleted', s);
    });
    this.clear();
    this.events.clear();
    this._eventsDisconnect();
  }

  clear(): this {
    this.states.forEach((s) => {
      s.free();
      this.events.emit('state_deleted', s);
    });
    this.states.clear();
    return this;
  }

  //############################################################################
  //### LOGIC
  //############################################################################
  private _eventsConnect() {
    this.gf.events.connect('debug_asked', this, this._on_global_debug_asked.bind(this));
  }

  private _eventsDisconnect() {
    this.gf.events.disconnect('debug_asked', this);
  }

  /**
   * Initialisation of states — one {@link State} per {@link XCell}.
   */
  async init_states() {
    this.clear();
    const xcells = this.xgraph.getXCells();
    Promise.all(
      xcells.map(async (xcell: XCell) => {
        this.addState(xcell);
      })
    );
    return this;
  }

  setXGraph(xgraph: XGraph): this {
    this.xgraph = xgraph;
    return this;
  }

  getStates() {
    return this.states;
  }

  getStatesForInspect(): State[] {
    return Array.from(this.states.values());
  }

  getState(cellId: string): State | undefined {
    return this.states.get(cellId);
  }

  addState(xcell: XCell): State {
    const state = new State(this.gf, xcell, this.xgraph);
    this.states.set(state.uid, state);
    this.events.emit('state_created', state);
    return state;
  }

  matchXGraph(xgraph: XGraph): boolean {
    return this.xgraph.uid === xgraph.uid;
  }

  //#########################################################################
  //### Events
  //#########################################################################
  private _on_global_debug_asked() {
    _log('📬', this.constructor.name, '_on_global_debug_asked');
    _log('🗃️', this.constructor.name, this);
  }
}
