/**
 * threshold — the number / string / date Threshold classes, ported **as-is**
 * from the legacy `src/threshold_class.ts` (design.md: Logic_Layer "as-is —
 * pure comparator/level selection", Req 4.2).
 *
 * The comparator / level-selection algorithm is preserved verbatim. Only the
 * imports are swapped:
 *   - `$GF.genUid`     -> `genUid` from `logic/globals`
 *   - `$GF.matchString`-> `matchString` from `logic/logicHelpers`
 *   - `gf.*` data types-> exported interfaces from `logic/legacyTypes`
 *   - `dayjs`          -> `dateTime` from `@grafana/data` (Grafana 11 moment
 *                         API), the same instant/precision math the legacy
 *                         DateTH performed via `dayjs`.
 *
 * No `$GF`, `$scope`, Angular, `globalThis`, or `mx*` global mutation.
 */
import { dateTimeAsMoment } from '@grafana/data';
import { GFEvents } from './flowchartingBase';
import { genUid } from './globals';
import { matchString } from './logicHelpers';
import type {
  TTHData,
  TTHNumberData,
  TTHStringData,
  TTHDateData,
  TTHNumberComparator,
  TTHDateComparator,
} from './legacyTypes';

export type ObjectTH = NumberTH | StringTH | DateTH;
export type ObjectTHData = TTHNumberData | TTHStringData | TTHDateData;

// Signal definition
const THSignalsArray = ['threshold_initalized', 'threshold_changed', 'threshold_freed'] as const;
type THSignals = typeof THSignalsArray[number];

abstract class GFTH<TData extends TTHData> {
  data: TData;
  private _hidden = false;
  validComp: string[] = [];
  uid: string;
  type = 'unknown';
  reduce = true;
  events: GFEvents<THSignals> = GFEvents.create(THSignalsArray);
  constructor(color: string, comparator: string, value: TData['value'], newData: TData, oldData?: any) {
    this.uid = genUid(this.constructor.name);
    this.data = newData;
    this.data.value = value;
    this.data.color = color;
    this.data.comparator = comparator;
    if (oldData) {
      this.import(oldData);
    }
    this._setType();
    this.init();
  }

  protected abstract _setType(): void;
  //############################################################################
  //### INIT/UPDATE/CHANGE/FREE
  //############################################################################
  init() {
    this._eventsConnect();
    this.events.emit('threshold_initalized', this);
  }

  change() {
    this.events.emit('threshold_changed', this);
  }

  clear() {
    this.validComp = [];
  }

  async free() {
    this.clear();
    this._eventsDisconnect();
    await this.events.emit('threshold_freed', this);
  }
  //############################################################################
  //### ACCESSORS
  //############################################################################
  //VALUE
  set value(v: TData['value']) {
    if (typeof v === 'string') {
      if (!v || v.length === 0) {
        return;
      }
    }
    if (this.data.value === v) {
      return;
    }
    this.data.value = v;
    this.change();
  }
  get value(): TData['value'] {
    return this.data.value;
  }

  //COLOR
  set color(v: string) {
    if (!v || v.length === 0 || this.data.color === v) {
      return;
    }
    this.data.color = v;
    this.change();
  }
  get color() {
    return this.data.color;
  }

  //COMPARATOR
  set comparator(v: string) {
    if (!v || v.length === 0 || this.data.comparator === v) {
      return;
    }
    this.data.comparator = v;
    this.change();
  }
  get comparator() {
    return this.data.comparator;
  }

  // HIDDEN
  set hidden(v: boolean) {
    if (v !== this._hidden) {
      this._hidden = v;
      this.change();
    }
  }
  get hidden() {
    return this._hidden;
  }

  //############################################################################
  //### LOGIC
  //############################################################################
  _eventsConnect() {}

  _eventsDisconnect() {}

  import(obj: any, thresholds?: number, color?: string): this {
    if (thresholds && color) {
      // <= 0.9.0
      this.data.color = color;
    } else {
      if (!!obj.color) {
        this.data.color = obj.color;
      } else {
        this.data.color = '';
      }

      if (!!obj.comparator) {
        this.data.comparator = obj.comparator;
      }

      if (!!obj.value) {
        this.data.value = obj.value;
      } else {
        this.data.value = undefined;
      }

      if (!!obj.level) {
        this.data.comparator = obj.level;
      }
    }
    return this;
  }

  abstract match(value: any): boolean;

  isValidComp(comp: string): boolean {
    return this.validComp.indexOf(comp) !== -1;
  }

  isValidValue(): boolean {
    return true;
  }

  getData(): any {
    return this.data;
  }
}

/**
 * Threshold type number
 *
 * @export
 * @class NumberTH
 * @extends {GFTH}
 */
export class NumberTH extends GFTH<TTHNumberData> {
  validComp: TTHNumberComparator[] = ['ge', 'gt'];

  protected _setType(): void {
    this.type = 'number';
  }

  static getDefaultData(): TTHNumberData {
    return {
      color: 'rgba(245, 54, 54, 0.9)',
      comparator: 'ge',
      value: 50,
      level: 0,
    };
  }

  isValidValue(): boolean {
    if (typeof this.data.value === 'number') {
      return true;
    }
    return false;
  }

