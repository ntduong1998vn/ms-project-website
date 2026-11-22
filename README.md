# React + TypeScript + Vite

## Redmine proxy on Vercel

Set `REDMINE_ALLOWED_ORIGINS` in Vercel to a comma-separated list of trusted Redmine origins, e.g. `https://redmine.example.com,https://issues.example.org`. Empty means the production proxy is disabled (403). Redeploy after changing it. Enable **Use proxy (avoids CORS)** in connection settings; the saved `useDevProxy` option remains compatible. Development uses Vite's local proxy; production uses `/api/redmine-proxy/*`. Redmine subpaths are supported. Only allow servers you trust: requests forward the caller's API key, not a server credential. Cookies and redirects are not forwarded; request bodies are limited to 1 MiB.

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
