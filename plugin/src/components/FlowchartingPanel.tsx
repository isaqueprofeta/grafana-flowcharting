/**
 * FlowchartingPanel — the Panel_Component (design.md: "FlowchartingPanel
 * (Panel_Component)", Req 7.1-7.9).
 *
 * A React component that receives `PanelProps<FlowchartingOptions>` (Req 7.1),
 * holds the `@maxgraph/core` render container through a ref (Req 7.7), drives
 * the preserved Logic_Layer through the Context_Seam, and surfaces user-facing
 * messages through the `@grafana/ui` `Alert` component (Req 7.9).
 *
 * The legacy `FlowchartCtrl` registered Grafana lifecycle events
 * (`render`/`refresh`/`data-received`/`data-error`/`init-edit-mode`/
 * `panel-teardown`, plus `graph-hover`/`graph-hover-clear` and
 * `template-variable-value-updated`) in its constructor. Those map to React
 * effects per the design.md handler->effect table:
 *
 *   - mount/cleanup   -> init engine/handlers once; free + clear bus on unmount (Req 7.8)
 *   - data effect     -> `props.data` -> Data_Pipeline `adaptDataFrames` ->
 *                        emit `data_updated` -> `handler.update()`             (Req 7.3)
 *   - size effect     -> `props.width`/`props.height` -> `handler.resize(...)`  (Req 7.4)
 *   - time effect     -> `props.timeRange` -> `handler.refreshMetrics()`        (Req 7.5)
 *   - options effect  -> `props.options` -> `handler.applyOptions(...)`         (Req 7.6)
 *   - crosshair effect-> shared-crosshair subscription via the seam             (Req 4.10)
 *
 * The orchestration object this component drives is the {@link FlowchartHandler}
 * (logic/flowchartHandler.ts, Task 8.2). It owns the set of {@link Flowchart}
 * instances (render engine + states), one `RulesHandler` (rules/thresholds/
 * mappings built from the clean `RuleOptions[]`), and one `MetricHandler`
 * (DataFrame-fed metrics), wiring rule evaluation to metrics so the per-cell
 * states recolor from live data (Req 7.8). It exposes the stable entry points
 * the effects call (`update`/`resize`/`refreshMetrics`/`applyOptions`/`free`)
 * plus a bounded multi-diagram navigation API (Req 4.7). User-facing messages
 * and decode/parse/data/render failures route through the `@grafana/ui` `Alert`
 * via `gf.notify` and the per-effect try/catch (Req 7.9).
 *
 * No `$GF`, `$scope`, Angular, `grafana/app`, `globalThis`, or `mx*` coupling.
 */
import React, { useEffect, useRef, useState } from 'react';
import { PanelProps } from '@grafana/data';
import { css, cx } from '@emotion/css';
import { Alert, useStyles2, useTheme2 } from '@grafana/ui';
import { FlowchartingOptions } from '../types/options';
import { useGFContext, GFContext, PanelMessage } from './context/GFContext';
import { FlowchartHandler } from '../logic/flowchartHandler';
import { dataFramesToDataList } from '../data/dataFrameAdapter';
import type { LogicContext } from '../logic/logicContext';

interface Props extends PanelProps<FlowchartingOptions> {}

/**
 * Adapt the React {@link GFContext} into a {@link LogicContext}. The seam
 * already carries every Grafana service (`interpolate`/`notify`/`events`/
 * `getTimeRange`/`theme`/`eventBus`/`subscribeSharedCrosshair`); the ported
 * handlers additionally reach a few *logic-internal* members the legacy `$gf`
 * exposed (`setMappingCallBack`/`getFullAvailableVarNames`/`setFocus` and the
 * live `metricHandler`/`rulesHandler` cross-refs).
 *
 * `setMappingCallBack`/`setFocus` are editor-only conveniences (mapping mode,
 * DOM focus) with no effect in the render-only MVP, so they default to no-ops;
 * the Rules_Editor (Task 10) supplies concrete implementations. This keeps the
 * engine decoupled while giving Task 8.2 a single, typed place to enrich.
 */
function toLogicContext(gf: GFContext): LogicContext {
  return {
    ...gf,
    setMappingCallBack: () => {
      /* no-op in render-only MVP; wired by the Rules_Editor (Task 10). */
    },
    getFullAvailableVarNames: () => gf.getGrafanaVarNames(),
    setFocus: () => {
      /* no-op in render-only MVP; editor-only convenience. */
    },
  };
}

const getStyles = () => {
  return {
    wrapper: css`
      position: relative;
      overflow: hidden;
    `,
    container: css`
      width: 100%;
      height: 100%;
    `,
  };
};

export function FlowchartingPanel(props: Props) {
  const { width, height, data, timeRange, options } = props;
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const [message, setMessage] = useState<PanelMessage | null>(null);

  // Render container held through a ref (Req 7.7).
  const containerRef = useRef<HTMLDivElement>(null);
  // The FlowchartHandler orchestrator (owns flowcharts/rules/metrics, Task 8.2).
  const handlerRef = useRef<FlowchartHandler | null>(null);

  // Context_Seam built from the live props/theme/message setter.
  const gf = useGFContext(props, theme, setMessage);

  // Mount: init the FlowchartHandler (metrics + rules + flowcharts) once;
  // release all resources on unmount (Req 7.8).
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const lc = toLogicContext(gf);
    try {
      handlerRef.current = FlowchartHandler.create(lc, containerRef.current, options);
    } catch (e) {
      setMessage({ severity: 'error', text: String(e) });
    }
    return () => {
      handlerRef.current?.free();
      handlerRef.current = null;
      gf.events.clear();
    };
    // Mount-once: the handler is seeded with the initial options; later option
    // changes flow through the options effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data effect (Req 7.3): run the Data_Pipeline and emit `data_updated` so the
  // handler's owned MetricHandler refreshes metrics; rule evaluation then
  // recolors the cells via the per-cell states (Req 7.8).
  useEffect(() => {
    if (!handlerRef.current) {
      return;
    }
    try {
      const dataList = dataFramesToDataList(data);
      gf.events.emit('data_updated', dataList);
      handlerRef.current.update();
      gf.clearNotify();
    } catch (e) {
      setMessage({ severity: 'error', text: String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Size effect (Req 7.4): resize the render engine.
  useEffect(() => {
    try {
      handlerRef.current?.resize(width, height);
    } catch (e) {
      setMessage({ severity: 'error', text: String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // Time effect (Req 7.5): refresh metrics for the new time range.
  useEffect(() => {
    try {
      handlerRef.current?.refreshMetrics();
    } catch (e) {
      setMessage({ severity: 'error', text: String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange]);

  // Options effect (Req 7.6): rebuild rules/flowcharts from new options.
  useEffect(() => {
    try {
      handlerRef.current?.applyOptions(options);
    } catch (e) {
      setMessage({ severity: 'error', text: String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  // Shared-crosshair subscription (Req 4.10): drive hover via the seam lookup.
  useEffect(() => {
    return gf.subscribeSharedCrosshair((ts) => {
      try {
        handlerRef.current?.refreshMetrics(ts);
      } catch (e) {
        setMessage({ severity: 'error', text: String(e) });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gf]);

  return (
    <div
      className={cx(
        styles.wrapper,
        css`
          width: ${width}px;
          height: ${height}px;
        `
      )}
    >
      {message && (
        <Alert severity={message.severity} title={message.text} onRemove={() => setMessage(null)} />
      )}
      <div ref={containerRef} className={styles.container} data-testid="flowcharting-panel-content" />
    </div>
  );
}
