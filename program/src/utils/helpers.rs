use crate::utils::error::MixoorErrorCode;
use anchor_lang::prelude::*;
use ark_bn254::Fr;
use ark_ff::PrimeField;
use ark_serialize::CanonicalSerialize;

/// Converts a u64 to a field element (32 bytes big-endian)
pub fn u64_to_field_bytes(value: u64) -> [u8; 32] {
  let mut bytes = [0u8; 32];
  bytes[24..32].copy_from_slice(&value.to_be_bytes());
  bytes
}

/// Reduces a 256-bit number (represented as 32 bytes big-endian) modulo BN254 field size
fn reduce_mod_bn254(bytes: &[u8; 32]) -> [u8; 32] {
  // Fr::from_be_bytes_mod_order handles the reduction for us
  let field_element = Fr::from_be_bytes_mod_order(bytes);

  // Convert back to bytes in big-endian format
  let mut result = [0u8; 32];
  field_element
    .into_bigint()
    .serialize_uncompressed(&mut result[..])
    .expect("serialization failed");

  // arkworks serializes in little-endian, we need big-endian
  result.reverse();

  result
}

/// Converts a Pubkey to field element bytes (with modulo reduction)
pub fn pubkey_to_field_bytes(pubkey: &Pubkey) -> [u8; 32] {
  reduce_mod_bn254(&pubkey.to_bytes())
}

/// Validates that public inputs from the circuit match the actual instruction parameters
/// Public inputs order: [root, nullifierHash, recipient, relayer, fee, refund, poolId]
pub fn validate_public_inputs(
  public_inputs: &[[u8; 32]; 7],
  root: [u8; 32],
  nullifier_hash: [u8; 32],
  recipient: &Pubkey,
  relayer: &Pubkey,
  relayer_fee: u64,
  recipient_amount: u64,
  pool_id: &Pubkey,
) -> Result<()> {
  // Validate root (index 0)
  require!(
    public_inputs[0] == root,
    MixoorErrorCode::PublicInputMismatch
  );

  // Validate nullifier hash (index 1)
  require!(
    public_inputs[1] == nullifier_hash,
    MixoorErrorCode::PublicInputMismatch
  );

  // Validate recipient (index 2)
  let expected_recipient = pubkey_to_field_bytes(recipient);
  require!(
    public_inputs[2] == expected_recipient,
    MixoorErrorCode::PublicInputMismatch
  );

  // Validate relayer (index 3)
  let expected_relayer = pubkey_to_field_bytes(relayer);
  require!(
    public_inputs[3] == expected_relayer,
    MixoorErrorCode::PublicInputMismatch
  );

  // Validate relayer fee (index 4)
  let expected_fee = u64_to_field_bytes(relayer_fee);
  require!(
    public_inputs[4] == expected_fee,
    MixoorErrorCode::PublicInputMismatch
  );

  // Validate recipient amount (index 5)
  let expected_amount = u64_to_field_bytes(recipient_amount);
  require!(
    public_inputs[5] == expected_amount,
    MixoorErrorCode::PublicInputMismatch
  );

  // Validate pool ID (index 6)
  let expected_pool = pubkey_to_field_bytes(pool_id);
  require!(
    public_inputs[6] == expected_pool,
    MixoorErrorCode::PublicInputMismatch
  );

  Ok(())
}
