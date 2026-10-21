/**
 * RulesEditor — bespoke custom React panel-option editor authoring the clean
 * Options_Schema `RuleOptions[]` (design.md "Options_Editor (hybrid)" /
 * "Rules_Editor", Req 4.1, 4.2, 5.6).
 *
 * The legacy Angular `rules_options` tab authored the full rule structure. This
 * React custom editor replaces it. It is registered in module.ts via
 * `addCustomEditor({ id: 'rules', path: 'rules', name: 'Rules', editor })`, so
 * `value` is the full `rules[]` array and `onChange` replaces that array.
 *
 * SCOPE — Task 10.1 (this file):
 *   - add / remove / reorder rules (the `order` field tracks list position);
 *   - per-rule enable/disable toggle;
 *   - pattern input;
 *   - metric binding: metricType (serie/table), aggregation, column/refId,
 *     value type (number/string/date), plus unit/decimals/date format;
 *   - threshold authoring for number/string/date with add/remove threshold rows
 *     (color picker + comparator + value).
 *
 * SCOPE — Task 10.2 (this file, additive to 10.1):
 *   - value maps (value/text/hidden) and range maps (from/to/text/hidden),
 *     selected by `mappingType` (1 = value, 2 = range);
 *   - shape maps (pattern/style/colorOn/hidden), text maps
 *     (pattern/textReplace/textPattern/textOn/hidden), link maps
 *     (pattern/linkUrl/linkParams/linkOn/hidden), event maps
 *     (pattern/style/comparator/value/eventOn/hidden);
 *   - shared `mapOptions` (identByProp id/value/metadata, metadata, enableRegEx);
 *   - tooltip + sparkline settings (TooltipOptions).
 *
 * Option lists and threshold/map defaults are reused from the ported
 * Logic_Layer:
 *   - GFCONSTANT.{METRIC_TYPES,AGGREGATION_TYPES,VALUE_TYPES,COMPARATOR_TYPES,
 *     VALUEMAPPINGTYPES,IDENT_TYPES,COLORMETHODS,COLOR_APPLYON,TEXTMETHODS,
 *     TEXT_APPLYON,LINK_APPLYON,EVENTMETHODS,TOOLTIP_APPLYON,
 *     TOOLTIP_DIRECTION_TYPES,TOOLTIP_GRAPH_TYPES,TOOLTIP_GRAPH_SCALE_TYPES,
 *     TOOLTIP_GRAPH_SIZE_TYPES} (logic/globals) for the select option lists;
 *   - NumberTH/StringTH/DateTH.getDefaultData() (logic/threshold) for new rows.
 *
 * Uses only `@grafana/ui` components and `StandardEditorProps` from
 * `@grafana/data`. No `$GF`, Angular, or global coupling.
 */
import React, { useState } from 'react';
import { SelectableValue, StandardEditorProps } from '@grafana/data';
import {
  Button,
  Checkbox,
  ColorPicker,
  Field,
  IconButton,
  InlineField,
  InlineFieldRow,
  Input,
  Select,
} from '@grafana/ui';
import {
  Aggregation,
  Comparator,
  DateThreshold,
  EventMap,
  LinkMap,
  NumberThreshold,
  RangeMap,
  RuleOptions,
  ShapeMap,
  StringThreshold,
  TextMap,
  TooltipOptions,
  ValueMap,
  ValueType,
} from '../../types/options';
import { GFCONSTANT } from '../../logic/globals';
import { NumberTH, StringTH, DateTH } from '../../logic/threshold';

type Props = StandardEditorProps<RuleOptions[]>;

// --- Option lists (reused from the ported GFCONSTANT) ------------------------

/** Map a `GFCONSTANT` `{ text, value }` list to `@grafana/ui` Select options. */
function toSelectOptions<V extends string>(
  list: ReadonlyArray<{ text: string; value: string }>
): Array<SelectableValue<V>> {
  return list.map((o) => ({ label: o.text, value: o.value as V }));
}

const METRIC_TYPE_OPTIONS = toSelectOptions<RuleOptions['metricType']>(GFCONSTANT.METRIC_TYPES);
const AGGREGATION_OPTIONS = toSelectOptions<Aggregation>(GFCONSTANT.AGGREGATION_TYPES);
const VALUE_TYPE_OPTIONS = toSelectOptions<ValueType>(GFCONSTANT.VALUE_TYPES);
const COMPARATOR_OPTIONS = toSelectOptions<Comparator>(GFCONSTANT.COMPARATOR_TYPES);

// Mapping / map-family / tooltip option lists (reused from GFCONSTANT).
const IDENT_TYPE_OPTIONS = toSelectOptions<RuleOptions['mapOptions']['identByProp']>(GFCONSTANT.IDENT_TYPES);
const COLOR_APPLYON_OPTIONS = toSelectOptions<ShapeMap['colorOn']>(GFCONSTANT.COLOR_APPLYON);
const COLORMETHODS_OPTIONS = toSelectOptions<string>(GFCONSTANT.COLORMETHODS);
const TEXTMETHODS_OPTIONS = toSelectOptions<TextMap['textReplace']>(GFCONSTANT.TEXTMETHODS);
const TEXT_APPLYON_OPTIONS = toSelectOptions<TextMap['textOn']>(GFCONSTANT.TEXT_APPLYON);
const LINK_APPLYON_OPTIONS = toSelectOptions<LinkMap['linkOn']>(GFCONSTANT.LINK_APPLYON);
const EVENTMETHODS_OPTIONS: Array<SelectableValue<string>> = GFCONSTANT.EVENTMETHODS.map((o) => ({
  label: o.text,
  value: o.value,
}));
const TOOLTIP_APPLYON_OPTIONS = toSelectOptions<TooltipOptions['on']>(GFCONSTANT.TOOLTIP_APPLYON);
const TOOLTIP_DIRECTION_OPTIONS = toSelectOptions<TooltipOptions['direction']>(GFCONSTANT.TOOLTIP_DIRECTION_TYPES);
const TOOLTIP_GRAPH_TYPE_OPTIONS = toSelectOptions<TooltipOptions['graphType']>(GFCONSTANT.TOOLTIP_GRAPH_TYPES);
const TOOLTIP_GRAPH_SCALE_OPTIONS = toSelectOptions<TooltipOptions['graphScale']>(GFCONSTANT.TOOLTIP_GRAPH_SCALE_TYPES);
const TOOLTIP_GRAPH_SIZE_OPTIONS = toSelectOptions<TooltipOptions['graphSize']>(GFCONSTANT.TOOLTIP_GRAPH_SIZE_TYPES);
/** `VALUEMAPPINGTYPES` carries numeric values (1 = value, 2 = range). */
const MAPPINGTYPE_OPTIONS: Array<SelectableValue<RuleOptions['mappingType']>> = GFCONSTANT.VALUEMAPPINGTYPES.map(
  (o) => ({ label: o.text, value: o.value as RuleOptions['mappingType'] })
);

