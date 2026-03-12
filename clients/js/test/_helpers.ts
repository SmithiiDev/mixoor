import {
  Address,
  appendTransactionMessageInstructions,
  generateKeyPairSigner,
  pipe,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  Client,
  createDefaultSolanaClient,
  createDefaultTransaction,
  loadDefaultKeypair,
  signAndSendTransaction,
} from './_setup';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMintInstruction,
  getMintSize,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

/**
 * Merkle tree is now off-chain (events-based like Tornado Cash)
 * This function is kept for backwards compatibility but does nothing
 * Commitments are emitted as events and users build the tree locally
 */
export const createAndInitPoseidonMerkleTree = async (
  _client: Client,
  pool: Address
): Promise<{ authority: Address; merkleTree: Address }> => {
  const authority = await loadDefaultKeypair();

  console.log('Merkle tree is off-chain (event-based) for pool:', pool);
  return { authority: authority.address, merkleTree: pool }; // Return pool as placeholder
};

// Keep old function for backwards compatibility
/** @deprecated Merkle tree is now off-chain (event-based) */
export const createAndInitEmptyMerkleTree = createAndInitPoseidonMerkleTree;

// creates and mints a new token for testing SPL transfers
export async function createAndMintTokens() {
  const client = createDefaultSolanaClient();
  const [authority] = await Promise.all([loadDefaultKeypair()]);

  const mint = await generateKeyPairSigner();
  const space = BigInt(getMintSize());
  const rent = await client.rpc.getMinimumBalanceForRentExemption(space).send();

  const createAccountInstruction = getCreateAccountInstruction({
    payer: authority,
    newAccount: mint,
    lamports: rent,
    space,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  });
  const initializeMintInstruction = getInitializeMintInstruction({
    mint: mint.address,
    decimals: 9,
    mintAuthority: authority.address,
  });
  const instructions = [createAccountInstruction, initializeMintInstruction];

  const [associatedTokenAddress] = await findAssociatedTokenPda({
    mint: mint.address,
    owner: authority.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const instruction2 = getCreateAssociatedTokenIdempotentInstruction({
    payer: authority,
    ata: associatedTokenAddress,
    owner: authority.address,
    mint: mint.address,
  });

  // Create instruction to mint tokens
  const instructions3 = getMintToInstruction({
    mint: mint.address,
    token: associatedTokenAddress,
    mintAuthority: authority.address,
    amount: 100_000_000_000n, // 100 tokens
  });

  await pipe(
    await createDefaultTransaction(client, authority),
    (tx) =>
      appendTransactionMessageInstructions(
        [...instructions, instruction2, instructions3],
        tx
      ),
    (tx) => signAndSendTransaction(client, tx)
  );

  return {
    mint,
    associatedTokenAddress,
  };
}
