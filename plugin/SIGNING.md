# Signing & Release (operational config)

> Operational reference for maintainers. The full build -> sign -> package
> narrative in the README is maintained separately (Task 14.2). This file
> captures the config put in place by the signing/release tooling.

## Development mode (unsigned)

In the Demo_Stack the plugin runs **unsigned**. `docker-compose.yaml` sets:

- `GF_DEFAULT_APP_MODE=development`
- `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=agenty-flowcharting-panel`

No signing is required to develop or run the demo locally (Req 10.1).

## Access Policy token

Signing requires a **Grafana Cloud Access Policy token** with the
`plugins:write` scope (Req 10.2). Create it in Grafana Cloud under
Account -> Access Policies, then grant the policy the `plugins:write` scope
and issue a token for it.

The token MUST be provided via the `GRAFANA_ACCESS_POLICY_TOKEN` environment
variable. **Never commit the token.** `.gitignore` excludes `.env`, `*.token`,
`*.pem`, and `*.key` so a token cannot be checked in accidentally (Req 10.5).

## Signing locally

```bash
export GRAFANA_ACCESS_POLICY_TOKEN=<your-plugins:write-token>
npm run build        # produces dist/
npm run sign         # runs @grafana/sign-plugin against dist/
```

`npm run sign` is wired in `package.json` as
`npx --yes @grafana/sign-plugin@latest` (Req 10.3).

## Release workflow (GitHub Actions)

`.github/workflows/release.yml` publishes a signed release when a `v*` tag is
pushed (Req 10.4). It builds, runs `npm run sign`, packages the versioned zip
(+ sha1), and attaches the artifacts to a GitHub release.

The workflow reads the token only from the repository secret
`GRAFANA_ACCESS_POLICY_TOKEN` — it never contains a literal token. Add the
secret under: repo Settings -> Secrets and variables -> Actions -> New
repository secret, named `GRAFANA_ACCESS_POLICY_TOKEN`.
