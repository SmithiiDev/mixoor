use anchor_lang::prelude::*;
use anchor_spl::{
  associated_token::AssociatedToken,
  token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
  constants::{PROTOCOL_FEE_BPS, RELAYER_ADDRESS, TREASURY_ADDRESS},
  helpers::validate_public_inputs,
  state::*,
  utils::error::MixoorErrorCode,
  verifier::verify_groth16_proof,
};

#[derive(Accounts)]
#[instruction(proof: ProofData,root: [u8; 32],nullifier_hash: [u8; 32],)]
pub struct Transfer<'info> {
  #[account(
    mut,
    address = RELAYER_ADDRESS @ MixoorErrorCode::Unauthorized
  )]
  pub relayer: Signer<'info>,

  #[account(mut)]
  pub pool: AccountLoader<'info, Pool>,

  #[account(mut)]
  pub mint: InterfaceAccount<'info, Mint>,

  /// CHECK: Vault PDA
  #[account(
    mut,
    seeds = [b"vault", pool.key().as_ref()],
    bump
  )]
  pub vault: UncheckedAccount<'info>,

  #[account(
    init,
    payer = relayer,
    space = 8 + 32 + 8,
    seeds = [b"nullifier", pool.key().as_ref(), nullifier_hash.as_ref()],
    bump
  )]
  pub nullifier: Account<'info, NullifierAccount>,

  /// CHECK: allow non-system program accounts
  #[account(mut)]
  pub recipient: UncheckedAccount<'info>,

  #[account(
    mut,
    constraint = vault_token_account.owner == vault.key()
  )]
  pub vault_token_account: Option<InterfaceAccount<'info, TokenAccount>>,

  /// CHECK: we initialize the account ourselves if not exists
  #[account(mut)]
  pub recipient_token_account: Option<UncheckedAccount<'info>>,

  /// CHECK: Fee collector
  #[account(
    mut,
    address = TREASURY_ADDRESS
  )]
  pub fee_collector: UncheckedAccount<'info>,

  /// CHECK: we initialize the account ourselves if not exists
  #[account(mut)]
  pub fee_collector_token_account: Option<UncheckedAccount<'info>>,

  pub system_program: Program<'info, System>,

  pub token_program: Interface<'info, TokenInterface>,

  pub associated_token_program: Program<'info, AssociatedToken>,
}

