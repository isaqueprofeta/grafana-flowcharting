# FlowCharting end-to-end tests (Playwright)

Playwright + [`@grafana/plugin-e2e`](https://grafana.com/developers/plugin-tools/e2e-test-a-plugin/)
specs that verify the panel against a **live Grafana** — the committed Demo_Stack
(Grafana 11.3 + Prometheus + the synthetic metrics generator).

- `render.spec.ts` — the panel renders a maxGraph diagram (the render container
  holds an `<svg>` with actual shape geometry), and the "Edit diagram" action
  shows when draw.io authoring is enabled. _(Req 11.2)_
- `coloring.spec.ts` — the web/app/db cells carry rule/threshold colors driven by
  the Prometheus metrics, distinct from the static authoring palette. _(Req 11.3)_

## Running against the Demo_Stack

The e2e suite needs a running Grafana with the built plugin loaded:

```bash
# 1. Build the plugin into ./dist (docker-compose.yaml mounts ./dist).
npm run build

# 2. Bring up Grafana 11.3 + Prometheus + the metrics generator.
docker compose up --build        # or: npm run server

# 3. In another shell, install the Playwright browsers once, then run the suite.
npx playwright install chromium
npm run e2e                      # playwright test   (http://localhost:3000)
# npm run e2e:ui                 # interactive UI mode
```

The Grafana base URL is read from `GRAFANA_URL` (default `http://localhost:3000`),
so the same specs run locally and in CI. The `auth` project logs in once (admin/admin,
as configured in `docker-compose.yaml`) and stores the session under
`playwright/.auth/` for the test projects to reuse.

## What runs without the live stack

- `npm run typecheck` (root) stays green — the e2e specs are excluded from the
  app typecheck and have their own `tests/tsconfig.json`.
- `npx tsc --noEmit -p tests/tsconfig.json` typechecks the specs + config.
- `npx playwright test --list` enumerates the specs (parses config + specs).

Actually executing the specs requires the live Demo_Stack and installed
Playwright browsers.
