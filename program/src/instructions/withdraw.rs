use anchor_lang::prelude::*;

use anchor_spl::{
  associated_token::AssociatedToken,
  token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
  constants::ADMIN_ADDRESS,
  state::{AssetType, Pool, Vault},
  utils::error::MixoorErrorCode,
};

/*
 * NOTE: This should be used sparingly and ideally not exist.
 *
 *
 */
#[derive(Accounts)]
pub struct Withdraw<'info> {
  #[account(
    address = ADMIN_ADDRESS,
    mut
  )]
  pub authority: Signer<'info>,

  #[account(mut)]
  pub pool: AccountLoader<'info, Pool>,

  #[account(
    mut,
    seeds = [b"vault", pool.key().as_ref()],
    bump
  )]
  pub vault: Account<'info, Vault>,

  #[account(
    associated_token::mint = mint,
    associated_token::authority = vault,
    associated_token::token_program = token_program
  )]
  pub vault_ata: InterfaceAccount<'info, TokenAccount>,

  /// CHECK: we initialize the account ourselves if not exists
  #[account(mut)]
  pub authority_token_account: Option<UncheckedAccount<'info>>,

  #[account(mut)]
  pub mint: InterfaceAccount<'info, Mint>,

  pub system_program: Program<'info, System>,

  pub token_program: Interface<'info, TokenInterface>,

  pub associated_token_program: Program<'info, AssociatedToken>,
}

impl Withdraw<'_> {
  pub fn validate(&self, amount: u64) -> Result<()> {
    let pool = &self.pool.load()?;
    let vault_balance = self.vault.get_lamports();

    // amount check
    require!(amount > 0, MixoorErrorCode::InvalidAmount);

    // pool address check
    require_eq!(pool.mint, self.mint.key(), MixoorErrorCode::InvalidMint);

    match AssetType::from_u8(pool.asset_type).unwrap() {
      AssetType::Sol => {
        // check that we don't close account by emptying vault account
        let rent = Rent::get()?.minimum_balance(Vault::LEN);
        let bal = vault_balance
          .checked_sub(amount)
          .ok_or(MixoorErrorCode::InsufficientFunds)?; // balance after withdrawing amount
        require_gt!(rent, bal, MixoorErrorCode::InsufficientFunds);

        // solvency check
        require_gte!(vault_balance, amount, MixoorErrorCode::InvalidAmount);
      }
      AssetType::SplToken => {
        let vault_ata_balance = self.vault_ata.amount;

        // solvency check
        require_gte!(vault_ata_balance, amount, MixoorErrorCode::InvalidAmount);
      }
    }

    Ok(())
  }

  #[access_control(ctx.accounts.validate(amount))]
  pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    let pool_key = ctx.accounts.pool.key();

    let vault_bump = ctx.bumps.vault;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", pool_key.as_ref(), &[vault_bump]]];

    // safe to unwrap since the pool acc cannot be initialized with an empty field
    let asset_type = AssetType::from_u8(pool.asset_type).unwrap();

    match asset_type {
      AssetType::Sol => {
        // withdraw from vault
        ctx.accounts.vault.sub_lamports(amount)?;
        ctx.accounts.authority.add_lamports(amount)?;
      }
      AssetType::SplToken => {
        let vault_token_account = ctx.accounts.vault_ata.to_account_info();
        let mint = ctx.accounts.mint.clone();
        let cpi_program = ctx.accounts.token_program.clone();
        let authority_token_account = ctx
          .accounts
          .authority_token_account
          .as_ref()
          .ok_or(MixoorErrorCode::MissingTokenAccount)?;

        if authority_token_account.data_is_empty() {
          let cpi_accounts = anchor_spl::associated_token::Create {
            payer: ctx.accounts.authority.to_account_info(),
            associated_token: authority_token_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
            mint: mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
          };

          let cpi_ctx = CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            cpi_accounts,
          );
          anchor_spl::associated_token::create(cpi_ctx)?;
        }

        // To admin
        let recipient_cpi_accounts = TransferChecked {
          from: vault_token_account.to_account_info().clone(),
          mint: mint.to_account_info().clone(),
          to: authority_token_account.to_account_info(),
          authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
          cpi_program.to_account_info(),
          recipient_cpi_accounts,
          signer_seeds,
        );
        token_interface::transfer_checked(cpi_context, amount, mint.decimals)?;
      }
    }

    pool.total_withdrawn = pool
      .total_withdrawn
      .checked_add(amount)
      .ok_or(MixoorErrorCode::Overflow)?;

    Ok(())
  }
}