/** Comparators valid for each threshold family (mirrors the TH `validComp`). */
const NUMBER_COMPARATORS: Array<NumberThreshold['comparator']> = ['ge', 'gt'];
const STRING_COMPARATORS: Array<StringThreshold['comparator']> = ['eq', 'ne'];
const DATE_COMPARATORS: Array<DateThreshold['comparator']> = ['eq', 'ne', 'ge', 'gt'];

function comparatorOptionsFor(
  allowed: ReadonlyArray<string>
): Array<SelectableValue<string>> {
  return COMPARATOR_OPTIONS.filter((o) => allowed.includes(o.value as string));
}

// --- Defaults ----------------------------------------------------------------

/**
 * A fresh rule with clean-schema defaults. `order` is assigned by the caller to
 * match the list position. Mapping/tooltip fields are seeded empty/disabled so
 * the Task 10.2 editors can extend them later without a migration.
 */
export function createDefaultRule(order: number, name = 'Rule'): RuleOptions {
  return {
    order,
    enabled: true,
    pattern: `/.*/`,
    metricType: 'serie',
    alias: name,
    refId: '',
    column: '',
    aggregation: 'current',
    type: 'number',
    unit: 'short',
    decimals: 2,
    dateColumn: '',
    dateFormat: 'YYYY-MM-DD HH:mm:ss',
    numberThresholds: [],
    stringThresholds: [],
    dateThresholds: [],
    invert: false,
    mappingType: 1,
    valueMaps: [],
    rangeMaps: [],
    shapeMaps: [],
    textMaps: [],
    linkMaps: [],
    eventMaps: [],
    mapOptions: { identByProp: 'id', metadata: '', enableRegEx: true },
    tooltip: {
      enabled: false,
      label: '',
      colors: false,
      on: 'a',
      direction: 'v',
      metadata: false,
      graph: false,
      graphType: 'line',
      graphSize: '100%',
      graphScale: 'linear',
      graphLow: null,
      graphHigh: null,
    },
    gradient: false,
    overlayIcon: false,
    sanitize: false,
  };
}

/** Build a new threshold row for the given value type, reusing TH defaults. */
function createNumberThreshold(level: number): NumberThreshold {
  const d = NumberTH.getDefaultData();
  return { level, color: d.color, comparator: d.comparator, value: d.value };
}
function createStringThreshold(level: number): StringThreshold {
  const d = StringTH.getDefaultData();
  return { level, color: d.color, comparator: d.comparator, value: d.value };
}
function createDateThreshold(level: number): DateThreshold {
  const d = DateTH.getDefaultData();
  return { level, color: d.color, comparator: d.comparator, value: d.value };
}

// --- Map defaults ------------------------------------------------------------

function createValueMap(): ValueMap {
  return { value: '', text: '', hidden: false };
}
function createRangeMap(): RangeMap {
  return { from: '', to: '', text: '', hidden: false };
}
function createShapeMap(): ShapeMap {
  return { pattern: '/.*/', style: 'fillColor', colorOn: 'a', hidden: false };
}
function createTextMap(): TextMap {
  return { pattern: '/.*/', textReplace: 'content', textPattern: '/.*/', textOn: 'wmd', hidden: false };
}
function createLinkMap(): LinkMap {
  return { pattern: '/.*/', linkUrl: '', linkParams: false, linkOn: 'a', hidden: false };
}
function createEventMap(): EventMap {
  return { pattern: '/.*/', style: 'shape', comparator: 'eq', value: '', eventOn: 0, hidden: false };
}

// --- Component ---------------------------------------------------------------

