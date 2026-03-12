import { Account } from '@solana/web3.js';
import test from 'ava';
import { AssetType, fetchPool, findPoolAddress, Pool } from '../src';
import { createDefaultSolanaClient, createSolPoolForAuthority } from './_setup';
import { WRAPPED_SOL_MINT_TOKEN_PROGRAM } from './_constants';

test('it creates a new SOL pool account', async (t) => {
  const client = createDefaultSolanaClient();

  const { authority } = await createSolPoolForAuthority(client);

  // _ since we are doing sol, we hardcode the assetType as such
  const ASSET_TYPE = AssetType.Sol;
  // find pool address
  const [pool] = await findPoolAddress({
    mint: WRAPPED_SOL_MINT_TOKEN_PROGRAM,
    assetType: ASSET_TYPE,
  });

  t.like(await fetchPool(client.rpc, pool), <Account<Pool>>{
    data: {
      authority,
      // todo add missing fields later
    },
  });
});
