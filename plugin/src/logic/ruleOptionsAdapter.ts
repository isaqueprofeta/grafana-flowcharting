/**
 * ruleOptionsAdapter — converts the clean-redesign panel `RuleOptions`
 * (types/options.ts) into the engine-internal legacy `TIRuleData` shape
 * (logic/legacyTypes.ts) the ported {@link Rule} consumes (design.md: Data
 * Models mapping notes; Task 8.2, Req 4.1).
 *
 * The Rule's preserved `_convert(oldData)` migration path reads the *legacy*
 * field names (`numberTHData`, `stringTHData`, `valueData`, `rangeData`,
 * `shapeMaps`/`textMaps`/`linkMaps`/`eventData`, `mapsDat.*.options`, plus the
 * scalar/tooltip fields). This adapter re-expresses a clean `RuleOptions` into
 * exactly those keys so the authored rules drive the engine unchanged — the
 * same migration code that imported saved dashboards now imports the new schema.
 *
 * No `$GF`, Angular, `globalThis`, or `mx*` coupling: this is a pure data map.
 */
import type { RuleOptions, ShapeMap, TextMap, LinkMap, EventMap } from '../types/options';
import type {
  TIRuleData,
  TRuleMapOptions,
  TShapeMapData,
  TTextMapData,
  TlinkMapData,
  TEventMapData,
  TTHNumberData,
  TTHStringData,
  TTHDateData,
  TValueMapData,
  TRangeMapData,
} from './legacyTypes';

/** Build the shared map-ident options block from the clean `mapOptions`. */
function toMapOptions(rule: RuleOptions): TRuleMapOptions {
  const opts = rule.mapOptions;
  return {
    identByProp: opts?.identByProp ?? 'id',
    metadata: opts?.metadata ?? '',
    enableRegEx: opts?.enableRegEx ?? true,
  };
}

function toShapeMaps(maps: ShapeMap[] | undefined): TShapeMapData[] {
  return (maps ?? []).map((m) => ({
    pattern: m.pattern,
    hidden: m.hidden,
    style: m.style as TShapeMapData['style'],
    colorOn: m.colorOn,
  }));
}

function toTextMaps(maps: TextMap[] | undefined): TTextMapData[] {
  return (maps ?? []).map((m) => ({
    pattern: m.pattern,
    hidden: m.hidden,
    textReplace: m.textReplace,
    textPattern: m.textPattern,
    textOn: m.textOn,
  }));
}

function toLinkMaps(maps: LinkMap[] | undefined): TlinkMapData[] {
  return (maps ?? []).map((m) => ({
    pattern: m.pattern,
    hidden: m.hidden,
    linkUrl: m.linkUrl,
    linkParams: m.linkParams,
    linkOn: m.linkOn,
  }));
}

function toEventMaps(maps: EventMap[] | undefined): TEventMapData[] {
  return (maps ?? []).map((m) => ({
    pattern: m.pattern,
    hidden: m.hidden,
    style: m.style as TEventMapData['style'],
    comparator: m.comparator,
    eventOn: m.eventOn,
    value: m.value,
  }));
}

/**
 * Convert a single clean {@link RuleOptions} into the legacy {@link TIRuleData}
 * shape fed as `oldData` to `new Rule(gf, pattern, defaultData, oldData)`.
 *
 * Thresholds map 1:1 (same `{ level, color, comparator, value }` inner shape).
 * Shape/text/link maps use the legacy top-level `*Maps` keys the `_convert`
 * 0.2.0 branch reads; events use `eventData`. Value/range maps use
 * `valueData`/`rangeData`. The per-map-family ident options are supplied through
 * `mapsDat.*.options` so `enableRegEx`/`identByProp`/`metadata` are honored.
 */
