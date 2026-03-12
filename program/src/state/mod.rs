use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

#[account(zero_copy)]
#[repr(C)]
pub struct Pool {
  pub authority: Pubkey,             // 32 bytes
  pub mint: Pubkey,                  // 32 bytes
  pub vault: Pubkey,                 // 32 bytes
  pub fee_collector: Pubkey,         // 32 bytes
  pub root_history: [RootEntry; 50], // 50 * 40 = 2000 bytes
  pub total_deposited: u64,          // 8 bytes
  pub total_withdrawn: u64,          // 8 bytes
  pub next_leaf_index: u32,          // 4 bytes - tracks commitment count
  pub asset_type: u8,                // 1 byte
  pub root_history_index: u8,        // 1 byte
  pub bump: u8,                      // 1 byte
  pub _padding: [u8; 1],             // 1 byte padding to align to 4
}

impl Pool {
  pub const LEN: usize = 8           // discriminator
    + 32                             // authority
    + 32                             // mint
    + 32                             // vault
    + 32                             // fee_collector
    + (50 * 40)                      // root_history
    + 8                              // total_deposited
    + 8                              // total_withdrawn
    + 4                              // next_leaf_index
    + 1                              // asset_type
    + 1                              // root_history_index
    + 1                              // bump
    + 1; // _padding

  pub fn add_root(&mut self, root: [u8; 32], clock: &Clock) -> Result<()> {
    let index = self.root_history_index as usize;
    self.root_history[index] = RootEntry {
      root,
      timestamp: clock.unix_timestamp,
    };
    self.root_history_index = ((index + 1) % 50) as u8;

    Ok(())
  }

  pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
    // msg!("is known root history {:?}", self.root_history_index); // ! FIXME: DEBUG STATEMENT
    self
      .root_history
      .iter()
      .any(|entry| &entry.root == root && entry.timestamp != 0)
  }
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum AssetType {
  Sol = 0,
  SplToken = 1,
}

impl AssetType {
  pub fn from_u8(value: u8) -> Option<Self> {
    match value {
      0 => Some(AssetType::Sol),
      1 => Some(AssetType::SplToken),
      _ => None,
    }
  }

  pub fn as_u8(&self) -> u8 {
    match self {
      AssetType::Sol => 0,
      AssetType::SplToken => 1,
    }
  }
}

#[repr(C)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Zeroable, Pod)]
pub struct RootEntry {
  pub root: [u8; 32],
  pub timestamp: i64,
}

#[account]
pub struct NullifierAccount {
  pub nullifier_hash: [u8; 32],
  pub spent_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofData {
  pub proof_a: [u8; 64],
  pub proof_b: [u8; 128],
  pub proof_c: [u8; 64],
}

#[account]
pub struct Vault {}

impl Vault {
  pub const LEN: usize = 8 + 128;
}

// Commitment tracking for the privacy mixer
// We DON'T store the full Merkle tree on-chain - that would be too large (>10MB Solana limit)
// Instead, we emit events and users build the Merkle tree locally (Tornado Cash approach)
// The Pool's root_history tracks valid roots for proof verification

#[event]
pub struct CommitmentInserted {
  pub commitment: [u8; 32],
  pub leaf_index: u32,
  pub pool: Pubkey,
}

// Note: We don't verify Merkle proofs on-chain
// The ZK circuit verifies the Merkle proof as part of the ZK-SNARK
// We only check that the root exists in the Pool's root_history
