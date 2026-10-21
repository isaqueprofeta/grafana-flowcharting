/**
 * E2E: the FlowCharting panel renders a diagram (Task 13.2, Req 11.2).
 *
 * Navigates to the provisioned `flowcharting-demo` dashboard (Demo_Stack) and
 * asserts the Panel_Component mounts its `@maxgraph/core` render container and
 * that the container holds actual rendered diagram geometry — the engine draws
 * vertices as SVG inside the container, so the presence of `<svg>` with child
 * shape nodes (rect/path/ellipse) is the observable proof of a rendered
 * diagram rather than an empty mount point.
 *
 * Runs against a live Grafana (the committed Demo_Stack). See
 * `playwright.config.ts` for the `docker compose up` + `npm run e2e` flow.
 */
import { test, expect } from '@grafana/plugin-e2e';

// uid of the provisioned demo dashboard (provisioning/dashboards/flowcharting-demo.json).
const DASHBOARD_UID = 'flowcharting-demo';

// data-testid attributes emitted by FlowchartingPanel.tsx.
const PANEL_CONTENT = 'flowcharting-panel-content';
const EDIT_DIAGRAM = 'flowcharting-edit-diagram';

test.describe('FlowCharting panel rendering (Req 11.2)', () => {
  test('renders the maxGraph diagram container with rendered SVG shapes', async ({
    gotoDashboardPage,
    page,
  }) => {
    await gotoDashboardPage({ uid: DASHBOARD_UID });

    // The panel mounts its render container (Req 7.7).
    const container = page.getByTestId(PANEL_CONTENT).first();
    await expect(container).toBeVisible();

    // maxGraph renders the diagram as an <svg> inside the container (Req 2.4).
    const svg = container.locator('svg').first();
    await expect(svg).toBeVisible({ timeout: 15_000 });

    // The provisioned "Infrastructure" flowchart has web/app/db vertices plus
    // two edges, so the rendered SVG must carry actual shape geometry rather
    // than being an empty canvas. Shapes render as rect/path/ellipse nodes.
    const shapes = svg.locator('rect, path, ellipse');
    await expect
      .poll(async () => shapes.count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test('exposes the Edit diagram action when draw.io authoring is allowed', async ({
    gotoDashboardPage,
    page,
  }) => {
    await gotoDashboardPage({ uid: DASHBOARD_UID });

    // The demo dashboard sets editor.allowDrawio = true, so the authoring
    // button is shown (Req 6.1 seam, FlowchartingPanel.tsx toolbar).
    await expect(page.getByTestId(EDIT_DIAGRAM).first()).toBeVisible({ timeout: 15_000 });
  });
});
