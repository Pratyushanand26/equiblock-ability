import { createVincentAbility } from '@lit-protocol/vincent-ability-sdk';
import { laUtils } from '@lit-protocol/vincent-scaffold-sdk';

import type { EthersType } from '../Lit';

import {
  abilityParamsSchema,
  executeFailSchema,
  executeSuccessSchema,
  KNOWN_ERRORS,
  precheckFailSchema,
  precheckSuccessSchema,
} from './schemas';
import {
  ALLOWED_CHAIN_ID,
  ALLOWED_PKP_ETH_ADDRESS,
  ALLOWED_VAULT_ADDRESS,
  PACKAGE_NAME,
  PYUSD_TOKEN_ADDRESS,
} from './constants';
import { ERC20_ABI, ORACLE_ABI, VAULT_ABI } from './abis';

declare const ethers: EthersType;

export const vincentAbility = createVincentAbility({
  packageName: PACKAGE_NAME as const,
  abilityParamsSchema,
  abilityDescription: 'Automated liquidation on EquiVault',
  
  precheckSuccessSchema,
  precheckFailSchema,
  executeSuccessSchema,
  executeFailSchema,
  
  precheck: async ({ abilityParams }, { fail, succeed, delegation }) => {
    try {
      const { vaultAddress, userToLiquidate, chainId, rpcUrl, desiredBurnAmount } = abilityParams;
      const pkpAddress = delegation.delegatorPkpInfo.ethAddress;
      
      // Validate chain
      if (chainId !== ALLOWED_CHAIN_ID) {
        return fail({
          reason: KNOWN_ERRORS.INVALID_CHAIN_ID,
          error: `Must use Sepolia (${ALLOWED_CHAIN_ID})`,
        });
      }
      
      // Validate vault
      if (vaultAddress.toLowerCase() !== ALLOWED_VAULT_ADDRESS.toLowerCase()) {
        return fail({
          reason: KNOWN_ERRORS.INVALID_VAULT_ADDRESS,
          error: `Invalid vault address`,
        });
      }
      
      // Validate PKP
      if (pkpAddress.toLowerCase() !== ALLOWED_PKP_ETH_ADDRESS.toLowerCase()) {
        return fail({
          reason: KNOWN_ERRORS.UNAUTHORIZED_PKP,
          error: `Unauthorized PKP`,
        });
      }
      
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
      const pyUsd = new ethers.Contract(PYUSD_TOKEN_ADDRESS, ERC20_ABI, provider);
      
      // Check if liquidatable
      const isLiquidatable = await vault.isLiquidatable(userToLiquidate);
      if (!isLiquidatable) {
        return fail({
          reason: KNOWN_ERRORS.NOT_LIQUIDATABLE,
          error: `User is not liquidatable`,
        });
      }
      
      // Get user debt
      const userPosition = await vault.getUserPosition(userToLiquidate);
      const victimDebt = userPosition.debt;
      
      // Get PKP pyUSD balance
      const pkpPyUsdBalance = await pyUsd.balanceOf(pkpAddress);
      
      // Get oracle price to calculate how much we can liquidate
      const oracleAddress = await vault.oracle();
      const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, provider);
      const assetPrice = await oracle.getPrice();
      
      // Calculate max we can liquidate with available pyUSD
      // Formula: maxBurn = (pyUsdBalance * 1e12 * 100) / (assetPrice * 500)
      const normalized = pkpPyUsdBalance.mul(ethers.BigNumber.from(10).pow(12));
      const maxBurn = normalized.mul(100).div(assetPrice.mul(5));
      
      const desired = ethers.BigNumber.from(desiredBurnAmount);
      const actualMax = maxBurn.lt(victimDebt) ? maxBurn : victimDebt;
      const finalBurn = desired.lt(actualMax) ? desired : actualMax;
      
      if (finalBurn.isZero()) {
        return fail({
          reason: KNOWN_ERRORS.INSUFFICIENT_PYUSD,
          error: `PKP has insufficient pyUSD`,
        });
      }
      
      const canLiquidateFully = finalBurn.gte(desired) && desired.lte(victimDebt);
      
      return succeed({
        pkpPyUsdBalance: pkpPyUsdBalance.toString(),
        victimDebt: victimDebt.toString(),
        isLiquidatable: true,
        canLiquidateFully,
        maxPossibleBurn: finalBurn.toString(),
      });
      
    } catch (error) {
      return fail({
        reason: KNOWN_ERRORS.INSUFFICIENT_PYUSD,
        error: `Precheck failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  },
  //@ts-ignore
  execute: async ({ abilityParams }, { succeed, fail, delegation }) => {
    const txHashes: any = {};
    
    try {
      const { vaultAddress, userToLiquidate, chainId, rpcUrl, desiredBurnAmount } = abilityParams;
      const { ethAddress: pkpAddress, publicKey: pkpPublicKey } = delegation.delegatorPkpInfo;
      
      // Validate
      if (chainId !== ALLOWED_CHAIN_ID) {
        return fail({ reason: KNOWN_ERRORS.INVALID_CHAIN_ID, error: 'Invalid chain' });
      }
      if (vaultAddress.toLowerCase() !== ALLOWED_VAULT_ADDRESS.toLowerCase()) {
        return fail({ reason: KNOWN_ERRORS.INVALID_VAULT_ADDRESS, error: 'Invalid vault' });
      }
      if (pkpAddress.toLowerCase() !== ALLOWED_PKP_ETH_ADDRESS.toLowerCase()) {
        return fail({ reason: KNOWN_ERRORS.UNAUTHORIZED_PKP, error: 'Unauthorized PKP' });
      }
      
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
      const pyUsd = new ethers.Contract(PYUSD_TOKEN_ADDRESS, ERC20_ABI, provider);
      
      // Check still liquidatable
      const isLiquidatable = await vault.isLiquidatable(userToLiquidate);
      if (!isLiquidatable) {
        return fail({ reason: KNOWN_ERRORS.NOT_LIQUIDATABLE, error: 'No longer liquidatable' });
      }
      
      // Get oracle price
      const oracleAddress = await vault.oracle();
      const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, provider);
      const assetPrice = await oracle.getPrice();
      
      // Calculate pyUSD needed for desired burn
      // pyUsdNeeded = (burnAmount * assetPrice * 5) / 1e18, then denormalize
      const burnAmount = ethers.BigNumber.from(desiredBurnAmount);
      const normalizedNeeded = burnAmount.mul(assetPrice).mul(5).div(ethers.utils.parseEther('1'));
      const pyUsdNeeded = normalizedNeeded.div(ethers.BigNumber.from(10).pow(12));
      
      // Check balance
      const pkpBalance = await pyUsd.balanceOf(pkpAddress);
      if (pkpBalance.lt(pyUsdNeeded)) {
        return fail({ reason: KNOWN_ERRORS.INSUFFICIENT_PYUSD, error: 'Insufficient pyUSD' });
      }
      
      // 1. Approve
      const allowance = await pyUsd.allowance(pkpAddress, vaultAddress);
      if (allowance.lt(pyUsdNeeded)) {
        const approveTx = await laUtils.transaction.handler.contractCall({
          provider,
          pkpPublicKey,
          contractAddress: PYUSD_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          functionParams: [vaultAddress, pyUsdNeeded.mul(2).toString()],
        });
        txHashes.approve = approveTx;
      }
      
      // 2. Deposit
      const depositTx = await laUtils.transaction.handler.contractCall({
        provider,
        pkpPublicKey,
        contractAddress: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'depositCollateral',
        functionParams: [pyUsdNeeded.toString()],
      });
      txHashes.deposit = depositTx;
      
      // 3. Mint
      const mintTx = await laUtils.transaction.handler.contractCall({
        provider,
        pkpPublicKey,
        contractAddress: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'mintEquiAsset',
        functionParams: [burnAmount.toString()],
      });
      txHashes.mint = mintTx;
      
      // 4. Liquidate
      const liquidateTx = await laUtils.transaction.handler.contractCall({
        provider,
        pkpPublicKey,
        contractAddress: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'liquidate',
        functionParams: [userToLiquidate, burnAmount.toString()],
      });
      txHashes.liquidate = liquidateTx;
      
      // Get final balance
      const newBalance = await pyUsd.balanceOf(pkpAddress);
      
      // Calculate seized (simple: newBalance - (oldBalance - pyUsdNeeded))
      const seized = newBalance.sub(pkpBalance.sub(pyUsdNeeded));
      
      return succeed({
        txHashes,
        liquidatedAmount: burnAmount.toString(),
        collateralSeized: seized.toString(),
        newPkpPyUsdBalance: newBalance.toString(),
        timestamp: Date.now(),
      });
      
    } catch (error) {
      const partial = Object.values(txHashes).filter(Boolean) as string[];
      return fail({
        reason: KNOWN_ERRORS.TRANSACTION_FAILED,
        error: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        partialTxHashes: partial.length > 0 ? partial : undefined,
      });
    }
  },
});