export function ruleOptionsToLegacyData(rule: RuleOptions): Partial<TIRuleData> & Record<string, any> {
  const mapOptions = toMapOptions(rule);

  const numberTHData: TTHNumberData[] = (rule.numberThresholds ?? []).map((t) => ({
    level: t.level,
    color: t.color,
    comparator: t.comparator,
    value: t.value,
  }));
  const stringTHData: TTHStringData[] = (rule.stringThresholds ?? []).map((t) => ({
    level: t.level,
    color: t.color,
    comparator: t.comparator,
    value: t.value,
  }));
  const dateTHData: TTHDateData[] = (rule.dateThresholds ?? []).map((t) => ({
    level: t.level,
    color: t.color,
    comparator: t.comparator,
    value: t.value,
  }));

  const valueData: TValueMapData[] = (rule.valueMaps ?? []).map((m) => ({
    value: m.value,
    text: m.text,
    hidden: m.hidden,
  }));
  const rangeData: TRangeMapData[] = (rule.rangeMaps ?? []).map((m) => ({
    from: m.from,
    to: m.to,
    text: m.text,
    hidden: m.hidden,
  }));

  // Shape/text/link maps are read from the legacy top-level `*Maps` keys (the
  // 0.2.0 branch, which wins over `mapsDat.*.dataList`). Event maps, however,
  // are read *last* from `mapsDat.events.dataList` in `_convert`, so that branch
  // overrides any top-level `eventData`; put the authored events there.
  const mapsOptionsBlock = {
    shapes: { options: { ...mapOptions }, dataList: [] },
    texts: { options: { ...mapOptions }, dataList: [] },
    links: { options: { ...mapOptions }, dataList: [] },
    events: { options: { ...mapOptions }, dataList: toEventMaps(rule.eventMaps) },
  };

  return {
    // --- scalar / metric binding ---------------------------------------------
    order: rule.order,
    pattern: rule.pattern,
    metricType: rule.metricType,
    alias: rule.alias,
    refId: rule.refId,
    column: rule.column,
    aggregation: rule.aggregation,
    unit: rule.unit,
    type: rule.type,
    decimals: rule.decimals,
    dateColumn: rule.dateColumn,
    dateFormat: rule.dateFormat as TIRuleData['dateFormat'],
    // `enabled` in the clean schema is the inverse of the legacy `hidden`.
    hidden: rule.enabled === false,
    invert: rule.invert,
    gradient: rule.gradient,
    overlayIcon: rule.overlayIcon,
    sanitize: rule.sanitize,
    mappingType: rule.mappingType,

    // --- tooltip -------------------------------------------------------------
    tooltip: rule.tooltip?.enabled ?? false,
    tooltipLabel: rule.tooltip?.label ?? '',
    tooltipColors: rule.tooltip?.colors ?? false,
    tooltipOn: rule.tooltip?.on ?? 'a',
    tpDirection: rule.tooltip?.direction ?? 'v',
    tpMetadata: rule.tooltip?.metadata ?? false,
    tpGraph: rule.tooltip?.graph ?? false,
    tpGraphType: rule.tooltip?.graphType ?? 'line',
    tpGraphSize: rule.tooltip?.graphSize ?? '100%',
    tpGraphLow: rule.tooltip?.graphLow ?? null,
    tpGraphHigh: rule.tooltip?.graphHigh ?? null,
    tpGraphScale: rule.tooltip?.graphScale ?? 'linear',

    // --- thresholds ----------------------------------------------------------
    numberTHData,
    stringTHData,
    dateTHData,

    // --- value / range maps --------------------------------------------------
    valueData,
    rangeData,

    // --- shape/text/link maps (legacy top-level keys, 0.2.0 branch) ----------
    shapeMaps: toShapeMaps(rule.shapeMaps),
    textMaps: toTextMaps(rule.textMaps),
    linkMaps: toLinkMaps(rule.linkMaps),

    // per-map-family ident options (identByProp / enableRegEx / metadata), and
    // the authored event maps on `mapsDat.events.dataList` (see note above).
    mapsDat: mapsOptionsBlock,
  };
}
