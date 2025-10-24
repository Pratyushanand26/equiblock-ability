export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

export const VAULT_ABI = [
  'function getUserPosition(address user) view returns (uint256 collateral, uint256 debt, uint256 collateralRatio, bool liquidatable)',
  'function isLiquidatable(address user) view returns (bool)',
  'function oracle() view returns (address)',
  'function depositCollateral(uint256 amountPYUSD)',
  'function mintEquiAsset(uint256 amountToMint)',
  'function liquidate(address user, uint256 amountToBurn)',
];

export const ORACLE_ABI = [
  'function getPrice() view returns (uint256)',
];