impl Transfer<'_> {
  pub fn validate(&self, root: [u8; 32]) -> Result<()> {
    let pool = &self.pool.load()?;

    // Verify root is in history
    require!(pool.is_known_root(&root), MixoorErrorCode::UnknownRoot);

    // asset type check
    let asset_type = AssetType::from_u8(pool.asset_type);
    require!(asset_type.is_some(), MixoorErrorCode::InvalidAssetType);

    // pool address check
    require_eq!(pool.mint, self.mint.key(), MixoorErrorCode::InvalidMint);

    // token account check
    if let Some(token_acc) = self.vault_token_account.as_ref() {
      require_eq!(
        token_acc.mint,
        self.mint.key(),
        MixoorErrorCode::InvalidMint
      );
    };

    Ok(())
  }

  #[access_control(ctx.accounts.validate(public_inputs[0]))]
  pub fn transfer(
    ctx: Context<Transfer>,
    proof: ProofData,
    public_inputs: [[u8; 32]; 7],
    nullifier_hash: [u8; 32], // Still needed for PDA derivation
    relayer_fee: u64,
    recipient_amount: u64,
  ) -> Result<()> {
    let pool_key = ctx.accounts.pool.key();
    let pool = &mut ctx.accounts.pool.load_mut()?;

    // Validate all public inputs match instruction parameters
    validate_public_inputs(
      &public_inputs,
      public_inputs[0],
      nullifier_hash,
      &ctx.accounts.recipient.key(),
      &ctx.accounts.relayer.key(),
      relayer_fee,
      recipient_amount,
      &pool_key,
    )?;

    // Calculate protocol fee from the proven recipient_amount
    // The circuit has already proven that deposit_amount >= relayer_fee + recipient_amount
    let protocol_fee = recipient_amount
      .checked_mul(PROTOCOL_FEE_BPS)
      .ok_or(MixoorErrorCode::Overflow)?
      .checked_div(10000)
      .ok_or(MixoorErrorCode::Overflow)?;

    // Final amount after protocol fee
    let final_recipient_amount = recipient_amount
      .checked_sub(protocol_fee)
      .ok_or(MixoorErrorCode::InsufficientFunds)?;

    require!(
      verify_groth16_proof(proof, public_inputs.to_vec())?,
      MixoorErrorCode::InvalidProof
    );

    // Mark nullifier as spent
    let nullifier = &mut ctx.accounts.nullifier;
    nullifier.nullifier_hash = nullifier_hash;
    nullifier.spent_at = Clock::get()?.unix_timestamp;

    let vault_bump = ctx.bumps.vault;
    let signer_seeds: &[&[&[u8]]] = &[&[b"vault", pool_key.as_ref(), &[vault_bump]]];

    // safe to unwrap since we checked in `validate`
    let asset_type = AssetType::from_u8(pool.asset_type).unwrap();

    match asset_type {
      AssetType::Sol => {
        // To recipient (after protocol fee)
        ctx.accounts.vault.sub_lamports(final_recipient_amount)?;
        ctx
          .accounts
          .recipient
          .add_lamports(final_recipient_amount)?;

        // Protocol fee
        ctx.accounts.vault.sub_lamports(protocol_fee)?;
        ctx.accounts.fee_collector.add_lamports(protocol_fee)?;
      }
      AssetType::SplToken => {
        let vault_token_account = ctx
          .accounts
          .vault_token_account
          .as_ref()
          .ok_or(MixoorErrorCode::MissingTokenAccount)?;
        let fee_collector_token_account = ctx
          .accounts
          .fee_collector_token_account
          .as_ref()
          .ok_or(MixoorErrorCode::MissingTokenAccount)?;
        let recipient_token_account = ctx
          .accounts
          .recipient_token_account
          .as_ref()
          .ok_or(MixoorErrorCode::MissingTokenAccount)?;
        let mint = ctx.accounts.mint.clone();
        let cpi_program = ctx.accounts.token_program.clone();

        // check if token accounts exist else initialize
        if recipient_token_account.data_is_empty() {
          let cpi_accounts = anchor_spl::associated_token::Create {
            payer: ctx.accounts.relayer.to_account_info(),
            associated_token: recipient_token_account.to_account_info(),
            authority: ctx.accounts.recipient.to_account_info(),
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

        if fee_collector_token_account.data_is_empty() {
          let cpi_accounts = anchor_spl::associated_token::Create {
            payer: ctx.accounts.relayer.to_account_info(),
            associated_token: fee_collector_token_account.to_account_info(),
            authority: ctx.accounts.fee_collector.to_account_info(),
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

        // transfer to recipient (after protocol fee)
        let recipient_cpi_accounts = TransferChecked {
          from: vault_token_account.to_account_info().clone(),
          mint: mint.to_account_info().clone(),
          to: recipient_token_account.to_account_info(),
          authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
          cpi_program.to_account_info(),
          recipient_cpi_accounts,
          signer_seeds,
        );
        token_interface::transfer_checked(cpi_context, final_recipient_amount, mint.decimals)?;

        // transfer to fee collector
        let fee_collector_cpi_accounts = TransferChecked {
          from: vault_token_account.to_account_info().clone(),
          mint: mint.to_account_info().clone(),
          to: fee_collector_token_account.to_account_info(),
          authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
          cpi_program.to_account_info(),
          fee_collector_cpi_accounts,
          signer_seeds,
        );
        token_interface::transfer_checked(cpi_context, protocol_fee, mint.decimals)?;
      }
    }

    // Track total amount transferred through the protocol
    pool.total_withdrawn = pool
      .total_withdrawn
      .checked_add(recipient_amount)
      .ok_or(MixoorErrorCode::Overflow)?;

    Ok(())
  }
}
