# Changelog

## 1.0.0

Full migration of `agenty-flowcharting-panel` from AngularJS to React, targeting Grafana 11.x.

- Rebuilt as a React `PanelPlugin` (`FlowchartingPanel`) using `PanelProps` and the React
  component lifecycle, replacing the legacy `MetricsPanelCtrl` AngularJS panel.
- Target Grafana **11.x**; `plugin.json` version cleaned to `1.0.0` and
  `grafanaDependency`/`grafanaVersion` set for 11.x.
- Replaced the `eval`-loaded draw.io/mxGraph global bundle with the ESM/TypeScript
  [`@maxgraph/core`](https://github.com/maxGraph/maxGraph) rendering engine — no `eval`,
  no global namespace mutation.
- Removed gulp and `@grafana/toolkit` from the build toolchain in favor of the
  `@grafana/create-plugin` scaffold (webpack build, Jest tests).
- Reworked the data path onto the Grafana `DataFrame` pipeline, consuming `props.data.series`
  and formatting with `@grafana/data` (`getValueFormat`, `dateTime`); dropped the legacy
  `grafana_func` module.
- Redesigned the options editors and the bespoke rules editor as React components, with an
  exported TypeScript options schema free of the `gf.*` ambient namespace.
- Preserved the framework-agnostic logic layer and `GFEvents` bus, wired to Grafana services
  through a React Context seam.
- Added a reproducible Docker demo stack (Grafana 11.x, Prometheus, synthetic metrics
  generator, provisioned datasources/dashboards) and Playwright end-to-end tests.