export const RulesEditor: React.FC<Props> = ({ value, onChange }) => {
  const rules = Array.isArray(value) ? value : [];
  const [selectedIndex, setSelectedIndex] = useState(0);

  /** Reassign `order` to match array position so it stays canonical. */
  const withOrder = (next: RuleOptions[]): RuleOptions[] =>
    next.map((r, i) => (r.order === i ? r : { ...r, order: i }));

  const emit = (next: RuleOptions[]) => onChange(withOrder(next));

  const addRule = () => {
    const next = [...rules, createDefaultRule(rules.length, `Rule ${rules.length + 1}`)];
    emit(next);
    setSelectedIndex(next.length - 1);
  };

  const removeRule = (index: number) => {
    const next = rules.filter((_, i) => i !== index);
    emit(next);
    setSelectedIndex((prev) => Math.max(0, Math.min(prev, next.length - 1)));
  };

  const moveRule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rules.length) {
      return;
    }
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    emit(next);
    setSelectedIndex(target);
  };

  /** Replace rule `index` with a patched copy, preserving all other fields. */
  const patchRule = (index: number, patch: Partial<RuleOptions>) => {
    const next = [...rules];
    next[index] = { ...next[index], ...patch };
    emit(next);
  };

  const safeIndex = rules.length === 0 ? 0 : Math.min(selectedIndex, rules.length - 1);
  const active = rules[safeIndex];

  return (
    <div data-testid="rules-editor">
      <Field
        label="Rules"
        description="Each rule binds a metric to a pattern and colors matching cells via thresholds."
      >
        <div>
          {rules.length === 0 && (
            <div data-testid="rules-editor-empty" style={{ marginBottom: 8 }}>
              No rules yet.
            </div>
          )}

          {rules.map((rule, index) => (
            <div
              key={index}
              data-testid={`rules-editor-row-${index}`}
              style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}
            >
              <IconButton
                name="eye"
                tooltip={`Select rule ${index + 1}`}
                variant={index === safeIndex ? 'primary' : 'secondary'}
                onClick={() => setSelectedIndex(index)}
              />
              <InlineField grow>
                <Input
                  aria-label={`Rule alias ${index + 1}`}
                  value={rule.alias}
                  placeholder={`Rule ${index + 1}`}
                  onChange={(e) => patchRule(index, { alias: e.currentTarget.value })}
                />
              </InlineField>
              <Checkbox
                aria-label={`Enable rule ${index + 1}`}
                value={rule.enabled}
                onChange={(e) => patchRule(index, { enabled: e.currentTarget.checked })}
              />
              <IconButton
                name="arrow-up"
                tooltip={`Move rule ${index + 1} up`}
                disabled={index === 0}
                onClick={() => moveRule(index, -1)}
              />
              <IconButton
                name="arrow-down"
                tooltip={`Move rule ${index + 1} down`}
                disabled={index === rules.length - 1}
                onClick={() => moveRule(index, 1)}
              />
              <IconButton
                name="trash-alt"
                tooltip={`Remove rule ${index + 1}`}
                onClick={() => removeRule(index)}
              />
            </div>
          ))}

          <Button variant="secondary" icon="plus" onClick={addRule} data-testid="rules-editor-add">
            Add rule
          </Button>
        </div>
      </Field>

      {active && (
        <RuleDetail
          key={safeIndex}
          rule={active}
          onPatch={(patch) => patchRule(safeIndex, patch)}
        />
      )}
    </div>
  );
};

// --- Per-rule detail editor --------------------------------------------------

interface RuleDetailProps {
  rule: RuleOptions;
  onPatch: (patch: Partial<RuleOptions>) => void;
}

const RuleDetail: React.FC<RuleDetailProps> = ({ rule, onPatch }) => {
  return (
    <div data-testid="rules-editor-detail" style={{ marginTop: 12 }}>
      <Field label="Pattern" description="RegEx / text matched against the metric name or table column.">
        <Input
          aria-label="Rule pattern"
          value={rule.pattern}
          placeholder="/.*/"
          onChange={(e) => onPatch({ pattern: e.currentTarget.value })}
        />
      </Field>

      {/* --- Metric binding ------------------------------------------------- */}
      <Field label="Metric binding" description="Bind the rule to a series or table metric.">
        <div>
          <InlineFieldRow>
            <InlineField label="Metric type" labelWidth={14}>
              <Select<RuleOptions['metricType']>
                aria-label="Metric type"
                width={20}
                options={METRIC_TYPE_OPTIONS}
                value={rule.metricType}
                onChange={(sel) => onPatch({ metricType: sel.value ?? 'serie' })}
              />
            </InlineField>
            <InlineField label="Aggregation" labelWidth={14}>
              <Select<Aggregation>
                aria-label="Aggregation"
                width={20}
                options={AGGREGATION_OPTIONS}
                value={rule.aggregation}
                onChange={(sel) => onPatch({ aggregation: sel.value ?? 'current' })}
              />
            </InlineField>
          </InlineFieldRow>

          <InlineFieldRow>
            {rule.metricType === 'table' ? (
              <>
                <InlineField label="Ref ID" labelWidth={14}>
                  <Input
                    aria-label="Ref ID"
                    width={20}
                    value={rule.refId}
                    placeholder="A"
                    onChange={(e) => onPatch({ refId: e.currentTarget.value })}
                  />
                </InlineField>
                <InlineField label="Column" labelWidth={14}>
                  <Input
                    aria-label="Column"
                    width={20}
                    value={rule.column}
                    placeholder="Value column"
                    onChange={(e) => onPatch({ column: e.currentTarget.value })}
                  />
                </InlineField>
              </>
            ) : (
              <InlineField label="Series alias" labelWidth={14}>
                <Input
                  aria-label="Series alias"
                  width={20}
                  value={rule.alias}
                  placeholder="Series alias"
                  onChange={(e) => onPatch({ alias: e.currentTarget.value })}
                />
              </InlineField>
            )}
            <InlineField label="Value type" labelWidth={14}>
              <Select<ValueType>
                aria-label="Value type"
                width={20}
                options={VALUE_TYPE_OPTIONS}
                value={rule.type}
                onChange={(sel) => onPatch({ type: sel.value ?? 'number' })}
              />
            </InlineField>
          </InlineFieldRow>

          <InlineFieldRow>
            {rule.type === 'date' ? (
              <InlineField label="Date format" labelWidth={14}>
                <Input
                  aria-label="Date format"
                  width={20}
                  value={rule.dateFormat}
                  placeholder="YYYY-MM-DD HH:mm:ss"
                  onChange={(e) => onPatch({ dateFormat: e.currentTarget.value })}
                />
              </InlineField>
            ) : (
              <>
                <InlineField label="Unit" labelWidth={14}>
                  <Input
                    aria-label="Unit"
                    width={20}
                    value={rule.unit}
                    placeholder="short"
                    onChange={(e) => onPatch({ unit: e.currentTarget.value })}
                  />
                </InlineField>
                <InlineField label="Decimals" labelWidth={14}>
                  <Input
                    aria-label="Decimals"
                    width={20}
                    type="number"
                    value={rule.decimals}
                    onChange={(e) => onPatch({ decimals: Number(e.currentTarget.value) })}
                  />
                </InlineField>
              </>
            )}
          </InlineFieldRow>
        </div>
      </Field>

      {/* --- Thresholds (number / string / date) --------------------------- */}
      <ThresholdsSection rule={rule} onPatch={onPatch} />

      {/* --- Mapping identity (shared mapOptions) -------------------------- */}
      <MapOptionsSection rule={rule} onPatch={onPatch} />

      {/* --- Value / range maps (selected by mappingType) ------------------ */}
      <MappingsSection rule={rule} onPatch={onPatch} />

      {/* --- Shape / text / link / event maps ------------------------------ */}
      <ShapeMapsEditor shapeMaps={rule.shapeMaps} onChange={(shapeMaps) => onPatch({ shapeMaps })} />
      <TextMapsEditor textMaps={rule.textMaps} onChange={(textMaps) => onPatch({ textMaps })} />
      <LinkMapsEditor linkMaps={rule.linkMaps} onChange={(linkMaps) => onPatch({ linkMaps })} />
      <EventMapsEditor eventMaps={rule.eventMaps} onChange={(eventMaps) => onPatch({ eventMaps })} />

      {/* --- Tooltip + sparkline ------------------------------------------- */}
      <TooltipSection tooltip={rule.tooltip} onChange={(tooltip) => onPatch({ tooltip })} />
    </div>
  );
};

