# FlowCharting (agenty-flowcharting-panel)

FlowCharting is a Grafana panel plugin that displays complex diagrams whose shapes are
colored, labeled, and animated from live metric data. Author diagrams with
[draw.io](https://www.drawio.com/) / mxGraph XML, bind metrics to cells with rules,
thresholds, and value/range maps, and watch the diagram react to your dashboard data.

This is the React rewrite of the plugin, targeting **Grafana 11.x**. It replaces the
legacy AngularJS implementation (`MetricsPanelCtrl`, `@grafana/toolkit`, gulp, and the
`eval`-loaded draw.io/mxGraph global bundle) with a React `PanelPlugin` and the
ESM/TypeScript [`@maxgraph/core`](https://github.com/maxGraph/maxGraph) rendering engine.

## Compatibility

- Grafana **11.x** (`plugin.json` declares `grafanaDependency: ">=11.0.0"`, `grafanaVersion: "11.x"`).
- Node.js **>= 20** for the build toolchain.

## Development

```bash
npm install
npm run dev        # watch build into dist/ (development mode)
npm run build      # production build into dist/
npm run test:ci    # run the unit test suite (Jest)
npm run e2e        # run the Playwright end-to-end tests
```

## Demo stack

A Docker Compose stack (Grafana 11.x, Prometheus, a synthetic metrics generator, and
provisioned datasources/dashboards) is included for local development and manual
verification. It mounts the built plugin in development mode so it loads **unsigned**.

```bash
npm run build      # build the plugin first so dist/ exists
docker compose up  # or: npm run server
```

Then open Grafana (http://localhost:3000) and the provisioned FlowCharting dashboard,
where diagram cells change color as the generated metrics cross their thresholds.

## Build → sign → package → release

1. **Build** the production artifacts:

   ```bash
   npm run build
   ```

   This produces a `dist/` directory ready to be signed and packaged.

2. **Sign** the plugin. Signing requires a Grafana Cloud Access Policy token with the
   `plugins:write` scope. Export it as `GRAFANA_ACCESS_POLICY_TOKEN` (never commit the
   token) and run:

   ```bash
   export GRAFANA_ACCESS_POLICY_TOKEN=<your-access-policy-token>
   npm run sign
   ```

   In the Docker demo / development mode the plugin runs unsigned, so signing is only
   needed for distribution.

3. **Package** the signed `dist/` into a distributable archive.

4. **Release** via the GitHub workflow, which builds, signs, packages, and publishes the
   plugin artifacts.

## Plugin metadata

Metadata in `src/plugin.json` is carried over from the legacy plugin: id
`agenty-flowcharting-panel`, name `FlowCharting`, the Arnaud GENTY author block,
keywords, the four `info.links`, and the SVG logos. The Grafana dependency is set to
`11.x` and the version uses clean semver matching `package.json`.
