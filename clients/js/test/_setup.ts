import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import {
  Address,
  airdropFactory,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  assertIsSendableTransaction,
  assertIsTransactionWithBlockhashLifetime,
  Commitment,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  KeyPairSigner,
  lamports,
  pipe,
  Rpc,
  RpcSubscriptions,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  SolanaRpcApi,
  SolanaRpcSubscriptionsApi,
  TransactionMessage,
  TransactionMessageWithFeePayer,
  TransactionSigner,
} from '@solana/kit';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { randomBytes } from 'crypto';
import {
  AssetType,
  findPoolAddress,
  generateCommitment,
  getDepositInstructionAsync,
  getInitializePoolInstructionAsync,
  getTransferInstructionAsync,
  getUpdateRootInstruction,
  MerkleTree,
  ProofData,
} from '../src';
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { FEE_COLLECTOR_ADDRESS } from './_constants';

export type Client = {
  rpc: Rpc<SolanaRpcApi>;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
};

export const createDefaultSolanaClient = (): Client => {
  const rpc = createSolanaRpc('http://127.0.0.1:8899');
  const rpcSubscriptions = createSolanaRpcSubscriptions('ws://127.0.0.1:8900');
  return { rpc, rpcSubscriptions };
};

export const createDevnetClient = (): Client => {
  const rpc = createSolanaRpc('https://api.devnet.solana.com');
  const rpcSubscriptions = createSolanaRpcSubscriptions(
    'wss://api.devnet.solana.com/'
  );

  return { rpc, rpcSubscriptions };
};

export const generateKeyPairSignerWithSol = async (
  client: Client,
  putativeLamports: bigint = 1_000_000_000n
) => {
  const signer = await generateKeyPairSigner();
  await airdropFactory(client)({
    recipientAddress: signer.address,
    lamports: lamports(putativeLamports),
    commitment: 'confirmed',
  });
  return signer;
};

export const airdropSolToAddress = async (
  client: Client,
  receiver: Address, // 5 sol
  putativeLamports: bigint = 5_000_000_000n // 5 sol
) => {
  await airdropFactory(client)({
    recipientAddress: receiver,
    lamports: lamports(putativeLamports),
    commitment: 'confirmed',
  });
};

export async function loadKeypairFromFile(
  filePath: string
): Promise<KeyPairSigner<string>> {
  // This is here so you can also load the default keypair from the file system.
  const resolvedPath = path.resolve(
    filePath.startsWith('~') ? filePath.replace('~', os.homedir()) : filePath
  );
  const loadedKeyBytes = Uint8Array.from(
    JSON.parse(fs.readFileSync(resolvedPath, 'utf8'))
  );
  // Here you can also set the second parameter to true in case you need to extract your private key.
  const keypairSigner = await createKeyPairSignerFromBytes(loadedKeyBytes);
  return keypairSigner;
}

export const createDefaultTransaction = async (
  client: Client,
  feePayer: TransactionSigner
) => {
  const { value: latestBlockhash } = await client.rpc
    .getLatestBlockhash()
    .send();
  return pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
  );
};

export const signAndSendTransaction = async (
  client: Client,
  transactionMessage: TransactionMessage & TransactionMessageWithFeePayer,
  commitment: Commitment = 'confirmed'
) => {
  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessage);
  assertIsSendableTransaction(signedTransaction);

  const signature = getSignatureFromTransaction(signedTransaction);

  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  await sendAndConfirmTransactionFactory(client)(signedTransaction, {
    commitment,
    skipPreflight: false,
  });

  console.log('[DEBUG;] le signature ->', signature, '\n'); // ! debug
  return signature;
};

export const getBalance = async (client: Client, address: Address) =>
  (await client.rpc.getBalance(address, { commitment: 'confirmed' }).send())
    .value;

export async function loadDefaultKeypair(): Promise<KeyPairSigner<string>> {
  return await loadKeypairFromFile('~/.config/solana/id.json');
}

export async function loadReceiverKeypair(): Promise<KeyPairSigner<string>> {
  return await loadKeypairFromFile('~/.config/solana/id-new.json');
}

export async function loadRelayerKeypair(): Promise<KeyPairSigner<string>> {
  return await loadKeypairFromFile('~/.config/solana/relayer.json');
}

export const getTokenBalance = async (client: Client, tokenAccount: Address) =>
  (
    await client.rpc
      .getTokenAccountBalance(tokenAccount, { commitment: 'confirmed' })
      .send()
  ).value;

// -------------------------------------------------- instructions

