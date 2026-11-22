# React + TypeScript + Vite

## Redmine proxy on Vercel

Enable **Use proxy (avoids CORS)** in connection settings, or click **Use proxy** after a production connection error. No Vercel configuration or redeploy is needed for public Redmine servers. HTTPS is recommended; HTTP and custom ports are supported. With `REDMINE_ALLOWED_ORIGINS` unset/empty, the proxy checks every resolved address and pins the connection to public addresses, rejecting local/private/reserved destinations. As optional hardening, set this variable to comma-separated trusted origins (e.g. `https://redmine.example.com,https://issues.example.org`) to restrict requests to those origins instead; changing it requires redeployment.

Development retains Vite's local proxy; production uses `/api/redmine-proxy/*`. Redmine subpaths and the saved `useDevProxy` setting remain supported. Only `.json` API paths with an `X-Redmine-API-Key` are forwarded. The key is supplied by the caller, never a server credential. Cookies and redirects are not forwarded; request bodies are limited to 1 MiB. Only send keys to servers you trust.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.
You can also try [the experimental native React Compiler support in plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#rust-react-compiler) by using `compiler: true` in the plugin options instead of using the Babel plugin.

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

## Git push verification

The repository installs a tracked Git `pre-push` hook through the `prepare` lifecycle script. Run:

```bash
pnpm install
```

This configures Git to use `.githooks/pre-push`. If dependencies are already installed, configure the hook explicitly with:

```bash
pnpm run prepare
```

Before every push, the hook runs these checks in order and blocks the push if any command fails:

```bash
pnpm test
pnpm run test:coverage
pnpm lint
```

Do not bypass the hook with `git push --no-verify`; changes that fail tests, coverage thresholds, or lint must not be pushed. Run `pnpm build` separately when validating the production bundle.

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
