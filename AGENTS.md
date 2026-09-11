# Repository Guidelines

## Project Overview
`ms-project-web` is a modern frontend Single Page Application (SPA) built with **React 19**, **TypeScript ~6.0**, **Vite 8**, **Tailwind CSS v4**, and **shadcn/ui**. It features automated code optimization via the official **React Compiler**, strict modern TypeScript standards, and accessible UI primitives powered by **Radix UI**.

---

## Architecture & Data Flow
- **Build Pipeline**: Vite 8 with `@vitejs/plugin-react` (Oxc-based JSX/fast refresh), `@tailwindcss/vite` (Tailwind v4 compiler), and `@rolldown/plugin-babel` integrating `babel-plugin-react-compiler` for automated component memoization.
- **Component Architecture**: Built on top of `shadcn/ui` with the `radix-nova` design preset. Uses the unified `radix-ui` primitives package, `class-variance-authority` (CVA) for variant management, semantic `data-*` attribute hooks (`data-slot`, `data-variant`, `data-size`), and polymorphic rendering through Radix `Slot`.
- **Styling Architecture**: Pure CSS-driven Tailwind CSS v4 setup located in `src/index.css`. Uses `@theme inline` with OKLCH color tokens, `@custom-variant dark`, and `@fontsource-variable/geist`. There is no legacy `tailwind.config.js`.
- **Data Flow**: Unidirectional React 19 data flow using native React hooks (`useState`). Avoid manual `useMemo` or `useCallback` unless strictly necessary for external non-React subscriptions; the React Compiler optimizes renders automatically.

---

## Key Directories
```
ms-project-web/
├── public/                 # Static assets served at root (favicon.svg, icons.svg sprite)
├── src/
│   ├── assets/             # Bundled static images and SVGs imported directly in TSX
│   ├── components/
│   │   └── ui/             # Reusable shadcn/ui primitives (e.g., button.tsx)
│   ├── lib/                # Shared utilities and helpers (e.g., utils.ts for cn)
│   ├── App.tsx             # Root application component
│   ├── App.css             # Component-scoped styles for App.tsx
│   ├── index.css           # Global stylesheet (Tailwind v4, design tokens, font, theme)
│   └── main.tsx            # Application bootstrap (createRoot, StrictMode)
├── components.json         # shadcn/ui CLI configuration
├── vite.config.ts          # Vite bundler, plugins, and alias configuration
├── tsconfig.json           # Composite TypeScript root references
├── tsconfig.app.json       # Application TypeScript compiler options and aliases
├── tsconfig.node.json      # Node TypeScript configuration for vite.config.ts
└── .oxlintrc.json          # Oxlint linter configuration
```

---

## Development Commands

### Everyday Workflow
```bash
# Start local development server with HMR at http://localhost:5173
pnpm dev

# Run TypeScript project reference check and build production bundle
pnpm build

# Run fast Rust-based Oxlint static analysis
pnpm lint

# Preview the production build locally
pnpm preview
```

### shadcn CLI Workflow
To add new components, use the shadcn CLI with `pnpm dlx`:
```bash
# Add a component (e.g., dialog, card, input)
pnpm dlx shadcn@latest add dialog
pnpm dlx shadcn@latest add card
pnpm dlx shadcn@latest add input
```

---

## Code Conventions & Common Patterns

### TypeScript & Imports
- **Path Aliases**: Always use `@/*` to reference modules under `src/`:
  ```tsx
  import { Button } from "@/components/ui/button"
  import { cn } from "@/lib/utils"
  ```
- **Syntax Erasure (`erasableSyntaxOnly: true`)**: Only use syntax that can be removed by standard TypeScript syntax stripping.
  - **DO NOT** use TypeScript `enum`, non-ambient `namespace`, or constructor parameter properties.
  - Use `const` objects with `as const` or string union types instead of `enum`:
    ```ts
    export const Status = { Active: "active", Inactive: "inactive" } as const
    export type Status = (typeof Status)[keyof typeof Status]
    ```
- **Strict ESM (`verbatimModuleSyntax: true`)**: Distinguish value imports from type imports:
  ```ts
  import type { VariantProps } from "class-variance-authority"
  import { cva } from "class-variance-authority"
  ```
- **Explicit TS Extensions**: Supported by `allowImportingTsExtensions: true` (e.g. `import App from './App.tsx'`).

### Component Design Pattern
UI primitives follow the standard shadcn v4 pattern with CVA and Radix `Slot`:
```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-lg text-sm font-medium transition-all outline-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline: "border-border bg-background hover:bg-muted",
      },
      size: {
        default: "h-8 px-2.5",
        sm: "h-7 px-2 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
```

### Class Merging
`src/lib/utils.ts` re-exports `cn` from the lightweight `cn` npm package:
```ts
export { cn } from "cn"
```
Always use `cn(...)` when combining dynamic class names or applying overrides.

---

## Important Files
| File | Role |
|---|---|
| `src/main.tsx` | Entry point; mounts `<App />` within `React.StrictMode` into `#root`. |
| `src/App.tsx` | Root UI component and demo surface. |
| `src/index.css` | Global styling engine; imports Tailwind v4, Geist variable font, animations, and defines OKLCH tokens. |
| `vite.config.ts` | Configures React with compiler preset, Tailwind CSS plugin, and `@` path alias. |
| `components.json` | shadcn/ui configuration; specifies `radix-nova` style, `neutral` base color, and path aliases. |
| `tsconfig.app.json` | Application TypeScript compiler options targeting `es2023`, `moduleResolution: "bundler"`, and path mappings. |
| `tsconfig.json` | Root project references linking `tsconfig.app.json` and `tsconfig.node.json`. |
| `.oxlintrc.json` | Oxlint configuration defining rules for `react`, `typescript`, and `oxc`. |

---

## Runtime/Tooling Preferences
- **Package Manager**: **`pnpm`** (strictly `pnpm`; lockfile version 9). Do not use `npm` or `yarn`.
- **Node.js**: Node.js **v24 LTS** (or modern Node 20.11+ supporting `import.meta.dirname`).
- **Linter**: **`oxlint`** via `pnpm lint`. Fast AST-based linting. ESLint is not used.
- **Filesystem**: When operating in WSL2, keep the repository on the native Linux ext4 filesystem (`/home/...`) rather than Windows mounts (`/mnt/c/...`) to preserve full filesystem inotify performance for Vite HMR.

### Codebase Scouting
- Before scouting the codebase, check whether the `codegraph` CLI is installed and usable:
  ```bash
  command -v codegraph
  codegraph --help
  ```
- When `codegraph` is available and its project index is usable, prefer it for symbol, relationship, navigation, and impact queries. Check the index with `codegraph status`; sync stale indexes with `codegraph sync` when appropriate.
- If `codegraph` is unavailable, its index is incomplete, or the query is unsupported, fall back to the standard repository tools.

---

## Testing & QA
- **Current Setup**:
  - **Type Safety**: `pnpm exec tsc -b` (enforced as part of `pnpm build`).
  - **Static Analysis**: `pnpm lint` (`oxlint`).
  - Automated test runners (Vitest, Playwright) are not currently configured in `package.json`.
- **Recommended Stack When Adding Tests**:
  - **Unit & Component Testing**: **Vitest** + `@testing-library/react` + `jsdom`. Vitest directly reuses `vite.config.ts` and `@/*` alias mappings.
  - **E2E Testing**: **Playwright** (`@playwright/test`) with root `e2e/` test directory.
- **Verification Requirement for Changes**:
  Every code change made by an AI assistant must pass:
  ```bash
  pnpm lint && pnpm build
  ```
