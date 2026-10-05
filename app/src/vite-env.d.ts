/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_CHAIN_ID?: string
  readonly VITE_RPC_196?: string
  readonly VITE_RPC_31337?: string
  readonly VITE_ENABLE_ANVIL?: string
  readonly VITE_ANVIL_AUTOCONNECT?: string
  /** Cerebr CPU circuits address / CerebrScope address per chain (override launch/out). */
  readonly VITE_CPU_196?: string
  readonly VITE_CPU_31337?: string
  readonly VITE_SCOPE_196?: string
  readonly VITE_SCOPE_31337?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
