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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PanelProps } from '@grafana/data';
import { css, cx } from '@emotion/css';
import { Alert, Button, useStyles2, useTheme2 } from '@grafana/ui';
import { FlowchartingOptions } from '../types/options';
import { useGFContext, GFContext, PanelMessage } from './context/GFContext';
import { FlowchartHandler } from '../logic/flowchartHandler';
import { dataFramesToDataList } from '../data/dataFrameAdapter';
import { DrawioEditor } from '../drawio/DrawioEditor';
import type { LogicContext } from '../logic/logicContext';

interface Props extends PanelProps<FlowchartingOptions> {}

/**
 * Pure helper (Req 6.4): return a new {@link FlowchartingOptions} with the
 * Diagram_XML of the flowchart at `activeIndex` replaced by `xml`. All other
 * flowcharts and the top-level options are preserved by identity-free copy so
 * the options effect (keyed on `props.options`) observes a changed reference
 * and re-renders (Req 6.5).
 *
 * When `activeIndex` is out of range (e.g. no flowcharts configured) the
 * options are returned unchanged — there is nothing to write into.
 *
 * Exported so the save path can be unit-tested without a draw.io window.
 */
export function writeSavedXml(
  options: FlowchartingOptions,
  activeIndex: number,
  xml: string
): FlowchartingOptions {
  const flowcharts = options.flowcharts ?? [];
  if (activeIndex < 0 || activeIndex >= flowcharts.length) {
    return options;
  }
  return {
    ...options,
    flowcharts: flowcharts.map((fc, i) => (i === activeIndex ? { ...fc, xml } : fc)),
  };
}

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
    toolbar: css`
      position: absolute;
      top: 4px;
      right: 4px;
      z-index: 1;
    `,
  };
};

export function FlowchartingPanel(props: Props) {
  const { id, width, height, data, timeRange, options, onOptionsChange } = props;
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const [message, setMessage] = useState<PanelMessage | null>(null);

  // Render container held through a ref (Req 7.7).
  const containerRef = useRef<HTMLDivElement>(null);
  // The FlowchartHandler orchestrator (owns flowcharts/rules/metrics, Task 8.2).
  const handlerRef = useRef<FlowchartHandler | null>(null);
  // The open draw.io editor session, if any (Task 12.2). Held through a ref so
  // the unmount cleanup can close it (detaching its message listener).
  const editorRef = useRef<DrawioEditor | null>(null);

  // Keep the latest options available to the (stable) save callback without
  // re-subscribing the editor's message listener on every options change.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Context_Seam built from the live props/theme/message setter.
  const gf = useGFContext(props, theme, setMessage);

  // Save handler (Req 6.4, 6.5): write the saved Diagram_XML into the active
  // flowchart's options via `onOptionsChange`. Reading `options` from the ref
  // keeps this callback stable while always writing into the current options;
  // the resulting new reference drives the options effect -> re-render (Req 6.5).
  const handleSave = useCallback(
    (xml: string) => {
      const current = optionsRef.current;
      const activeIndex = handlerRef.current?.getCurrentIndex() ?? 0;
      const next = writeSavedXml(current, activeIndex, xml);
      if (next !== current) {
        onOptionsChange(next);
      }
    },
    [onOptionsChange]
  );

  // Open the draw.io editor for the active flowchart (Req 6.1 seam). Closes any
  // previously-open session first, then seeds the editor with the active
  // flowchart's current XML and the configured editor URL/theme.
  const openEditor = useCallback(() => {
    editorRef.current?.close();
    const current = optionsRef.current;
    const activeIndex = handlerRef.current?.getCurrentIndex() ?? 0;
    const flowchart = (current.flowcharts ?? [])[activeIndex];
    const editor = new DrawioEditor(
      {
        uid: String(id),
        xml: flowchart?.xml ?? '',
        editorUrl: current.editor?.editorUrl,
        editorTheme: current.editor?.editorTheme,
      },
      {
        onSave: handleSave,
        onExit: () => {
          editorRef.current = null;
        },
      }
    );
    editorRef.current = editor;
    editor.open();
  }, [id, handleSave]);

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
      // Close any open draw.io editor so its message listener is detached (Req 7.8).
      editorRef.current?.close();
      editorRef.current = null;
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
    const handler = handlerRef.current;
    if (!handler) {
      return;
    }
    try {
      const dataList = dataFramesToDataList(data);
      gf.events.emit('data_updated', dataList);
      // The graph build (and thus the per-cell states) is async, so on the
      // first data effect the states may not exist yet. Await the handler's
      // readiness, then rebind metrics + refresh states so the first paint is
      // colored from live data; `update()` is also called synchronously so
      // later data ticks (states already built) recolor without the await.
      handler.update();
      void handler.whenReady();
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
      {options.editor?.allowDrawio && (
        <div className={styles.toolbar}>
          <Button
            size="sm"
            variant="secondary"
            icon="pen"
            onClick={openEditor}
            data-testid="flowcharting-edit-diagram"
          >
            Edit diagram
          </Button>
        </div>
      )}
      <div ref={containerRef} className={styles.container} data-testid="flowcharting-panel-content" />
    </div>
  );
}