// --- Shared map identity (mapOptions) ----------------------------------------

const MapOptionsSection: React.FC<RuleDetailProps> = ({ rule, onPatch }) => {
  const mo = rule.mapOptions;
  return (
    <Field
      label="Cell identification"
      description="How mappings match diagram cells: by id, label, or a metadata key."
    >
      <div data-testid="map-options">
        <InlineFieldRow>
          <InlineField label="Identify by" labelWidth={14}>
            <Select<RuleOptions['mapOptions']['identByProp']>
              aria-label="Identify by"
              width={20}
              options={IDENT_TYPE_OPTIONS}
              value={mo.identByProp}
              onChange={(sel) =>
                onPatch({ mapOptions: { ...mo, identByProp: sel.value ?? 'id' } })
              }
            />
          </InlineField>
          {mo.identByProp === 'metadata' && (
            <InlineField label="Metadata key" labelWidth={14}>
              <Input
                aria-label="Metadata key"
                width={20}
                value={mo.metadata}
                placeholder="Metadata key"
                onChange={(e) => onPatch({ mapOptions: { ...mo, metadata: e.currentTarget.value } })}
              />
            </InlineField>
          )}
          <InlineField label="Enable RegEx" labelWidth={14}>
            <Checkbox
              aria-label="Enable RegEx"
              value={mo.enableRegEx}
              onChange={(e) => onPatch({ mapOptions: { ...mo, enableRegEx: e.currentTarget.checked } })}
            />
          </InlineField>
        </InlineFieldRow>
      </div>
    </Field>
  );
};

// --- Value / range maps ------------------------------------------------------

const MappingsSection: React.FC<RuleDetailProps> = ({ rule, onPatch }) => {
  return (
    <Field label="Value mapping" description="Map raw values (or ranges) to display text.">
      <div data-testid="mappings-section">
        <InlineFieldRow>
          <InlineField label="Mapping type" labelWidth={14}>
            <Select<RuleOptions['mappingType']>
              aria-label="Mapping type"
              width={20}
              options={MAPPINGTYPE_OPTIONS}
              value={rule.mappingType}
              onChange={(sel) => onPatch({ mappingType: sel.value ?? 1 })}
            />
          </InlineField>
        </InlineFieldRow>
        {rule.mappingType === 2 ? (
          <RangeMapsEditor rangeMaps={rule.rangeMaps} onChange={(rangeMaps) => onPatch({ rangeMaps })} />
        ) : (
          <ValueMapsEditor valueMaps={rule.valueMaps} onChange={(valueMaps) => onPatch({ valueMaps })} />
        )}
      </div>
    </Field>
  );
};

const ValueMapsEditor: React.FC<{
  valueMaps: ValueMap[];
  onChange: (next: ValueMap[]) => void;
}> = ({ valueMaps, onChange }) => (
  <div data-testid="value-maps">
    {valueMaps.map((m, index) => (
      <InlineFieldRow key={index} data-testid={`value-map-${index}`}>
        <InlineField label="Value" labelWidth={10}>
          <Input
            aria-label={`Value map value ${index}`}
            width={16}
            value={m.value ?? ''}
            placeholder="raw value"
            onChange={(e) =>
              onChange(valueMaps.map((r, i) => (i === index ? { ...r, value: e.currentTarget.value } : r)))
            }
          />
        </InlineField>
        <InlineField label="Text" labelWidth={8}>
          <Input
            aria-label={`Value map text ${index}`}
            width={16}
            value={m.text ?? ''}
            placeholder="display text"
            onChange={(e) =>
              onChange(valueMaps.map((r, i) => (i === index ? { ...r, text: e.currentTarget.value } : r)))
            }
          />
        </InlineField>
        <InlineField label="Hidden" labelWidth={8}>
          <Checkbox
            aria-label={`Value map hidden ${index}`}
            value={m.hidden}
            onChange={(e) =>
              onChange(valueMaps.map((r, i) => (i === index ? { ...r, hidden: e.currentTarget.checked } : r)))
            }
          />
        </InlineField>
        <IconButton
          name="trash-alt"
          tooltip={`Remove value map ${index}`}
          onClick={() => onChange(valueMaps.filter((_, i) => i !== index))}
        />
      </InlineFieldRow>
    ))}
    <Button
      variant="secondary"
      icon="plus"
      data-testid="value-map-add"
      onClick={() => onChange([...valueMaps, createValueMap()])}
    >
      Add value map
    </Button>
  </div>
);

