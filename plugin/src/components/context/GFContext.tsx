/**
 * GFContext — the Context_Seam (design.md: "Context_Seam (GFContext)", Req 8.3, 8.4).
 *
 * This is the single typed boundary that supplies the Grafana services the
 * preserved Logic_Layer used to reach through the Angular-coupled `$GF` object
 * (`$GF.create($scope, templateSrv, dashboard, ctrl)`). The legacy `$GF`
 * captured `$scope`, `templateSrv`, `dashboard`, and `ctrl` and exposed
 * `notify`/`clearNotify`, `resolveVars`/`getGrafanaVars` (via
 * `templateSrv.replace`/`templateSrv.variables`), `getTheme`, and the `GFEvents`
 * bus. The seam re-expresses exactly those capabilities over Grafana 11 React
 * APIs so the Logic_Layer stays framework-agnostic (Req 8.4) while all
 * Grafana-version-specific access is funneled through this one interface.
 *
 * Mapping from the legacy `$GF` surface:
 *   $GF.notify / $GF.clearNotify  -> notify / clearNotify   (drive an Alert state,
 *                                                             replacing the GFMessage DOM span)
 *   $GF.resolveVars               -> interpolate            (getTemplateSrv().replace)
 *   $GF.getGrafanaVars            -> getGrafanaVarNames      (templateSrv.getVariables map walk)
 *   dashboard time access         -> getTimeRange
 *   $GF.getTheme                  -> theme                  (GrafanaTheme2)
 *   appEvents + dashboard.events  -> eventBus + subscribeSharedCrosshair
 *   $GF.events (GFEvents bus)     -> events                 (preserved, Task 4.1)
 */
import React, { createContext, useContext, useMemo } from 'react';
import {
  EventBus,
  GrafanaTheme2,
  PanelProps,
  ScopedVars,
  TimeRange,
  DataHoverEvent,
  DataHoverClearEvent,
  LegacyGraphHoverEvent,
} from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';

// GFEvents bus and global signal set are preserved from Task 4.1's ported
// `logic/flowchartingBase`. If that module is not yet present at type-check
// time, this import is the documented dependency to resolve (design.md:
// Logic_Layer "as-is", Req 8.1).
import { GFEvents, GlobalSignals, GLOBAL_SIGNALS } from '../../logic/flowchartingBase';

/** Severity levels supported by the Alert-backed messaging surface (Req 7.9). */
export type GFNotifySeverity = 'info' | 'warning' | 'error';

/** The message state the panel renders through `@grafana/ui` `Alert`. */
export interface PanelMessage {
  severity: GFNotifySeverity;
  text: string;
}

/**
 * The Context_Seam contract (design.md TypeScript interface, Req 8.3). Every
 * Grafana service the Logic_Layer needs is exposed here and nowhere else.
 */
export interface GFContext {
  // Messaging — replaces ctrl.notify / GFMessage (Req 7.9).
  notify(message: string, severity?: GFNotifySeverity): void;
  clearNotify(): void;
  // Template-variable interpolation — replaces templateSrv.replace + getGrafanaVars.
  interpolate(text: string, scopedVars?: ScopedVars): string; // getTemplateSrv().replace
  getGrafanaVarNames(): string[];
  // Time range — replaces dashboard time access.
  getTimeRange(): TimeRange;
  // Theme — replaces $GF.getTheme().
  theme: GrafanaTheme2;
  // Shared crosshair / cross-panel events — replaces appEvents + dashboard.events.
  eventBus: EventBus;
  subscribeSharedCrosshair(cb: (timestampMs: number) => void): () => void;
  // Preserved portable bus (Req 8.1).
  events: GFEvents<GlobalSignals>;
}

/**
 * Pull the hover timestamp out of a shared-crosshair / graph-hover payload.
 * The legacy `_on_grafana_graph_hover` read `event.pos.x` (epoch ms); the
 * React events carry the same instant as `payload.point.time`, with the
 * legacy `pos.x` preserved on `LegacyGraphHoverEvent`.
 */
function extractHoverTimestamp(payload: {
  point?: Record<string, number | null>;
  pos?: { x?: number };
}): number | undefined {
  const time = payload.point?.time;
  if (typeof time === 'number') {
    return time;
  }
  const posX = payload.pos?.x;
  if (typeof posX === 'number') {
    return posX;
  }
  return undefined;
}