export const createPoolForAuthority = async (
  client: Client,
  mint: Address,
  assetType: AssetType
): Promise<{ authority: Address }> => {
  const [authority] = await Promise.all([loadRelayerKeypair()]);

  const createIx = await getInitializePoolInstructionAsync({
    authority,
    mint,
    assetType,
  });

  await pipe(
    await createDefaultTransaction(client, authority),
    (tx) => appendTransactionMessageInstruction(createIx, tx),
    (tx) => signAndSendTransaction(client, tx)
  );

  return { authority: authority.address };
};

export const depositForAuthority = async (
  client: Client,
  ixArgs: {
    amount: bigint;
    merkleTree: MerkleTree;
    mint: Address;
    pool: Address;
    depositorTokenAccount?: Address;
    vaultTokenAccount?: Address;
  }
): Promise<{
  depositor: Address;
  commitment: Uint8Array;
  secret: Uint8Array;
  nullifier: Uint8Array;
}> => {
  const [authority] = await Promise.all([loadDefaultKeypair()]);

  const { merkleTree, amount, mint, vaultTokenAccount, pool } = ixArgs;

  const [depositorTokenAccount] = await findAssociatedTokenPda({
    owner: authority.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
  });

  // generate commitment
  const secret = randomBytes(32);
  const nullifier = randomBytes(32);
  const commitment = await generateCommitment(secret, nullifier, amount, pool);

  // Insert commitment into merkle tree and compute new root
  merkleTree.insert(commitment);
  const newRoot = merkleTree.root();

  // ! NOTE, DURING INITIALIZATION,
  const depositIx = await getDepositInstructionAsync({
    depositor: authority,
    pool,
    amount,
    commitment,
    newRoot,
    mint,
    depositorTokenAccount,
    vaultTokenAccount,
  });

  await pipe(
    await createDefaultTransaction(client, authority),
    (tx) => appendTransactionMessageInstruction(depositIx, tx),
    (tx) => signAndSendTransaction(client, tx)
  );

  return {
    depositor: authority.address,
    commitment,
    secret,
    nullifier,
  };
};

export const transferForAuthority = async (
  client: Client,
  ixArgs: {
    relayerFee: number;
    recipientAmount: bigint;
    nullifierHash: Uint8Array;
    proofData: ProofData;
    publicInputs: Uint8Array[];
    vaultTokenAccount?: Address;
    mint: Address;
    pool: Address;
  }
): Promise<{
  relayer: Address;
}> => {
  const [relayer, recipient] = await Promise.all([
    loadRelayerKeypair(),
    loadReceiverKeypair(),
  ]);

  // airdrop relayer
  await airdropSolToAddress(client, relayer.address);

  const {
    relayerFee,
    recipientAmount,
    nullifierHash,
    pool,
    mint,
    publicInputs,
    proofData: { proofA, proofB, proofC },
    vaultTokenAccount,
  } = ixArgs;

  const [recipientTokenAccount] = await findAssociatedTokenPda({
    owner: recipient.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
  });
  const [feeCollectorTokenAccount] = await findAssociatedTokenPda({
    owner: FEE_COLLECTOR_ADDRESS,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    mint,
  });

  const transferIx = await getTransferInstructionAsync({
    relayer,
    pool,
    recipient: recipient.address,
    proofA,
    proofB,
    proofC,
    nullifierHash,
    publicInputs,
    recipientAmount,
    relayerFee,
    mint,
    recipientTokenAccount,
    feeCollectorTokenAccount,
    vaultTokenAccount,
  });

  await pipe(
    await createDefaultTransaction(client, relayer),
    (tx) => appendTransactionMessageInstruction(transferIx, tx),
    (tx) =>
      appendTransactionMessageInstructions(
        [getSetComputeUnitLimitInstruction({ units: 250_000 })], // NOTE: 250k CUs is the safe zone
        tx
      ),
    (tx) => signAndSendTransaction(client, tx)
  );

  // todo: return the address of the pool
  // todo: what to return
  return { relayer: relayer.address };
};

export const updatePoolForRelayer = async (
  client: Client,
  root: Uint8Array,
  assetType: AssetType,
  mint: Address
): Promise<{
  relayer: Address;
}> => {
  const [relayer] = await Promise.all([loadDefaultKeypair()]);

  // find pool address
  const [pool] = await findPoolAddress({
    mint,
    assetType,
  });

  const updateRootIx = getUpdateRootInstruction({
    pool,
    root,
  });

  await pipe(
    await createDefaultTransaction(client, relayer),
    (tx) => appendTransactionMessageInstruction(updateRootIx, tx),
    (tx) => signAndSendTransaction(client, tx)
  );

  return {
    relayer: relayer.address,
  };
};
