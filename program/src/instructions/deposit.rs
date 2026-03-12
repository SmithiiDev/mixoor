use anchor_lang::prelude::*;
use anchor_lang::system_program;

use anchor_spl::{
  associated_token::AssociatedToken,
  token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::constants::MAX_TREE_LEAVES;
use crate::constants::MIN_SOL_DEPOSIT_AMOUNT;
use crate::state::*;
use crate::utils::error::MixoorErrorCode;

#[derive(Accounts)]
pub struct Deposit<'info> {
  #[account(mut)]
  pub depositor: Signer<'info>,

  #[account(mut)]
  pub pool: AccountLoader<'info, Pool>,

  #[account(mut)]
  pub mint: InterfaceAccount<'info, Mint>,

  #[account(
    mut,
    seeds = [b"vault", pool.key().as_ref()],
    bump
  )]
  pub vault: Account<'info, Vault>,

  #[account(
    mut,
    constraint = depositor_token_account.owner == depositor.key()
  )]
  pub depositor_token_account: Option<InterfaceAccount<'info, TokenAccount>>,

  #[account(
    mut,
    constraint = vault_token_account.owner == vault.key()
  )]
  pub vault_token_account: Option<InterfaceAccount<'info, TokenAccount>>,

  pub system_program: Program<'info, System>,

  pub token_program: Interface<'info, TokenInterface>,

  pub associated_token_program: Program<'info, AssociatedToken>,
}

impl Deposit<'_> {
  pub fn validate(&self, amount: u64) -> Result<()> {
    let pool = &self.pool.load()?;

    // amount check
    require!(amount > 0, MixoorErrorCode::InvalidAmount);

    // pool address check
    require_eq!(pool.mint, self.mint.key(), MixoorErrorCode::InvalidMint);

    // asset type check
    let asset_type = AssetType::from_u8(pool.asset_type);
    require!(asset_type.is_some(), MixoorErrorCode::InvalidAssetType);

    // token account check
    if let Some(token_acc) = self.vault_token_account.as_ref() {
      require_eq!(
        token_acc.mint,
        self.mint.key(),
        MixoorErrorCode::InvalidMint
      );
    };

    // min amount validation
    match asset_type.unwrap() {
      AssetType::Sol => require!(
        amount >= MIN_SOL_DEPOSIT_AMOUNT,
        MixoorErrorCode::DepositTooSmall
      ),
      // 10 tokens regardless of decimals
      AssetType::SplToken => require!(
        amount >= 10u64 * 10u64.pow(self.mint.decimals as u32),
        MixoorErrorCode::DepositTooSmall
      ),
    }

    // Enforce tree capacity (depth 20 = 2^20 leaves)
    require!(
      pool.next_leaf_index < MAX_TREE_LEAVES,
      MixoorErrorCode::MerkleTreeFull
    );

    Ok(())
  }

  #[access_control(ctx.accounts.validate(amount))]
  pub fn deposit(
    ctx: Context<Deposit>,
    amount: u64,
    commitment: [u8; 32],
    new_root: [u8; 32],
  ) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    // NOTE: safe to unwrap since we checked this in validate
    let asset_type = AssetType::from_u8(pool.asset_type).unwrap();

    // Transfer funds to vault
    match asset_type {
      AssetType::Sol => {
        let cpi_accounts = system_program::Transfer {
          from: ctx.accounts.depositor.to_account_info(),
          to: ctx.accounts.vault.to_account_info(),
        };

        let cpi_program = ctx.accounts.system_program.to_account_info();
        let cpi_context = CpiContext::new(cpi_program, cpi_accounts);

        system_program::transfer(cpi_context, amount)?;
      }
      AssetType::SplToken => {
        let depositor_token = ctx
          .accounts
          .depositor_token_account
          .as_ref()
          .ok_or(MixoorErrorCode::MissingTokenAccount)?;
        let vault_token = ctx
          .accounts
          .vault_token_account
          .as_ref()
          .ok_or(MixoorErrorCode::MissingTokenAccount)?;
        let mint = ctx.accounts.mint.clone();

        let cpi_accounts = TransferChecked {
          from: depositor_token.to_account_info().clone(),
          mint: mint.to_account_info().clone(),
          to: vault_token.to_account_info().clone(),
          authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_context = CpiContext::new(cpi_program, cpi_accounts);
        token_interface::transfer_checked(cpi_context, amount, mint.decimals)?;
      }
    }

    // Emit commitment event (users will build Merkle tree from events)
    let leaf_index = pool.next_leaf_index;

    emit!(CommitmentInserted {
      commitment,
      leaf_index,
      pool: ctx.accounts.pool.key(),
    });

    pool.next_leaf_index = pool
      .next_leaf_index
      .checked_add(1)
      .ok_or(MixoorErrorCode::Overflow)?;

    pool.total_deposited = pool
      .total_deposited
      .checked_add(amount)
      .ok_or(MixoorErrorCode::Overflow)?;

    // Add the new root to history
    pool.add_root(new_root, &Clock::get()?)?;

    Ok(())
  }
}