const RangeMapsEditor: React.FC<{
  rangeMaps: RangeMap[];
  onChange: (next: RangeMap[]) => void;
}> = ({ rangeMaps, onChange }) => (
  <div data-testid="range-maps">
    {rangeMaps.map((m, index) => (
      <InlineFieldRow key={index} data-testid={`range-map-${index}`}>
        <InlineField label="From" labelWidth={8}>
          <Input
            aria-label={`Range map from ${index}`}
            width={12}
            value={m.from ?? ''}
            placeholder="from"
            onChange={(e) =>
              onChange(rangeMaps.map((r, i) => (i === index ? { ...r, from: e.currentTarget.value } : r)))
            }
          />
        </InlineField>
        <InlineField label="To" labelWidth={6}>
          <Input
            aria-label={`Range map to ${index}`}
            width={12}
            value={m.to ?? ''}
            placeholder="to"
            onChange={(e) =>
              onChange(rangeMaps.map((r, i) => (i === index ? { ...r, to: e.currentTarget.value } : r)))
            }
          />
        </InlineField>
        <InlineField label="Text" labelWidth={8}>
          <Input
            aria-label={`Range map text ${index}`}
            width={16}
            value={m.text ?? ''}
            placeholder="display text"
            onChange={(e) =>
              onChange(rangeMaps.map((r, i) => (i === index ? { ...r, text: e.currentTarget.value } : r)))
            }
          />
        </InlineField>
        <InlineField label="Hidden" labelWidth={8}>
          <Checkbox
            aria-label={`Range map hidden ${index}`}
            value={m.hidden}
            onChange={(e) =>
              onChange(rangeMaps.map((r, i) => (i === index ? { ...r, hidden: e.currentTarget.checked } : r)))
            }
          />
        </InlineField>
        <IconButton
          name="trash-alt"
          tooltip={`Remove range map ${index}`}
          onClick={() => onChange(rangeMaps.filter((_, i) => i !== index))}
        />
      </InlineFieldRow>
    ))}
    <Button
      variant="secondary"
      icon="plus"
      data-testid="range-map-add"
      onClick={() => onChange([...rangeMaps, createRangeMap()])}
    >
      Add range map
    </Button>
  </div>
);

// --- Shape maps --------------------------------------------------------------

const ShapeMapsEditor: React.FC<{
  shapeMaps: ShapeMap[];
  onChange: (next: ShapeMap[]) => void;
}> = ({ shapeMaps, onChange }) => (
  <Field label="Shape maps" description="Color matching cells; the applied style decides which part is colored.">
    <div data-testid="shape-maps">
      {shapeMaps.map((m, index) => (
        <InlineFieldRow key={index} data-testid={`shape-map-${index}`}>
          <InlineField label="Pattern" labelWidth={10}>
            <Input
              aria-label={`Shape map pattern ${index}`}
              width={16}
              value={m.pattern}
              placeholder="/.*/"
              onChange={(e) =>
                onChange(shapeMaps.map((r, i) => (i === index ? { ...r, pattern: e.currentTarget.value } : r)))
              }
            />
          </InlineField>
          <InlineField label="Style" labelWidth={8}>
            <Select<string>
              aria-label={`Shape map style ${index}`}
              width={24}
              options={COLORMETHODS_OPTIONS}
              value={m.style}
              onChange={(sel) =>
                onChange(shapeMaps.map((r, i) => (i === index ? { ...r, style: sel.value ?? 'fillColor' } : r)))
              }
            />
          </InlineField>
          <InlineField label="Color on" labelWidth={9}>
            <Select<ShapeMap['colorOn']>
              aria-label={`Shape map color on ${index}`}
              width={18}
              options={COLOR_APPLYON_OPTIONS}
              value={m.colorOn}
              onChange={(sel) =>
                onChange(shapeMaps.map((r, i) => (i === index ? { ...r, colorOn: sel.value ?? 'a' } : r)))
              }
            />
          </InlineField>
          <InlineField label="Hidden" labelWidth={8}>
            <Checkbox
              aria-label={`Shape map hidden ${index}`}
              value={m.hidden}
              onChange={(e) =>
                onChange(shapeMaps.map((r, i) => (i === index ? { ...r, hidden: e.currentTarget.checked } : r)))
              }
            />
          </InlineField>
          <IconButton
            name="trash-alt"
            tooltip={`Remove shape map ${index}`}
            onClick={() => onChange(shapeMaps.filter((_, i) => i !== index))}
          />
        </InlineFieldRow>
      ))}
      <Button
        variant="secondary"
        icon="plus"
        data-testid="shape-map-add"
        onClick={() => onChange([...shapeMaps, createShapeMap()])}
      >
        Add shape map
      </Button>
    </div>
  </Field>
);

// --- Text maps ---------------------------------------------------------------

const TextMapsEditor: React.FC<{
  textMaps: TextMap[];
  onChange: (next: TextMap[]) => void;
}> = ({ textMaps, onChange }) => (
  <Field label="Text maps" description="Replace or append the label of matching cells.">
    <div data-testid="text-maps">
      {textMaps.map((m, index) => (
        <InlineFieldRow key={index} data-testid={`text-map-${index}`}>
          <InlineField label="Pattern" labelWidth={10}>
            <Input
              aria-label={`Text map pattern ${index}`}
              width={16}
              value={m.pattern}
              placeholder="/.*/"
              onChange={(e) =>
                onChange(textMaps.map((r, i) => (i === index ? { ...r, pattern: e.currentTarget.value } : r)))
              }
            />
          </InlineField>
          <InlineField label="Replace" labelWidth={9}>
            <Select<TextMap['textReplace']>
              aria-label={`Text map replace ${index}`}
              width={18}
              options={TEXTMETHODS_OPTIONS}
              value={m.textReplace}
              onChange={(sel) =>
                onChange(textMaps.map((r, i) => (i === index ? { ...r, textReplace: sel.value ?? 'content' } : r)))
              }
            />
          </InlineField>
          <InlineField label="Text pattern" labelWidth={12}>
            <Input
              aria-label={`Text map text pattern ${index}`}
              width={16}
              value={m.textPattern}
              placeholder="/.*/"
              onChange={(e) =>
                onChange(textMaps.map((r, i) => (i === index ? { ...r, textPattern: e.currentTarget.value } : r)))
              }
            />
          </InlineField>
          <InlineField label="Text on" labelWidth={8}>
            <Select<TextMap['textOn']>
              aria-label={`Text map text on ${index}`}
              width={20}
              options={TEXT_APPLYON_OPTIONS}
              value={m.textOn}
              onChange={(sel) =>
                onChange(textMaps.map((r, i) => (i === index ? { ...r, textOn: sel.value ?? 'wmd' } : r)))
              }
            />
          </InlineField>
          <InlineField label="Hidden" labelWidth={8}>
            <Checkbox
              aria-label={`Text map hidden ${index}`}
              value={m.hidden}
              onChange={(e) =>
                onChange(textMaps.map((r, i) => (i === index ? { ...r, hidden: e.currentTarget.checked } : r)))
              }
            />
          </InlineField>
          <IconButton
            name="trash-alt"
            tooltip={`Remove text map ${index}`}
            onClick={() => onChange(textMaps.filter((_, i) => i !== index))}
          />
        </InlineFieldRow>
      ))}
      <Button
        variant="secondary"
        icon="plus"
        data-testid="text-map-add"
        onClick={() => onChange([...textMaps, createTextMap()])}
      >
        Add text map
      </Button>
    </div>
  </Field>
);

