/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_CHAIN_ID?: string
  readonly VITE_RPC_196?: string
  readonly VITE_RPC_1952?: string
  readonly VITE_RPC_31337?: string
  readonly VITE_ENABLE_ANVIL?: string
  readonly VITE_ANVIL_AUTOCONNECT?: string
  readonly VITE_LENS_196?: string
  readonly VITE_LENS_1952?: string
  readonly VITE_LENS_31337?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
