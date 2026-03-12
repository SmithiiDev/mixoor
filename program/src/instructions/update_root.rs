/*
 *
 * There's this issue when concurrency happens, e.g 10 users deposit simultaneously
 * a race condition occurs and while the deposits are successful, each will have a diff
 * merkle root from each other and the backend will fail because if the 10 users built
 * 80 + 1 roots and the BE see that 10 deposits happens i.e 80 + 10, it won't arrive with the same root
 * hence we call update root after the tx lands in the BE
 *
 */

use anchor_lang::prelude::*;

use crate::{constants::RELAYER_ADDRESS, state::Pool, utils::error::MixoorErrorCode};

#[derive(Accounts)]
#[instruction(root: u8)]
pub struct UpdateRoot<'info> {
  #[account(
    mut,
    address = RELAYER_ADDRESS @ MixoorErrorCode::Unauthorized
  )]
  pub relayer: Signer<'info>,

  #[account(mut)]
  pub pool: AccountLoader<'info, Pool>,
}

impl UpdateRoot<'_> {
  pub fn validate(&self) -> Result<()> {
    Ok(())
  }

  #[access_control(ctx.accounts.validate())]
  pub fn update_root_history(ctx: Context<UpdateRoot>, root: [u8; 32]) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    pool.add_root(root, &Clock::get()?)?;

    Ok(())
  }
}