// --- Link maps ---------------------------------------------------------------

const LinkMapsEditor: React.FC<{
  linkMaps: LinkMap[];
  onChange: (next: LinkMap[]) => void;
}> = ({ linkMaps, onChange }) => (
  <Field label="Link maps" description="Attach a clickable link to matching cells.">
    <div data-testid="link-maps">
      {linkMaps.map((m, index) => (
        <InlineFieldRow key={index} data-testid={`link-map-${index}`}>
          <InlineField label="Pattern" labelWidth={10}>
            <Input
              aria-label={`Link map pattern ${index}`}
              width={16}
              value={m.pattern}
              placeholder="/.*/"
              onChange={(e) =>
                onChange(linkMaps.map((r, i) => (i === index ? { ...r, pattern: e.currentTarget.value } : r)))
              }
            />
          </InlineField>
          <InlineField label="URL" labelWidth={6}>
            <Input
              aria-label={`Link map url ${index}`}
              width={24}
              value={m.linkUrl}
              placeholder="https://..."
              onChange={(e) =>
                onChange(linkMaps.map((r, i) => (i === index ? { ...r, linkUrl: e.currentTarget.value } : r)))
              }
            />
          </InlineField>
          <InlineField label="Params" labelWidth={9}>
            <Checkbox
              aria-label={`Link map params ${index}`}
              value={m.linkParams}
              onChange={(e) =>
                onChange(linkMaps.map((r, i) => (i === index ? { ...r, linkParams: e.currentTarget.checked } : r)))
              }
            />
          </InlineField>
          <InlineField label="Link on" labelWidth={9}>
            <Select<LinkMap['linkOn']>
              aria-label={`Link map link on ${index}`}
              width={18}
              options={LINK_APPLYON_OPTIONS}
              value={m.linkOn}
              onChange={(sel) =>
                onChange(linkMaps.map((r, i) => (i === index ? { ...r, linkOn: sel.value ?? 'a' } : r)))
              }
            />
          </InlineField>
          <InlineField label="Hidden" labelWidth={8}>
            <Checkbox
              aria-label={`Link map hidden ${index}`}
              value={m.hidden}
              onChange={(e) =>
                onChange(linkMaps.map((r, i) => (i === index ? { ...r, hidden: e.currentTarget.checked } : r)))
              }
            />
          </InlineField>
          <IconButton
            name="trash-alt"
            tooltip={`Remove link map ${index}`}
            onClick={() => onChange(linkMaps.filter((_, i) => i !== index))}
          />
        </InlineFieldRow>
      ))}
      <Button
        variant="secondary"
        icon="plus"
        data-testid="link-map-add"
        onClick={() => onChange([...linkMaps, createLinkMap()])}
      >
        Add link map
      </Button>
    </div>
  </Field>
);

// --- Event maps --------------------------------------------------------------

const EventMapsEditor: React.FC<{
  eventMaps: EventMap[];
  onChange: (next: EventMap[]) => void;
}> = ({ eventMaps, onChange }) => (
  <Field label="Event maps" description="Drive shape events (form, rotation, blink, ...) from a comparison.">
    <div data-testid="event-maps">
      {eventMaps.map((m, index) => (
        <InlineFieldRow key={index} data-testid={`event-map-${index}`}>
          <InlineField label="Pattern" labelWidth={10}>
            <Input
              aria-label={`Event map pattern ${index}`}
              width={16}
              value={m.pattern}
              placeholder="/.*/"
              onChange={(e) =>
                onChange(eventMaps.map((r, i) => (i === index ? { ...r, pattern: e.currentTarget.value } : r)))
              }
            />
          </InlineField>
          <InlineField label="Event" labelWidth={7}>
            <Select<string>
              aria-label={`Event map style ${index}`}
              width={28}
              options={EVENTMETHODS_OPTIONS}
              value={m.style}
              onChange={(sel) =>
                onChange(eventMaps.map((r, i) => (i === index ? { ...r, style: sel.value ?? 'shape' } : r)))
              }
            />
          </InlineField>
          <InlineField label="Comp" labelWidth={6}>
            <Select<Comparator>
              aria-label={`Event map comparator ${index}`}
              width={14}
              options={COMPARATOR_OPTIONS}
              value={m.comparator}
              onChange={(sel) =>
                onChange(eventMaps.map((r, i) => (i === index ? { ...r, comparator: sel.value ?? 'eq' } : r)))
              }
            />
          </InlineField>
          <InlineField label="Value" labelWidth={7}>
            <Input
              aria-label={`Event map value ${index}`}
              width={14}
              value={m.value}
              onChange={(e) =>
                onChange(eventMaps.map((r, i) => (i === index ? { ...r, value: e.currentTarget.value } : r)))
              }
            />
          </InlineField>
          <InlineField label="Hidden" labelWidth={8}>
            <Checkbox
              aria-label={`Event map hidden ${index}`}
              value={m.hidden}
              onChange={(e) =>
                onChange(eventMaps.map((r, i) => (i === index ? { ...r, hidden: e.currentTarget.checked } : r)))
              }
            />
          </InlineField>
          <IconButton
            name="trash-alt"
            tooltip={`Remove event map ${index}`}
            onClick={() => onChange(eventMaps.filter((_, i) => i !== index))}
          />
        </InlineFieldRow>
      ))}
      <Button
        variant="secondary"
        icon="plus"
        data-testid="event-map-add"
        onClick={() => onChange([...eventMaps, createEventMap()])}
      >
        Add event map
      </Button>
    </div>
  </Field>
);

