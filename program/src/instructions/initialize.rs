use anchor_lang::prelude::*;

use anchor_spl::{
  associated_token::AssociatedToken,
  token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
  constants::{RELAYER_ADDRESS, TREASURY_ADDRESS},
  state::{AssetType, Pool, RootEntry, Vault},
  utils::error::MixoorErrorCode,
};

#[derive(Accounts)]
#[instruction(asset_type: AssetType)]
pub struct Initialize<'info> {
  #[account(
    mut,
    address = RELAYER_ADDRESS @ MixoorErrorCode::Unauthorized
  )]
  pub authority: Signer<'info>,

  #[account(
    init,
    payer = authority,
    space = Pool::LEN,
    seeds = [b"pool",mint.key().as_ref(),asset_type.as_u8().to_le_bytes().as_ref()],
    bump
  )]
  pub pool: AccountLoader<'info, Pool>,

  #[account(
    init,
    payer = authority,
    space = Vault::LEN,
    seeds = [b"vault", pool.key().as_ref()],
    bump
  )]
  pub vault: Account<'info, Vault>,

  #[account(
    init,
    payer = authority,
    associated_token::mint = mint,
    associated_token::authority = vault,
    associated_token::token_program = token_program
  )]
  pub vault_ata: InterfaceAccount<'info, TokenAccount>,

  #[account(mut)]
  pub mint: InterfaceAccount<'info, Mint>,

  /// CHECK: hardcoded address for us
  #[account(address = TREASURY_ADDRESS)]
  pub fee_collector: UncheckedAccount<'info>,

  pub system_program: Program<'info, System>,

  pub token_program: Interface<'info, TokenInterface>,

  pub associated_token_program: Program<'info, AssociatedToken>,
}

impl Initialize<'_> {
  pub fn validate(&self, asset_type: &AssetType) -> Result<()> {
    match asset_type {
      AssetType::Sol => {
        // since we are using mint acc owned by token program, we can only use the SPL wrapped address.
        // potential conflict would be if a user wanted to initialize a pool for wrapped SOL SPL token
        // but this is possible since the pool will use the same address and the AssetType seed.
        //
        // No need to check the native mint ...111 since it'll fail with wrong owner program err
        if self.mint.key() != pubkey!("So11111111111111111111111111111111111111112") {
          return err!(MixoorErrorCode::InvalidMint);
        }
      }
      // allow everything
      AssetType::SplToken => {}
    }

    Ok(())
  }

  #[access_control(ctx.accounts.validate(&asset_type))]
  pub fn initialize(ctx: Context<Initialize>, asset_type: AssetType) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_init()?;
    let asset_type_u8 = asset_type.as_u8();

    pool.authority = ctx.accounts.pool.key();
    pool.asset_type = asset_type_u8;
    pool.mint = ctx.accounts.mint.key();
    pool.vault = ctx.accounts.vault.key();
    pool.root_history = [RootEntry::default(); 50];
    pool.root_history_index = 0;
    pool.next_leaf_index = 0;
    pool.total_deposited = 0;
    pool.total_withdrawn = 0;
    pool.fee_collector = ctx.accounts.fee_collector.key();
    pool.bump = ctx.bumps.pool;

    msg!("Pool initialized: {:?}", asset_type);

    Ok(())
  }
}
