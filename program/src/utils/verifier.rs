use anchor_lang::prelude::*;
use ark_bn254::G1Affine as G1;
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize, Compress, Validate};
use groth16_solana::groth16::Groth16Verifier;
use std::ops::Neg;

use crate::{state::ProofData, utils::error::MixoorErrorCode};

use super::verifying_key::VERIFYING_KEY;

fn change_endianness(bytes: &[u8]) -> Vec<u8> {
  let mut vec = Vec::with_capacity(bytes.len());
  for b in bytes.chunks(32) {
    vec.extend(b.iter().rev());
  }
  vec
}

pub fn verify_groth16_proof(proof: ProofData, public_inputs: Vec<[u8; 32]>) -> Result<bool> {
  // check no. of inputs
  require!(
    public_inputs.len() == 7,
    MixoorErrorCode::InvalidPublicInputs
  );

  // Negate proof_a for verification
  let g1_point = G1::deserialize_with_mode(
    &*[&change_endianness(&proof.proof_a[0..64]), &[0u8][..]].concat(),
    Compress::No,
    Validate::Yes,
  )
  .map_err(|_| error!(MixoorErrorCode::InvalidProof))?;

  let mut proof_a_neg = [0u8; 65];
  g1_point
    .neg()
    .x
    .serialize_with_mode(&mut proof_a_neg[..32], Compress::No)
    .map_err(|_| error!(MixoorErrorCode::InvalidProof))?;
  g1_point
    .neg()
    .y
    .serialize_with_mode(&mut proof_a_neg[32..], Compress::No)
    .map_err(|_| error!(MixoorErrorCode::InvalidProof))?;

  let proof_a: [u8; 64] = change_endianness(&proof_a_neg[..64])
    .try_into()
    .map_err(|_| error!(MixoorErrorCode::InvalidProof))?;

  // Public inputs are already in Big-Endian format (standard for BN254)
  // groth16-solana and alt_bn128 syscalls expect BE format
  let mut public_inputs_array = [[0u8; 32]; 7];
  for (i, input) in public_inputs.iter().enumerate().take(7) {
    public_inputs_array[i] = *input;
  }

  // proof_b and proof_c are used as-is (matching groth16-solana test pattern)
  // Only proof_a gets endianness conversion due to negation
  let mut verifier = Groth16Verifier::new(
    &proof_a,
    &proof.proof_b,
    &proof.proof_c,
    &public_inputs_array,
    &VERIFYING_KEY,
  )
  .map_err(|e| {
    msg!("Failed to create verifier: {:?}", e);
    error!(MixoorErrorCode::InvalidProof)
  })?;

  let verify_result = verifier.verify();

  Ok(verify_result.is_ok())
}
