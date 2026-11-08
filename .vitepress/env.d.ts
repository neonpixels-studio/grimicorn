/// <reference types="vite/client" />

// Ambient declaration for side-effect CSS imports (e.g. `import "./style.css"`),
// which carry no type information of their own.
declare module "*.css" {}

// VITE_* keys baked into the client bundle. See .env.example. Merges into
// vite/client's ImportMetaEnv, which the core no-unused-vars rule cannot see.
// eslint-disable-next-line no-unused-vars
interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
}
