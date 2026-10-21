# FlowCharting (agenty-flowcharting-panel)

React panel plugin scaffold targeting Grafana 11.x. This is the migration target for the
AngularJS `agenty-flowcharting-panel` plugin. The legacy AngularJS source remains in the
repository root `src/` tree (read-only reference) during the migration.

## Development

```bash
npm install
npm run dev        # watch build into dist/
npm run build      # production build into dist/
npm run test:ci    # run unit tests
npm run server     # start the Grafana 11.x docker dev stack
```

## Plugin metadata

Metadata in `src/plugin.json` is carried over verbatim from the legacy plugin
(id `agenty-flowcharting-panel`, name `FlowCharting`, author Arnaud GENTY, keywords,
info links, and logos); only `dependencies.grafanaVersion` was changed to `11.x`.
