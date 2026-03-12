import { Account } from '@solana/web3.js';
import test from 'ava';
import {
  AssetType,
  fetchPool,
  findPoolAddress,
  findVaultAddress,
  MerkleTree,
  Pool,
} from '../src';
import { LAMPORTS_PER_SOL, WRAPPED_SOL_MINT_TOKEN_PROGRAM } from './_constants';
import { createAndInitEmptyMerkleTree } from './_helpers';
import {
  createDefaultSolanaClient,
  createSolPoolForAuthority,
  depositSolPoolForAuthority,
  getBalance,
} from './_setup';

test('it deposits into SOL pool for authority', async (t) => {
  const client = createDefaultSolanaClient();

  // _ since we are doing sol, we hardcode the assetType as such
  const ASSET_TYPE = AssetType.Sol;
  // find pool address
  const [pool] = await findPoolAddress({
    mint: WRAPPED_SOL_MINT_TOKEN_PROGRAM,
    assetType: ASSET_TYPE,
  });

  const { merkleTree: merkleTreeAddress } = await createAndInitEmptyMerkleTree(
    client,
    pool
  );

  const merkleTree = new MerkleTree(20);
  await merkleTree.initialize();

  // create pool
  const { authority } = await createSolPoolForAuthority(
    client,
    merkleTreeAddress
  );

  // find vault address
  const [vault] = await findVaultAddress({ pool });

  // deposit
  const amount = BigInt(10) * LAMPORTS_PER_SOL;
  console.log(' amount', amount); // ! debug

  const { depositor, commitment } = await depositSolPoolForAuthority(
    client,
    amount,
    merkleTreeAddress
  );
  console.log('depositor ->', depositor); // ! debug

  // initialize merkle tree
  merkleTree.insert(commitment);
  console.log('merkle tree', merkleTree.root()); // ! debug

  // check pool balance, since this is sol and not wrapped, check vault directly
  const bal = await getBalance(client, vault);
  console.log('the balance', bal); //! debug
  t.truthy(BigInt(bal) >= amount);

  t.like(await fetchPool(client.rpc, pool), <Account<Pool>>{
    data: {
      authority,
      // todo add missing fields later
    },
  });
});
