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
import { LAMPORTS_PER_SOL, WRAPPED_SOL_MINT_TOKEN_PROGRAM } from './_constants';
import {
  createDefaultSolanaClient,
  createPoolForAuthority,
  depositForAuthority,
  getBalance,
  loadReceiverKeypair,
  loadRelayerKeypair,
  transferForAuthority,
} from './_setup';

test('it transfers authority deposited SOL', async (t) => {
  const client = createDefaultSolanaClient();
  const relayer = await loadRelayerKeypair();
  const merkleTree = new MerkleTree(20);
  await merkleTree.initialize();

  // _ since we are doing sol, we hardcode the assetType as such
  const SOL_ASSET_TYPE = AssetType.Sol;

  // find pool address
  const [pool] = await findPoolAddress({
    mint: WRAPPED_SOL_MINT_TOKEN_PROGRAM,
    assetType: SOL_ASSET_TYPE,
  });

  // create pool
  console.log('calling init pool');
  await createPoolForAuthority(
    client,
    WRAPPED_SOL_MINT_TOKEN_PROGRAM,
    SOL_ASSET_TYPE
  );

  // find vault address
  const [vault] = await findVaultAddress({ pool });

  // deposit
  console.log('calling deposit into pool');
  const depositAmount = BigInt(1) * LAMPORTS_PER_SOL;
  const { secret, nullifier } = await depositForAuthority(client, {
    amount: depositAmount,
    pool,
    mint: WRAPPED_SOL_MINT_TOKEN_PROGRAM,
    merkleTree, // Pass the merkle tree to handle root computation
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

  // Check vault balance before transfer
  const balanceBefore = await getBalance(client, vault);
  console.log('Vault balance before transfer:', balanceBefore);

  // Perform the transfer (withdrawal)
  console.log('calling transfer tx');
  await transferForAuthority(client, {
    relayerFee,
    recipientAmount,
    nullifierHash,
    publicInputs,
    proofData,
    mint: WRAPPED_SOL_MINT_TOKEN_PROGRAM,
    pool,
  });

  // Check vault balance after transfer
  const balanceAfter = await getBalance(client, vault);
  console.log('Vault balance after transfer:', balanceAfter);

  // Calculate expected amounts
  // Protocol fee is 15bps of recipient_amount
  const protocolFee = (BigInt(recipientAmount) * 15n) / 10000n;
  const finalRecipientAmount = BigInt(recipientAmount) - protocolFee;
  const totalWithdrawn = BigInt(recipientAmount) + BigInt(relayerFee);

  console.log('Protocol fee:', protocolFee);
  console.log('Final recipient amount:', finalRecipientAmount);
  console.log('Total withdrawn from vault:', totalWithdrawn);

  // Verify vault balance decreased by the total withdrawn amount
  t.truthy(BigInt(balanceBefore) - BigInt(balanceAfter) >= totalWithdrawn);

  // Verify recipient received the funds (after protocol fee)
  const recipientBalance = await getBalance(client, recipient.address);
  console.log('Recipient balance:', recipientBalance);
  t.truthy(BigInt(recipientBalance) >= finalRecipientAmount);
});
