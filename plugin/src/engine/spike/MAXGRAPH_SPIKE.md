# maxGraph Rendering Parity SPIKE — Go/No-Go Decision

**Feature:** angular-to-react-migration
**Task:** 3 — maxGraph rendering parity SPIKE (**RISK GATE**)
**Requirements exercised:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
**Status:** ✅ **GO**

---

## Decision

**GO.** `@maxgraph/core@0.25.0` renders a representative draw.io / mxGraph diagram
as an ESM/TypeScript import, with **no `eval`** and **no global namespace
mutation**, and preserves the diagram fidelity that the migration depends on
(vertices, edges, connectivity, labels, geometry, and styles). The pako codec
round-trips mxGraph XML identically to the Legacy_Engine pipeline.

Full feature work (Tasks 4-14) is cleared to proceed. The vendored-bundle
fallback (NFR Rendering Parity 2) is **not** triggered.

---

## What was built

| Artifact | Purpose |
| --- | --- |
| `engine/diagramCodec.ts` | Pure-function port of the legacy `drawio_base.ts` codec: `decode`, `encode`, `isEncoded`, `isValidXml`. No module state, no globals, no `eval`. |
| `engine/diagramCodec.test.ts` | **Property 1** round-trip (200 runs) + example anchors. |
| `engine/spike/renderSpike.ts` | Throwaway harness: `renderDiagram(container, xml)` via `new Graph(container)` + `ModelXmlSerializer` inside `model.batchUpdate`; `inspectModel` for structural assertions; `SAMPLE_INFRA_TOPOLOGY_XML`. |
| `engine/spike/renderSpike.test.ts` | Model-structure parity assertions (jsdom). |
| `engine/spike/SpikePanel.tsx` | Minimal throwaway React component: mounts a container via ref, renders the sample via maxGraph on an effect, tears down (`graph.destroy()`) on unmount. |
| `engine/spike/SpikePanel.test.tsx` | Asserts the diagram renders statically inside a React container and unmounts cleanly. |

All spike code under `engine/spike/` is disposable; the production engine lands
in `engine/XGraph.ts` (Task 7) and the production panel in
`components/FlowchartingPanel.tsx` (Task 8).

---

## Codec port (Requirements 2.5, 2.6)

The encode/decode pipeline mirrors the Legacy_Engine (`src/drawio_base.ts`) exactly:

- **decode:** unwrap `<mxfile><diagram>` → base64 → `pako.inflateRaw` → `decodeURIComponent`.
- **encode:** `encodeURIComponent` → `pako.deflateRaw` → base64.

Differences from legacy, all behavior-preserving:

- Base64 is cross-environment: prefers DOM `atob`/`btoa`, falls back to Node
  `Buffer` (legacy used `Buffer` directly). The legacy `spec/pako.test.ts`
  already asserts `atob` and `Buffer` agree, so this is safe.
- `isValidXml` is now engine-free: it parses the XML with `DOMParser` and checks
  for a `parsererror`/`mxGraphModel`/`mxfile` root instead of spinning up a
  throwaway `Graph` + `mxCodec`. Pure and faster; same accept/reject outcome for
  valid vs. garbage input.
- `encode` chunks `String.fromCharCode.apply` (0x8000 window) to avoid
  call-stack overflow on large diagrams — a robustness fix over legacy's single
  `apply`.

**Property 1 (encode/decode round-trip)** — `decode(encode(xml)) === xml` — holds
for 200 generated mxGraph XML payloads **and** 200 arbitrary full-unicode strings
(≥100 iterations each, as required).

---

## Rendering parity (Requirements 2.1, 2.2, 2.3, 2.4)

Sample: a web → app → db infra topology (`SAMPLE_INFRA_TOPOLOGY_XML`) — 3 vertices
(including a `shape=cylinder` db), 2 labeled orthogonal edges, explicit geometry,
and fill-color styles.

Verified via the maxGraph model after decode (jsdom):

| Parity dimension | Legacy_Engine | @maxgraph/core 0.25 | Result |
| --- | --- | --- | --- |
| ESM import, no `eval` | `eval`-loaded global bundle | `import { Graph, ModelXmlSerializer } from '@maxgraph/core'` | ✅ no `eval` |
| No global mutation | mutates `globalThis.mx*`, `BASE_PATH`, etc. | instance-scoped `new Graph(container)` only | ✅ no globals |
| Vertex count | 3 | 3 | ✅ |
| Edge count | 2 | 2 | ✅ |
| Edge connectivity | web→app, app→db | web→app, app→db | ✅ |
| Labels | web/app/db/http/sql | web/app/db/http/sql | ✅ |
| Geometry (pos/size) | x/y/w/h preserved | x/y/w/h preserved | ✅ |
| Styles (fill, shape) | `fillColor`, `shape=cylinder` | preserved (via `ModelXmlSerializer`) | ✅ |
| Encoded-diagram render | decode → render | decode → render | ✅ |
| Static render in React container | n/a (Angular) | mounts + tears down cleanly | ✅ |

---

## Gaps & follow-ups (none blocking)

1. **XML ingestion API renamed.** Legacy used `mxCodec` + `beginUpdate/endUpdate`.
   maxGraph 0.25 uses `ModelXmlSerializer.import` inside `model.batchUpdate`.
   Equivalent; captured in the spike so Task 7's `XGraph` adopts it directly.
2. **CellStyle shape changed.** maxGraph 0.25 can expose style as a `CellStyle`
   object rather than a legacy `key=value;` string. The spike normalizes both
   (`styleToString`). The `MXGRAPH_STYLES*` get/set port in Task 7 must account
   for the object form.
3. **Visual (pixel) parity is not screenshot-verified in CI.** jsdom has no
   layout engine, so parity is asserted at the **model-structure** level
   (counts, connectivity, labels, geometry, styles). Pixel-level visual
   confirmation is deferred to the Demo_Stack + Playwright e2e (Tasks 9/13) once
   the production panel renders in a real browser. This is the one item that
   remains to confirm manually/visually; it does not affect the GO decision
   because the structural fidelity that drives data-coloring, tooltips, and
   navigation is fully preserved.
4. **Stencils / custom shapes / draw.io `drawio_custom` behaviors** (CSV import,
   custom fonts, click handlers, zoom/pan/animation/highlight) are **out of
   scope** for this gate and land in `engine/drawioCustom.ts` (Task 7). The
   sample deliberately uses a built-in `cylinder` shape; exotic draw.io stencils
   will be validated incrementally during Task 7.

---

## Fallback evaluation (NFR Rendering Parity 2)

The vendored draw.io/mxGraph bundle fallback would re-introduce `eval` and global
mutation and is therefore the undesirable path. Because the acceptance bar is met
(ESM, no `eval`, no globals, structural fidelity preserved, codec round-trips),
**the fallback is not invoked.** It remains available if Task 7 surfaces a
blocking stencil/shape gap in a real browser.

---

## Verification results

- `npm run build` (webpack production) — **success**.
- `npm run typecheck` (`tsc --noEmit`) — **clean**.
- `npm run test:ci` (jest) — **15/15 passing** across codec, spike model, spike
  component, and module tests.
- Property 1 round-trip — **passing at 200 iterations** per property (≥100 required).
- Static render — validated in jsdom at the model-structure + React
  mount/unmount level. Pixel/visual confirmation deferred to Demo_Stack +
  Playwright (Tasks 9/13).
