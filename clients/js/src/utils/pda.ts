import {
  Address,
  getAddressEncoder,
  getEnumCodec,
  getProgramDerivedAddress,
  ProgramDerivedAddress,
} from '@solana/kit';
import { AssetType, MIXOOR_PROGRAM_ADDRESS } from '../generated';

export type PoolSeeds = {
  /** The prefix string SEED. */
  seed?: string;
  /** The mint address */
  mint: Address;
  /** The asset type */
  assetType: AssetType;
};

export async function findPoolAddress(
  seeds: PoolSeeds,
  config: { programAddress?: Address | undefined } = {}
): Promise<ProgramDerivedAddress> {
  const { programAddress = MIXOOR_PROGRAM_ADDRESS } = config;

  return await getProgramDerivedAddress({
    programAddress,
    seeds: [
      'pool',
      getAddressEncoder().encode(seeds.mint),
      getEnumCodec(AssetType).encode(seeds.assetType),
    ],
  });
}

export type MerkleTreeSeeds = {
  /** The prefix string SEED. */
  seed?: string;
  /** The pool address */
  pool: Address;
};

export async function findMerkleTreeAddress(
  seeds: MerkleTreeSeeds,
  config: { programAddress?: Address | undefined } = {}
): Promise<ProgramDerivedAddress> {
  const { programAddress = MIXOOR_PROGRAM_ADDRESS } = config;

  return await getProgramDerivedAddress({
    programAddress,
    seeds: ['merkle', getAddressEncoder().encode(seeds.pool)],
  });
}

export type VaultSeeds = {
  /** The prefix string SEED. */
  seed?: string;
  /** The pool address */
  pool: Address;
};

export async function findVaultAddress(
  seeds: MerkleTreeSeeds,
  config: { programAddress?: Address | undefined } = {}
): Promise<ProgramDerivedAddress> {
  const { programAddress = MIXOOR_PROGRAM_ADDRESS } = config;

  return await getProgramDerivedAddress({
    programAddress,
    seeds: ['vault', getAddressEncoder().encode(seeds.pool)],
  });
}

export type NullifierSeeds = {
  /** The prefix string SEED. */
  seed?: string;
  /** The pool address */
  pool: Address;
  /** The nullifier hash */
  nullifierHash: Uint8Array;
};

export async function findNullifierAddress(
  seeds: NullifierSeeds,
  config: { programAddress?: Address | undefined } = {}
): Promise<ProgramDerivedAddress> {
  const { programAddress = MIXOOR_PROGRAM_ADDRESS } = config;

  return await getProgramDerivedAddress({
    programAddress,
    seeds: [
      'nullifier',
      getAddressEncoder().encode(seeds.pool),
      seeds.nullifierHash,
    ],
  });
}
