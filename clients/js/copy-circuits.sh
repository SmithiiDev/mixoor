#!/bin/bash

# Copy circuit files from the main circuits directory to the JS client package
# This should be run after building the circuits

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$SCRIPT_DIR/../../circuits"
TARGET_DIR="$SCRIPT_DIR/circuits"

echo "Copying circuit files..."

# Create target directories
mkdir -p "$TARGET_DIR/build/transaction_js"

# Copy the WASM file
cp "$CIRCUITS_DIR/build/transaction_js/transaction.wasm" "$TARGET_DIR/build/transaction_js/"
echo "✓ Copied transaction.wasm"

# Copy the zkey file
cp "$CIRCUITS_DIR/transaction_0001.zkey" "$TARGET_DIR/"
echo "✓ Copied transaction_0001.zkey"

# Copy the verification key
cp "$CIRCUITS_DIR/verification_key.json" "$TARGET_DIR/"
echo "✓ Copied verification_key.json"

echo "Done! Circuit files copied to $TARGET_DIR"
