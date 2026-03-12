# JavaScript client

A generated JavaScript library for the Mixoor program.

## Getting started

To build and test your JavaScript client from the root of the repository, you may use the following command.

```sh
pnpm clients:js:test
```

This will start a new local validator, if one is not already running, and run the tests for your JavaScript client.

## Available client scripts.

Alternatively, you can go into the client directory and run the tests directly.

```sh
# Build your programs and start the validator.
pnpm programs:build
pnpm validator:restart

# Go into the client directory and run the tests.
cd clients/js
pnpm install
pnpm build
pnpm test
```

You may also use the following scripts to lint and/or format your JavaScript client.

```sh
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:fix
```

## Development

### Circuit Files

This package includes zero-knowledge proof circuit files required for generating privacy-preserving transaction proofs. These files are bundled with the package during publishing.

If you're developing locally and need to update the circuit files:

```sh
# After building circuits in the main circuits directory
pnpm copy-circuits
```

The circuit files are located in:
- `circuits/build/transaction_js/transaction.wasm` - WASM circuit
- `circuits/transaction_0001.zkey` - ZKey file
- `circuits/verification_key.json` - Verification key

These paths are resolved at runtime relative to the package root, ensuring the library works both during development and when installed as an npm dependency.