// --- Tooltip + sparkline -----------------------------------------------------

const TooltipSection: React.FC<{
  tooltip: TooltipOptions;
  onChange: (next: TooltipOptions) => void;
}> = ({ tooltip, onChange }) => {
  const patch = (p: Partial<TooltipOptions>) => onChange({ ...tooltip, ...p });
  return (
    <Field label="Tooltip" description="Hover tooltip for matching cells, with an optional sparkline graph.">
      <div data-testid="tooltip-section">
        <InlineFieldRow>
          <InlineField label="Enabled" labelWidth={14}>
            <Checkbox
              aria-label="Tooltip enabled"
              value={tooltip.enabled}
              onChange={(e) => patch({ enabled: e.currentTarget.checked })}
            />
          </InlineField>
          <InlineField label="Show colors" labelWidth={14}>
            <Checkbox
              aria-label="Tooltip colors"
              value={tooltip.colors}
              onChange={(e) => patch({ colors: e.currentTarget.checked })}
            />
          </InlineField>
          <InlineField label="Metadata" labelWidth={14}>
            <Checkbox
              aria-label="Tooltip metadata"
              value={tooltip.metadata}
              onChange={(e) => patch({ metadata: e.currentTarget.checked })}
            />
          </InlineField>
        </InlineFieldRow>

        <InlineFieldRow>
          <InlineField label="Label" labelWidth={14}>
            <Input
              aria-label="Tooltip label"
              width={24}
              value={tooltip.label}
              placeholder="Tooltip label"
              onChange={(e) => patch({ label: e.currentTarget.value })}
            />
          </InlineField>
          <InlineField label="Show on" labelWidth={14}>
            <Select<TooltipOptions['on']>
              aria-label="Tooltip show on"
              width={20}
              options={TOOLTIP_APPLYON_OPTIONS}
              value={tooltip.on}
              onChange={(sel) => patch({ on: sel.value ?? 'a' })}
            />
          </InlineField>
          <InlineField label="Direction" labelWidth={14}>
            <Select<TooltipOptions['direction']>
              aria-label="Tooltip direction"
              width={20}
              options={TOOLTIP_DIRECTION_OPTIONS}
              value={tooltip.direction}
              onChange={(sel) => patch({ direction: sel.value ?? 'v' })}
            />
          </InlineField>
        </InlineFieldRow>

        <InlineFieldRow>
          <InlineField label="Graph (sparkline)" labelWidth={18}>
            <Checkbox
              aria-label="Tooltip graph"
              value={tooltip.graph}
              onChange={(e) => patch({ graph: e.currentTarget.checked })}
            />
          </InlineField>
        </InlineFieldRow>

        {tooltip.graph && (
          <>
            <InlineFieldRow>
              <InlineField label="Graph type" labelWidth={14}>
                <Select<TooltipOptions['graphType']>
                  aria-label="Tooltip graph type"
                  width={20}
                  options={TOOLTIP_GRAPH_TYPE_OPTIONS}
                  value={tooltip.graphType}
                  onChange={(sel) => patch({ graphType: sel.value ?? 'line' })}
                />
              </InlineField>
              <InlineField label="Graph size" labelWidth={14}>
                <Select<TooltipOptions['graphSize']>
                  aria-label="Tooltip graph size"
                  width={20}
                  options={TOOLTIP_GRAPH_SIZE_OPTIONS}
                  value={tooltip.graphSize}
                  onChange={(sel) => patch({ graphSize: sel.value ?? '100%' })}
                />
              </InlineField>
              <InlineField label="Graph scale" labelWidth={14}>
                <Select<TooltipOptions['graphScale']>
                  aria-label="Tooltip graph scale"
                  width={20}
                  options={TOOLTIP_GRAPH_SCALE_OPTIONS}
                  value={tooltip.graphScale}
                  onChange={(sel) => patch({ graphScale: sel.value ?? 'linear' })}
                />
              </InlineField>
            </InlineFieldRow>
            <InlineFieldRow>
              <InlineField label="Graph low" labelWidth={14}>
                <Input
                  aria-label="Tooltip graph low"
                  width={16}
                  type="number"
                  value={tooltip.graphLow ?? ''}
                  placeholder="auto"
                  onChange={(e) =>
                    patch({ graphLow: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })
                  }
                />
              </InlineField>
              <InlineField label="Graph high" labelWidth={14}>
                <Input
                  aria-label="Tooltip graph high"
                  width={16}
                  type="number"
                  value={tooltip.graphHigh ?? ''}
                  placeholder="auto"
                  onChange={(e) =>
                    patch({ graphHigh: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })
                  }
                />
              </InlineField>
            </InlineFieldRow>
          </>
        )}
      </div>
    </Field>
  );
};

// --- Thresholds section ------------------------------------------------------

interface ThresholdsSectionProps {
  rule: RuleOptions;
  onPatch: (patch: Partial<RuleOptions>) => void;
}

const ThresholdsSection: React.FC<ThresholdsSectionProps> = ({ rule, onPatch }) => {
  if (rule.type === 'string') {
    return (
      <StringThresholdsEditor
        thresholds={rule.stringThresholds}
        onChange={(stringThresholds) => onPatch({ stringThresholds })}
      />
    );
  }
  if (rule.type === 'date') {
    return (
      <DateThresholdsEditor
        thresholds={rule.dateThresholds}
        onChange={(dateThresholds) => onPatch({ dateThresholds })}
      />
    );
  }
  return (
    <NumberThresholdsEditor
      thresholds={rule.numberThresholds}
      onChange={(numberThresholds) => onPatch({ numberThresholds })}
    />
  );
};

/** Reassign the `level` of each threshold to match its array position. */
function relevel<T extends { level: number }>(rows: T[]): T[] {
  return rows.map((r, i) => (r.level === i ? r : { ...r, level: i }));
}

