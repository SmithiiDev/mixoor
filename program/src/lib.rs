use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod utils;

pub use instructions::*;
pub use state::*;
pub use utils::*;

#[allow(unused_imports)]
use solana_security_txt::security_txt;

declare_id!("mixEcfx7w47hvRwb9Nj7UeSQkCz6vZMbRHixMyYMLMb");

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Mixoor Program",
    project_url: "https://mixoor.fun/",
    contacts: "email:info@smithii.io, twitter:@/Mixoordotfun",
    policy: "https://github.com/SmithiiDev/mixoor",
    preferred_languages: "en",
    source_code: "https://github.com/SmithiiDev/mixoor"
}

#[program]
mod smithii_mixoor {
  use super::*;

  pub fn initialize_pool(ctx: Context<Initialize>, asset_type: AssetType) -> Result<()> {
    Initialize::initialize(ctx, asset_type)
  }

  pub fn deposit(
    ctx: Context<Deposit>,
    amount: u64,
    commitment: [u8; 32],
    new_root: [u8; 32],
  ) -> Result<()> {
    Deposit::deposit(ctx, amount, commitment, new_root)
  }

  pub fn transfer(
    ctx: Context<Transfer>,
    proof: ProofData,
    public_inputs: [[u8; 32]; 7], // All 7 public inputs from circuit (already field-reduced)
    nullifier_hash: [u8; 32],
    relayer_fee: u64,
    recipient_amount: u64,
  ) -> Result<()> {
    Transfer::transfer(
      ctx,
      proof,
      public_inputs,
      nullifier_hash,
      relayer_fee,
      recipient_amount,
    )
  }

  pub fn update_root(ctx: Context<UpdateRoot>, root: [u8; 32]) -> Result<()> {
    UpdateRoot::update_root_history(ctx, root)
  }

  pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    Withdraw::withdraw(ctx, amount)
  }
}
