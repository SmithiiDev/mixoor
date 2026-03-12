import { Address } from '@solana/kit';
import { buildPoseidon } from 'circomlibjs';
import { Client } from '../../test/_setup';

export class MerkleTree {
  private levels: number;
  private _leaves: Uint8Array[];
  private _zeros: Uint8Array[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private poseidon: any;
  private initialized: boolean = false;

  constructor(levels: number) {
    this.levels = levels;
    this._leaves = [];
    this._zeros = [];
  }

  async initialize() {
    if (this.initialized) return;

    this.poseidon = await buildPoseidon();

    // First zero is all zeros
    this._zeros[0] = new Uint8Array(32);

    // Mark as initialized BEFORE building zero tree
    this.initialized = true;

    // Build zero tree
    for (let i = 1; i <= this.levels; i++) {
      this._zeros[i] = this.hash(this._zeros[i - 1], this._zeros[i - 1]);
    }
  }

  private hash(left: Uint8Array, right: Uint8Array): Uint8Array {
    if (!this.poseidon) {
      throw new Error('MerkleTree not initialized. Call initialize() first');
    }

    // Convert Uint8Array to field elements with modulo reduction to match circuit
    // This ensures consistency if inputs (e.g. from randomBytes) technically exceed field size
    const SNARK_FIELD_SIZE = BigInt(
      '21888242871839275222246405745257275088548364400416034343698204186575808495617'
    );
    const leftBigInt = this.uint8ArrayToBigInt(left) % SNARK_FIELD_SIZE;
    const rightBigInt = this.uint8ArrayToBigInt(right) % SNARK_FIELD_SIZE;

    const result = this.poseidon([leftBigInt, rightBigInt]);
    const resultBytes = this.poseidon.F.toObject(result);

    // Convert back to Uint8Array (32 bytes)
    return this.bigIntToUint8Array(BigInt(resultBytes));
  }

  private uint8ArrayToBigInt(arr: Uint8Array): bigint {
    let hex = '0x';
    for (let i = 0; i < arr.length; i++) {
      hex += arr[i].toString(16).padStart(2, '0');
    }
    return BigInt(hex);
  }

  private bigIntToUint8Array(value: bigint): Uint8Array {
    const bytes = new Uint8Array(32);
    let temp = value;
    for (let i = 31; i >= 0; i--) {
      bytes[i] = Number(temp & BigInt(0xff));
      temp = temp >> BigInt(8);
    }
    return bytes;
  }

  insert(leaf: Uint8Array) {
    if (!this.initialized) {
      throw new Error('MerkleTree not initialized. Call initialize() first');
    }
    this._leaves.push(leaf);
  }

  root(): Uint8Array {
    if (!this.initialized) {
      throw new Error('MerkleTree not initialized. Call initialize() first');
    }

    if (this._leaves.length === 0) {
      return this._zeros[this.levels];
    }

    let currentLevel = [...this._leaves];

    for (let level = 0; level < this.levels; level++) {
      const nextLevel: Uint8Array[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right =
          i + 1 < currentLevel.length
            ? currentLevel[i + 1]
            : this._zeros[level];
        nextLevel.push(this.hash(left, right));
      }

      currentLevel = nextLevel;

      // Note: Removed early break checking for length === 1
      // We must continue hashing up to the root level.
    }

    return currentLevel[0];
  }

  getProof(index: number): {
    pathElements: Uint8Array[];
    pathIndices: number[];
  } {
    if (!this.initialized) {
      throw new Error('MerkleTree not initialized. Call initialize() first');
    }

    if (index >= this._leaves.length) {
      throw new Error('Leaf index out of bounds');
    }

    const pathElements: Uint8Array[] = [];
    const pathIndices: number[] = [];

    let currentLevel = [...this._leaves];
    let currentIndex = index;

    for (let level = 0; level < this.levels; level++) {
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;

      const sibling =
        siblingIndex < currentLevel.length
          ? currentLevel[siblingIndex]
          : this._zeros[level];

      pathElements.push(sibling);
      pathIndices.push(isLeft ? 0 : 1);

      // Move up to next level
      const nextLevel: Uint8Array[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right =
          i + 1 < currentLevel.length
            ? currentLevel[i + 1]
            : this._zeros[level];
        nextLevel.push(this.hash(left, right));
      }

      currentLevel = nextLevel;
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { pathElements, pathIndices };
  }
}

/**
 * The Merkle tree is now OFF-CHAIN (event-based, like Tornado Cash)
 *
 * In production:
 * 1. Listen to CommitmentInserted events from deposits
 * 2. Build local Merkle tree from events
 * 3. Use local tree's root in ZK proofs
 * 4. The root should match one in Pool's root_history
 *
 * For testing: Just use your local MerkleTree.root()
 */
export function extractMerkleRootFromAccount(
  _client: Client,
  _poolAddress: Address
): Uint8Array {
  throw new Error(
    'Merkle tree is off-chain now. Build it locally from CommitmentInserted events. ' +
      'For tests, use your MerkleTree instance: merkleTree.root()'
  );
}