/**
 * Build a `GFContext` from the live panel props, the current theme, and a
 * message setter. This is the concrete implementation the React layer injects;
 * the Logic_Layer consumes only the `GFContext` interface above.
 *
 * @param props      the panel props (source of `eventBus` and `timeRange`)
 * @param theme      the resolved `GrafanaTheme2` (from `useTheme2()`)
 * @param setMessage drives the Alert message state (null clears it)
 * @param events     the preserved GFEvents bus; a fresh one is created if omitted
 */
export function createGFContext(
  props: Pick<PanelProps, 'eventBus' | 'timeRange'>,
  theme: GrafanaTheme2,
  setMessage: (message: PanelMessage | null) => void,
  events: GFEvents<GlobalSignals> = GFEvents.create<GlobalSignals>(GLOBAL_SIGNALS)
): GFContext {
  return {
    notify(message: string, severity: GFNotifySeverity = 'info') {
      setMessage({ severity, text: message });
    },
    clearNotify() {
      setMessage(null);
    },
    interpolate(text: string, scopedVars?: ScopedVars): string {
      return getTemplateSrv().replace(text, scopedVars);
    },
    getGrafanaVarNames(): string[] {
      // Replaces the legacy `_.map(templateSrv.variables, v => `${'${'}${v.name}}`)`.
      return getTemplateSrv()
        .getVariables()
        .map((variable) => `\${${variable.name}}`);
    },
    getTimeRange(): TimeRange {
      return props.timeRange;
    },
    theme,
    eventBus: props.eventBus,
    subscribeSharedCrosshair(cb: (timestampMs: number) => void): () => void {
      // Subscribe to both the modern hover event and the legacy graph-hover
      // event so shared crosshair works across panel generations (Req 4.10).
      const hover = props.eventBus
        .getStream(DataHoverEvent)
        .subscribe((event) => {
          const ts = extractHoverTimestamp(event.payload);
          if (ts !== undefined) {
            cb(ts);
          }
        });
      const legacyHover = props.eventBus
        .getStream(LegacyGraphHoverEvent)
        .subscribe((event) => {
          const ts = extractHoverTimestamp(event.payload);
          if (ts !== undefined) {
            cb(ts);
          }
        });
      // Clearing a crosshair carries no timestamp; the Logic_Layer treats a
      // missing value as "no hover", so the clear stream is subscribed only to
      // keep the unsubscribe contract symmetric.
      const clear = props.eventBus.getStream(DataHoverClearEvent).subscribe(() => {
        /* no-op: hover target cleared */
      });
      return () => {
        hover.unsubscribe();
        legacyHover.unsubscribe();
        clear.unsubscribe();
      };
    },
    events,
  };
}

/**
 * React context carrier for the seam. Defaults to `null`; consumers must be
 * rendered inside a provider (or use `useGFContext`, which builds one).
 */
const GFContextReact = createContext<GFContext | null>(null);

/** Provider that makes a concrete `GFContext` available to descendants. */
export function GFContextProvider({
  value,
  children,
}: {
  value: GFContext;
  children: React.ReactNode;
}) {
  return <GFContextReact.Provider value={value}>{children}</GFContextReact.Provider>;
}

/**
 * Read the `GFContext` from the nearest provider. Throws when used outside a
 * provider so a misconfigured tree fails loudly rather than silently passing a
 * null seam into the Logic_Layer.
 */
export function useGFContextValue(): GFContext {
  const ctx = useContext(GFContextReact);
  if (ctx === null) {
    throw new Error('useGFContextValue must be used within a GFContextProvider');
  }
  return ctx;
}

/**
 * Hook used by `FlowchartingPanel` to build a memoized `GFContext` from the
 * current props, theme, and message setter (design.md: `useGFContext(props,
 * theme, setMessage)`). The preserved `events` bus is created once per panel
 * instance and reused across renders so subscriptions survive re-renders.
 */
export function useGFContext(
  props: Pick<PanelProps, 'eventBus' | 'timeRange'>,
  theme: GrafanaTheme2,
  setMessage: (message: PanelMessage | null) => void
): GFContext {
  // Keep a single GFEvents bus for the lifetime of the panel instance.
  const events = useMemo(() => GFEvents.create<GlobalSignals>(GLOBAL_SIGNALS), []);
  return useMemo(
    () => createGFContext(props, theme, setMessage, events),
    [props.eventBus, props.timeRange, theme, setMessage, events]
  );
}
