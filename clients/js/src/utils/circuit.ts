import { Address, getAddressEncoder } from '@solana/kit';
import { buildPoseidon } from 'circomlibjs';
import * as path from 'path';
import { groth16 } from 'snarkjs';
import { fileURLToPath } from 'url';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let poseidon: any;

async function initPoseidon() {
  if (!poseidon) {
    poseidon = await buildPoseidon();
  }
  return poseidon;
}

// Snark scalar field size
const SNARK_FIELD_SIZE = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

// Helper function to convert Uint8Array to field element (BigInt string)
// consistently using Big-Endian interpretation AND modulo reduction
function toFieldElement(bytes: ArrayLike<number>): string {
  let bigInt = 0n;
  for (let i = 0; i < bytes.length; i++) {
    bigInt = (bigInt << 8n) | BigInt(bytes[i]);
  }
  return (bigInt % SNARK_FIELD_SIZE).toString();
}

export async function poseidonHash(inputs: Uint8Array[]): Promise<Uint8Array> {
  await initPoseidon();
  // Ensure inputs are converted to BigInts (standard form) using Big-Endian interpretation
  // Do NOT use poseidon.F.e() as it might convert to Montgomery form which poseidon() expects to handle itself
  const hash = poseidon(inputs.map((x) => BigInt(toFieldElement(x))));
  const hashBigInt = poseidon.F.toObject(hash);

  // Convert BigInt to 32-byte array (BIG-ENDIAN to match MerkleTree class)
  const bytes = new Uint8Array(32);
  let temp = BigInt(hashBigInt);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(temp & BigInt(0xff));
    temp = temp >> BigInt(8);
  }

  return bytes;
}

export async function generateCommitment(
  secret: Uint8Array,
  nullifier: Uint8Array,
  amount: bigint,
  poolId: Address
): Promise<Uint8Array> {
  await initPoseidon();

  const poolIdBytes = getAddressEncoder().encode(poolId);

  const secretField = BigInt(toFieldElement(secret));
  const nullifierField = BigInt(toFieldElement(nullifier));
  const amountField = BigInt(amount);
  const poolIdField = BigInt(toFieldElement(Uint8Array.from(poolIdBytes)));

  const hash = poseidon([
    secretField,
    nullifierField,
    amountField,
    poolIdField,
  ]);
  const hashBigInt = poseidon.F.toObject(hash);

  // Convert result to bytes (BIG-ENDIAN to match MerkleTree class)
  const bytes = new Uint8Array(32);
  let temp = BigInt(hashBigInt);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(temp & BigInt(0xff));
    temp = temp >> BigInt(8);
  }

  return bytes;
}

export async function generateNullifier(
  nullifier: Uint8Array,
  poolId: Address
): Promise<Uint8Array> {
  const poolIdBytes = getAddressEncoder().encode(poolId);
  return await poseidonHash([nullifier, Uint8Array.from(poolIdBytes)]);
}

export interface ProofInput {
  secret: Uint8Array;
  nullifier: Uint8Array;
  amount: bigint;
  pathElements: Uint8Array[];
  pathIndices: number[];
  recipient: Uint8Array;
  relayer: Uint8Array;
  fee: number;
  refund: bigint;
  root: Uint8Array;
  poolAddress: Address; // pool address
}

export interface ProofOutput {
  proof_a: Uint8Array;
  proof_b: Uint8Array;
  proof_c: Uint8Array;
}
function fieldElementToBytes(element: string): Uint8Array {
  // Convert field element string to BigInt, then to 32-byte array (BIG-ENDIAN to match snarkjs output)
  const bigInt = BigInt(element);
  const bytes = new Uint8Array(32);

  for (let i = 0; i < 32; i++) {
    bytes[31 - i] = Number((bigInt >> BigInt(i * 8)) & BigInt(0xff));
  }

  return bytes;
}

function publicSignalToBytes(signal: string): Uint8Array {
  const bigInt = BigInt(signal);
  const bytes = new Uint8Array(32);

  for (let i = 0; i < 32; i++) {
    bytes[31 - i] = Number((bigInt >> BigInt(i * 8)) & BigInt(0xff));
  }

  return bytes;
}

