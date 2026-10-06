/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Private X Layer RPC (optional). */
  readonly VITE_RPC_196?: string
  /** Cerebr CPU circuits address / CerebrScope address (override launch/out, build time). */
  readonly VITE_CPU_196?: string
  readonly VITE_SCOPE_196?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
