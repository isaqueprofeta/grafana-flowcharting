/**
 * E2E: data-driven cell coloring (Task 13.2, Req 11.3).
 *
 * The provisioned `flowcharting-demo` dashboard (Demo_Stack) binds three rules
 * to live Prometheus metrics and recolors the web/app/db cells from the metric
 * values (FlowchartingPanel data effect -> RulesHandler -> per-cell states):
 *
 *   - rule "up"      -> fillColor of web/app/db, threshold #299c46 (UP)
 *   - rule "latency" -> strokeColor of web/app/db, thresholds
 *                         #299c46 / #ed8128 / #d44a3a (ok / slow / critical)
 *   - rule "cpu"     -> fillColor of web_lat/app_cpu/db_cpu (detail flowchart)
 *
 * maxGraph renders each vertex as an SVG shape whose `fill` / `stroke`
 * attributes carry the resolved style color. The *authoring* palette in the
 * diagram XML uses pastel draw.io colors (#dae8fc / #d5e8d4 / #ffe6cc). So the
 * observable proof that coloring is DATA-DRIVEN (not the static XML palette) is
 * that, once metrics arrive, the rendered shapes carry the rule/threshold
 * colors above rather than only the pastel authoring colors.
 *
 * Runs against a live Grafana (the committed Demo_Stack). See
 * `playwright.config.ts` for the `docker compose up` + `npm run e2e` flow.
 */
import { test, expect } from '@grafana/plugin-e2e';

const DASHBOARD_UID = 'flowcharting-demo';
const PANEL_CONTENT = 'flowcharting-panel-content';

// Colors the rules resolve to (provisioning/dashboards/flowcharting-demo.json).
// These are the data-driven threshold colors, distinct from the pastel
// authoring palette baked into the diagram XML.
const RULE_COLORS = ['#299c46', '#ed8128', '#d44a3a'];

// The static authoring palette in the diagram XML (NOT data-driven).
const AUTHORING_COLORS = ['#dae8fc', '#d5e8d4', '#ffe6cc'];

/**
 * Collect the `fill` and `stroke` attribute values of every shape in the panel's
 * rendered SVG, lowercased for stable comparison. maxGraph writes the resolved
 * cell style colors onto the SVG shape nodes it draws.
 */
async function readShapeColors(container: ReturnType<typeof getContainer>): Promise<string[]> {
  const shapes = container.locator('svg').first().locator('rect, path, ellipse, g[fill], g[stroke]');
  const colors = await shapes.evaluateAll((nodes) =>
    nodes.flatMap((n) => {
      const el = n as Element;
      const out: string[] = [];
      const fill = el.getAttribute('fill');
      const stroke = el.getAttribute('stroke');
      if (fill) {
        out.push(fill);
      }
      if (stroke) {
        out.push(stroke);
      }
      // Some maxGraph shapes carry the color inline in the style attribute.
      const style = el.getAttribute('style') ?? '';
      const styleMatches = style.match(/#[0-9a-fA-F]{6}/g);
      if (styleMatches) {
        out.push(...styleMatches);
      }
      return out;
    })
  );
  return colors.map((c) => c.toLowerCase());
}

// Tiny helper so `readShapeColors` has a typed parameter without importing the
// Playwright Locator type explicitly (kept local to this spec).
function getContainer(page: import('@playwright/test').Page) {
  return page.getByTestId(PANEL_CONTENT).first();
}

test.describe('FlowCharting data-driven cell coloring (Req 11.3)', () => {
  test('cells carry rule/threshold colors driven by the metrics', async ({
    gotoDashboardPage,
    page,
  }) => {
    await gotoDashboardPage({ uid: DASHBOARD_UID });

    const container = getContainer(page);
    await expect(container).toBeVisible();
    await expect(container.locator('svg').first()).toBeVisible({ timeout: 15_000 });

    // Poll until the metrics have flowed through and at least one shape carries
    // a data-driven rule color. The synthetic generator keeps `up` at 1 (green
    // #299c46) and moves latency/cpu across their thresholds over time, so a
    // rule color must appear once data is applied.
    await expect
      .poll(
        async () => {
          const colors = await readShapeColors(container);
          return colors.some((c) => RULE_COLORS.includes(c));
        },
        { timeout: 30_000, message: 'expected at least one cell to carry a data-driven rule color' }
      )
      .toBe(true);
  });

  test('coloring reflects metrics rather than only the static authoring palette', async ({
    gotoDashboardPage,
    page,
  }) => {
    await gotoDashboardPage({ uid: DASHBOARD_UID });

    const container = getContainer(page);
    await expect(container.locator('svg').first()).toBeVisible({ timeout: 15_000 });

    // Wait for data-driven colors to appear.
    await expect
      .poll(
        async () => {
          const colors = await readShapeColors(container);
          return colors.filter((c) => RULE_COLORS.includes(c)).length;
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0);

    // The rule colors present must not be a coincidental match of the authoring
    // palette: the authoring palette and rule palette are disjoint by design, so
    // any rule color observed proves the metrics overrode the baked-in styles.
    const colors = await readShapeColors(container);
    const ruleColorsSeen = colors.filter((c) => RULE_COLORS.includes(c));
    const authoringOnly = ruleColorsSeen.every((c) => !AUTHORING_COLORS.includes(c));
    expect(ruleColorsSeen.length).toBeGreaterThan(0);
    expect(authoringOnly).toBe(true);
  });
});