function g1PointToBytes(point: [string, string]): Uint8Array {
  const x = fieldElementToBytes(point[0]);
  const y = fieldElementToBytes(point[1]);

  const result = new Uint8Array(64);
  result.set(x, 0);
  result.set(y, 32);

  return result;
}

function g2PointToBytes(
  point: [[string, string], [string, string]]
): Uint8Array {
  // G2 point has two coordinates, each is a pair of field elements
  // Solana/EIP-197 BN254 G2 expectation: c1 then c0 (Big Endian logic)
  // snarkjs output: [c0, c1]
  const x1 = fieldElementToBytes(point[0][1]); // c1
  const x0 = fieldElementToBytes(point[0][0]); // c0
  const y1 = fieldElementToBytes(point[1][1]); // c1
  const y0 = fieldElementToBytes(point[1][0]); // c0

  const result = new Uint8Array(128);
  result.set(x1, 0);
  result.set(x0, 32);
  result.set(y1, 64);
  result.set(y0, 96);

  return result;
}

export type ProofData = {
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
};

export async function generateProof(input: ProofInput): Promise<{
  proofData: ProofData;
  publicInputs: Uint8Array[];
}> {
  await initPoseidon();

  const poolIdBytes = getAddressEncoder().encode(input.poolAddress);

  const circuitInputs = {
    root: toFieldElement(input.root),
    nullifierHash: toFieldElement(
      await generateNullifier(input.nullifier, input.poolAddress)
    ),
    recipient: toFieldElement(input.recipient),
    relayer: toFieldElement(input.relayer),
    fee: input.fee,
    refund: input.refund,
    poolId: toFieldElement(Uint8Array.from(poolIdBytes)),
    secret: toFieldElement(input.secret),
    nullifier: toFieldElement(input.nullifier),
    pathElements: input.pathElements.map((x) => toFieldElement(x)),
    pathIndices: input.pathIndices,
    amount: BigInt(input.amount).toString(),
  };

  // Resolve paths relative to the package root
  // Get the directory of the current file
  // Handle both ESM and CommonJS environments
  let __dirname: string;
  if (typeof __filename !== 'undefined') {
    // CommonJS environment
    __dirname = path.dirname(__filename);
  } else {
    // ESM environment
    const __filename_esm = fileURLToPath(import.meta.url);
    __dirname = path.dirname(__filename_esm);
  }

  const packageRoot = path.join(__dirname, '../..');
  const wasmPath = path.join(
    packageRoot,
    'circuits/build/transaction_js/transaction.wasm'
  );
  const zkeyPath = path.join(packageRoot, 'circuits/transaction_0001.zkey');

  const { proof, publicSignals } = await groth16.fullProve(
    circuitInputs,
    wasmPath,
    zkeyPath
  );

  // // Verify proof locally first
  // const vKeyPath = path.join(packageRoot, 'circuits/verification_key.json');
  // const isValid = await groth16.verify(
  //   JSON.parse(fs.readFileSync(vKeyPath, 'utf8')),
  //   publicSignals,
  //   proof
  // );
  // console.log('Local proof verification:', isValid ? 'VALID ✓' : 'INVALID ✗');
  // if (!isValid) {
  //   throw new Error('Generated proof is invalid - check circuit inputs');
  // }

  const publicInputs = publicSignals.map((signal) =>
    publicSignalToBytes(signal)
  );

  // snarkjs returns proof with pi_a, pi_b, pi_c as string arrays
  const proof_a = g1PointToBytes([proof.pi_a[0], proof.pi_a[1]]);
  const proof_b = g2PointToBytes([
    [proof.pi_b[0][0], proof.pi_b[0][1]],
    [proof.pi_b[1][0], proof.pi_b[1][1]],
  ]);
  const proof_c = g1PointToBytes([proof.pi_c[0], proof.pi_c[1]]);

  return {
    proofData: {
      proofA: proof_a,
      proofB: proof_b,
      proofC: proof_c,
    },
    publicInputs,
  };
}
