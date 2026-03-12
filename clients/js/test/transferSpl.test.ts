import { getAddressEncoder } from '@solana/kit';
import test from 'ava';
import {
  AssetType,
  findPoolAddress,
  findVaultAddress,
  generateNullifier,
  generateProof,
  MerkleTree,
} from '../src';
import { LAMPORTS_PER_SOL } from './_constants';
import {
  createDefaultSolanaClient,
  createPoolForAuthority,
  depositForAuthority,
  getTokenBalance,
  loadReceiverKeypair,
  loadRelayerKeypair,
  transferForAuthority,
} from './_setup';
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { createAndMintTokens } from './_helpers';

test('it transfers custom SPL token privately', async (t) => {
  const client = createDefaultSolanaClient();
  const relayer = await loadRelayerKeypair();
  const merkleTree = new MerkleTree(20);
  await merkleTree.initialize();

  // for the spl token
  const { mint } = await createAndMintTokens();
  const SPL_ASSET_TYPE = AssetType.SplToken;
  const SPL_TOKEN_MINT = mint.address;

  // find pool address
  const [pool] = await findPoolAddress({
    mint: SPL_TOKEN_MINT,
    assetType: SPL_ASSET_TYPE,
  });

  // create pool
  console.log('calling init pool');
  await createPoolForAuthority(client, SPL_TOKEN_MINT, SPL_ASSET_TYPE);

  // find vault address
  const [vault] = await findVaultAddress({ pool });
  const [vaultTokenAccount] = await findAssociatedTokenPda({
    owner: vault,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: SPL_TOKEN_MINT,
  });

  // deposit
  console.log('calling deposit into pool');
  const depositAmount = BigInt(10) * LAMPORTS_PER_SOL;
  const { secret, nullifier } = await depositForAuthority(client, {
    amount: depositAmount,
    pool,
    mint: SPL_TOKEN_MINT,
    merkleTree, // Pass the merkle tree to handle root computation
    vaultTokenAccount,
  });

  // Tree already updated inside depositSolPoolForAuthority
  const localRoot = merkleTree.root();

  // Get merkle proof for the commitment (leaf index 0 since it's the first deposit)
  const leafIndex = 0;
  const { pathElements, pathIndices } = merkleTree.getProof(leafIndex);

  // Use LOCAL root (tree is off-chain now)
  const root = localRoot;

  // Generate nullifier hash
  const nullifierHash = await generateNullifier(nullifier, pool);

  // Get recipient address
  const recipient = await loadReceiverKeypair();
  const recipientBytes = getAddressEncoder().encode(recipient.address);

  // For now, use authority as relayer (can be changed later)
  const relayerBytes = getAddressEncoder().encode(relayer.address);

  // Generate zero-knowledge proof
  // In the new design:
  // - relayer_fee: what the relayer gets (user chooses)
  // - recipient_amount: what goes to recipient BEFORE protocol fee (proven by circuit)
  // - circuit proves: depositAmount >= relayer_fee + recipient_amount
  const relayerFee = 0; // No relayer fee for this test
  const recipientAmount = depositAmount; // Withdraw full deposit amount

  console.log('Generating ZK proof...');
  const { proofData, publicInputs } = await generateProof({
    secret,
    nullifier,
    amount: depositAmount, // Private input - what was deposited
    pathElements,
    pathIndices,
    recipient: Uint8Array.from(recipientBytes),
    relayer: Uint8Array.from(relayerBytes),
    fee: relayerFee, // Public input - must match instruction parameter
    refund: recipientAmount, // Public input - must match instruction parameter
    root: Uint8Array.from(root),
    poolAddress: pool,
  });
  console.log('ZK proof generated successfully');

  // Check vault token account balance before transfer
  const balanceBefore = await getTokenBalance(client, vaultTokenAccount);
  console.log('Vault token balance before transfer:', balanceBefore.amount);

  // Perform the transfer (withdrawal)
  console.log('calling transfer tx');
  await transferForAuthority(client, {
    relayerFee,
    recipientAmount,
    nullifierHash,
    publicInputs,
    proofData,
    mint: SPL_TOKEN_MINT,
    pool,
    vaultTokenAccount,
  });

  // Check vault token account balance after transfer
  const balanceAfter = await getTokenBalance(client, vaultTokenAccount);
  console.log('Vault token balance after transfer:', balanceAfter.amount);

  // Calculate expected amounts
  // Protocol fee is 15bps of recipient_amount
  const protocolFee = (BigInt(recipientAmount) * 15n) / 10000n;
  const finalRecipientAmount = BigInt(recipientAmount) - protocolFee;
  const totalWithdrawn = BigInt(recipientAmount) + BigInt(relayerFee);

  console.log('Protocol fee:', protocolFee);
  console.log('Final recipient amount:', finalRecipientAmount);
  console.log('Total withdrawn from vault:', totalWithdrawn);

  // Verify vault token balance decreased by the total withdrawn amount
  t.truthy(
    BigInt(balanceBefore.amount) - BigInt(balanceAfter.amount) >= totalWithdrawn
  );

  // Get recipient's token account to verify they received the funds
  const [recipientTokenAccount] = await findAssociatedTokenPda({
    owner: recipient.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint: SPL_TOKEN_MINT,
  });
  const recipientTokenBalance = await getTokenBalance(
    client,
    recipientTokenAccount
  );
  console.log('Recipient token balance:', recipientTokenBalance.amount);
  t.truthy(BigInt(recipientTokenBalance.amount) >= finalRecipientAmount);
});