  match(value: number | undefined): boolean {
    if (this.value === undefined) {
      return true;
    }
    if (value === undefined) {
      return false;
    }
    switch (this.comparator) {
      case 'ge':
        return value >= this.data.value;
      case 'gt':
        return value > this.value;
      default:
        throw new Error('Unknown comparator: ' + this.comparator);
    }
  }
}

/**
 * Threshold types string
 *
 * @export
 * @class StringTH
 * @extends {GFTH}
 */
export class StringTH extends GFTH<TTHStringData> {
  type = 'string';
  validComp: TTHDateComparator[] = ['eq', 'ne'];

  protected _setType(): void {
    this.type = 'string';
  }

  static getDefaultData(): TTHStringData {
    return {
      color: 'rgba(245, 54, 54, 0.9)',
      comparator: 'eq',
      value: '/.*/',
      level: 0,
    };
  }

  isValidValue(): boolean {
    try {
      new RegExp(this.value);
    } catch (e) {
      return false;
    }
    return true;
  }

  match(value: string | undefined): boolean {
    if (this.value === undefined) {
      return true;
    }
    if (value === undefined) {
      return false;
    }
    const m = matchString(value, this.value);
    switch (this.comparator) {
      case 'eq':
        return m;
      case 'ne':
        return !m;
      default:
        throw new Error('Unknown comparator: ' + this.comparator);
    }
  }
}
/**
 * Threshold type date
 *
 * @export
 * @class DateTH
 * @extends {GFTH}
 */
export class DateTH extends GFTH<TTHDateData> {
  pattern = /^(?<signe>\+|\-)?(?<number>\d+\.?\d*)(?<precision>d|w|M|Q|y|h|m|s|ms)$/;
  matchs: RegExpMatchArray | null = null;
  testedValue: string | number | undefined;
  date: any;
  isValidated = false;
  isDate = false;
  isPattern = false;
  type = 'date';
  validComp: TTHDateComparator[] = ['eq', 'ne', 'ge', 'gt'];

  protected _setType(): void {
    this.type = 'date';
  }

  static getDefaultData(): TTHDateData {
    return {
      color: 'rgba(245, 54, 54, 0.9)',
      comparator: 'ge',
      value: '-1d',
      level: 0,
    };
  }

  static isValidDate(date: any): boolean {
    try {
      // `dateTimeAsMoment` yields a full Moment (with `year()`/`isAfter`),
      // the Grafana-11 equivalent of the legacy dayjs instance.
      const d = dateTimeAsMoment(date);
      const result = d.isValid();
      if (result) {
        if (d.year() <= 1980) {
          return false;
        }
      }
      return result;
    } catch (error) {
      return false;
    }
  }

  isValidValue(): boolean {
    if (this.testedValue === this.value && this.isValidated) {
      return this.isValidated;
    }

    this.testedValue = this.value;
    this.isValidated = false;
    this.isPattern = false;
    this.isDate = false;
    if (this.testedValue === undefined || this.testedValue === null || this.testedValue.toString().length === 0) {
      return this.isValidated;
    }

    if (dateTimeAsMoment(this.testedValue).isValid()) {
      this.date = dateTimeAsMoment(this.testedValue);
      this.isDate = true;
      this.isValidated = true;
      return this.isValidated;
    } else {
      if (this.pattern.test(this.testedValue.toString()) === true) {
        this.matchs = this.pattern.exec(this.testedValue.toString());
        this.isValidated = true;
        this.isPattern = true;
        if (this.matchs !== null && this.matchs.groups !== undefined) {
          if (this.matchs.groups.signe === undefined) {
            this.matchs.groups.signe = '+';
          }
        }
        return this.isValidated;
      }
    }
    return this.isValidated;
  }

  match(value: any): boolean {
    if (this.value === undefined) {
      return true;
    }
    if (value === undefined) {
      return false;
    }
    if (!this.isValidated) {
      const test = this.isValidValue();
      if (!test) {
        return false;
      }
    }

    if (this.isDate) {
      return this._matchDate(value);
    }
    if (this.isPattern) {
      return this._matchPattern(value);
    }
    return false;
  }

  _matchDate(value: string): boolean {
    return DateTH.compareDates(this.date, value, this.data.comparator, 'd');
  }

  _matchPattern(value: string): boolean {
    if (this.isValidated && this.matchs !== null && this.matchs.groups !== undefined) {
      let now = dateTimeAsMoment();
      const signe = this.matchs.groups.signe;
      const number = parseFloat(`${this.matchs.groups.number}`);
      const precision: any = this.matchs.groups.precision !== undefined ? this.matchs.groups.precision : 'd';
      if (signe === '-') {
        now = now.subtract(number, precision);
      } else {
        now = now.add(number, precision);
      }
      return DateTH.compareDates(now, value, this.data.comparator, precision);
    }
    return false;
  }

  static compareDates(
    beginDate: ReturnType<typeof dateTimeAsMoment>,
    endDate: string,
    comparator: TTHDateComparator,
    precision?: any
  ) {
    const end = dateTimeAsMoment(endDate);
    switch (comparator) {
      case 'eq':
        return end.isSame(beginDate, precision);
      case 'ne':
        return !end.isSame(beginDate, precision);
      case 'ge':
        return end.isSame(beginDate, precision) || end.isAfter(beginDate, precision);
      case 'gt':
        return end.isAfter(beginDate, precision);
      default:
        return false;
    }
  }
}