const NumberThresholdsEditor: React.FC<{
  thresholds: NumberThreshold[];
  onChange: (next: NumberThreshold[]) => void;
}> = ({ thresholds, onChange }) => {
  const comparators = comparatorOptionsFor(NUMBER_COMPARATORS);
  return (
    <Field label="Number thresholds" description="Lowest matching level wins; rows are ordered by level.">
      <div data-testid="number-thresholds">
        {thresholds.map((t, index) => (
          <InlineFieldRow key={index} data-testid={`number-threshold-${index}`}>
            <InlineField label={`Level ${index}`} labelWidth={10}>
              <ColorPicker color={t.color} onChange={(color) => onChange(thresholds.map((r, i) => (i === index ? { ...r, color } : r)))} />
            </InlineField>
            <InlineField>
              <Select<NumberThreshold['comparator']>
                aria-label={`Number comparator ${index}`}
                width={14}
                options={comparators as Array<SelectableValue<NumberThreshold['comparator']>>}
                value={t.comparator}
                onChange={(sel) =>
                  onChange(thresholds.map((r, i) => (i === index ? { ...r, comparator: sel.value ?? 'ge' } : r)))
                }
              />
            </InlineField>
            <InlineField>
              <Input
                aria-label={`Number threshold value ${index}`}
                width={16}
                type="number"
                value={t.value}
                onChange={(e) =>
                  onChange(thresholds.map((r, i) => (i === index ? { ...r, value: Number(e.currentTarget.value) } : r)))
                }
              />
            </InlineField>
            <IconButton
              name="trash-alt"
              tooltip={`Remove threshold ${index}`}
              onClick={() => onChange(relevel(thresholds.filter((_, i) => i !== index)))}
            />
          </InlineFieldRow>
        ))}
        <Button
          variant="secondary"
          icon="plus"
          data-testid="number-threshold-add"
          onClick={() => onChange([...thresholds, createNumberThreshold(thresholds.length)])}
        >
          Add threshold
        </Button>
      </div>
    </Field>
  );
};

const StringThresholdsEditor: React.FC<{
  thresholds: StringThreshold[];
  onChange: (next: StringThreshold[]) => void;
}> = ({ thresholds, onChange }) => {
  const comparators = comparatorOptionsFor(STRING_COMPARATORS);
  return (
    <Field label="String thresholds" description="Lowest matching level wins; rows are ordered by level.">
      <div data-testid="string-thresholds">
        {thresholds.map((t, index) => (
          <InlineFieldRow key={index} data-testid={`string-threshold-${index}`}>
            <InlineField label={`Level ${index}`} labelWidth={10}>
              <ColorPicker color={t.color} onChange={(color) => onChange(thresholds.map((r, i) => (i === index ? { ...r, color } : r)))} />
            </InlineField>
            <InlineField>
              <Select<StringThreshold['comparator']>
                aria-label={`String comparator ${index}`}
                width={14}
                options={comparators as Array<SelectableValue<StringThreshold['comparator']>>}
                value={t.comparator}
                onChange={(sel) =>
                  onChange(thresholds.map((r, i) => (i === index ? { ...r, comparator: sel.value ?? 'eq' } : r)))
                }
              />
            </InlineField>
            <InlineField>
              <Input
                aria-label={`String threshold value ${index}`}
                width={16}
                value={t.value}
                placeholder="/.*/"
                onChange={(e) =>
                  onChange(thresholds.map((r, i) => (i === index ? { ...r, value: e.currentTarget.value } : r)))
                }
              />
            </InlineField>
            <IconButton
              name="trash-alt"
              tooltip={`Remove threshold ${index}`}
              onClick={() => onChange(relevel(thresholds.filter((_, i) => i !== index)))}
            />
          </InlineFieldRow>
        ))}
        <Button
          variant="secondary"
          icon="plus"
          data-testid="string-threshold-add"
          onClick={() => onChange([...thresholds, createStringThreshold(thresholds.length)])}
        >
          Add threshold
        </Button>
      </div>
    </Field>
  );
};

const DateThresholdsEditor: React.FC<{
  thresholds: DateThreshold[];
  onChange: (next: DateThreshold[]) => void;
}> = ({ thresholds, onChange }) => {
  const comparators = comparatorOptionsFor(DATE_COMPARATORS);
  return (
    <Field label="Date thresholds" description="Lowest matching level wins; rows are ordered by level.">
      <div data-testid="date-thresholds">
        {thresholds.map((t, index) => (
          <InlineFieldRow key={index} data-testid={`date-threshold-${index}`}>
            <InlineField label={`Level ${index}`} labelWidth={10}>
              <ColorPicker color={t.color} onChange={(color) => onChange(thresholds.map((r, i) => (i === index ? { ...r, color } : r)))} />
            </InlineField>
            <InlineField>
              <Select<DateThreshold['comparator']>
                aria-label={`Date comparator ${index}`}
                width={14}
                options={comparators as Array<SelectableValue<DateThreshold['comparator']>>}
                value={t.comparator}
                onChange={(sel) =>
                  onChange(thresholds.map((r, i) => (i === index ? { ...r, comparator: sel.value ?? 'ge' } : r)))
                }
              />
            </InlineField>
            <InlineField>
              <Input
                aria-label={`Date threshold value ${index}`}
                width={16}
                value={String(t.value)}
                placeholder="-1d"
                onChange={(e) =>
                  onChange(thresholds.map((r, i) => (i === index ? { ...r, value: e.currentTarget.value } : r)))
                }
              />
            </InlineField>
            <IconButton
              name="trash-alt"
              tooltip={`Remove threshold ${index}`}
              onClick={() => onChange(relevel(thresholds.filter((_, i) => i !== index)))}
            />
          </InlineFieldRow>
        ))}
        <Button
          variant="secondary"
          icon="plus"
          data-testid="date-threshold-add"
          onClick={() => onChange([...thresholds, createDateThreshold(thresholds.length)])}
        >
          Add threshold
        </Button>
      </div>
    </Field>
  );
};
