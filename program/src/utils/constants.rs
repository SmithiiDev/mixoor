use anchor_lang::prelude::*;

// #[constant]
pub const MAX_DEPTH: u32 = 20;

#[constant]
pub const MAX_BUFFER_SIZE: u32 = 64;

#[constant]
pub const PROTOCOL_FEE_BPS: u64 = 15; // 0.15%

#[constant]
pub const MIN_SOL_DEPOSIT_AMOUNT: u64 = 50_000_000; // 0.05 SOL

#[constant]
#[cfg(feature = "devnet")]
pub const TREASURY_ADDRESS: Pubkey = pubkey!("4kg8oh3jdNtn7j2wcS7TrUua31AgbLzDVkBZgTAe44aF");

#[constant]
#[cfg(not(feature = "devnet"))]
pub const TREASURY_ADDRESS: Pubkey = pubkey!("9qX97Bd8dvHAknHVjCxz4uEJcPSE3NGjjgniMVdDBu6d");

#[constant]
#[cfg(feature = "devnet")]
pub const ADMIN_ADDRESS: Pubkey = pubkey!("4kg8oh3jdNtn7j2wcS7TrUua31AgbLzDVkBZgTAe44aF");

#[constant]
#[cfg(not(feature = "devnet"))]
pub const ADMIN_ADDRESS: Pubkey = pubkey!("AdUKMLxLi18EfLqLFQvDaizXmvGoDFaNQfQU681vbTje");

#[constant]
#[cfg(feature = "devnet")]
pub const RELAYER_ADDRESS: Pubkey = pubkey!("re1R63DiMLtDyHMAS1ohszqfFTHcF9Q3uEXSYdHzHWU");

#[constant]
#[cfg(not(feature = "devnet"))]
pub const RELAYER_ADDRESS: Pubkey = pubkey!("re1R63DiMLtDyHMAS1ohszqfFTHcF9Q3uEXSYdHzHWU");

// how large our circuits allow the tree to get
pub const MAX_TREE_DEPTH: u32 = 20;
pub const MAX_TREE_LEAVES: u32 = 1 << MAX_TREE_DEPTH; // 1,048,576
