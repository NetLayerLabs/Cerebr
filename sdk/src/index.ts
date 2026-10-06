// @cerebr/sdk - neural-circuit compiler (neuro) + TapeOut X Layer client (tapeout).

export * from './neuro/index.ts';
export * as neuro from './neuro/index.ts';

// The TapeOut client is exported as a namespace only: several names (packBits/unpackBits with Hex
// instead of Uint8Array, truthTable on chain instead of local) differ from neuro's. Import it as
// `tapeout` from the root, or directly from '@cerebr/sdk/tapeout' in the app.
export * as tapeout from './tapeout/index.ts';
export { packBits, unpackBits } from './neuro/index.ts';
