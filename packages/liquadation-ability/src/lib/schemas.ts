import { z } from 'zod';

export const KNOWN_ERRORS = {
  INVALID_CHAIN_ID: 'INVALID_CHAIN_ID',
  INVALID_VAULT_ADDRESS: 'INVALID_VAULT_ADDRESS',
  UNAUTHORIZED_PKP: 'UNAUTHORIZED_PKP',
  NOT_LIQUIDATABLE: 'NOT_LIQUIDATABLE',
  INSUFFICIENT_PYUSD: 'INSUFFICIENT_PYUSD',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
} as const;

export const abilityParamsSchema = z.object({
  vaultAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  userToLiquidate: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  desiredBurnAmount: z.string().regex(/^\d+$/),
  chainId: z.number(),
  rpcUrl: z.string().url(),
});

export const precheckSuccessSchema = z.object({
  pkpPyUsdBalance: z.string(),
  victimDebt: z.string(),
  isLiquidatable: z.boolean(),
  canLiquidateFully: z.boolean(),
  maxPossibleBurn: z.string(),
});

export const precheckFailSchema = z.object({
  reason: z.enum([
    KNOWN_ERRORS.INVALID_CHAIN_ID,
    KNOWN_ERRORS.INVALID_VAULT_ADDRESS,
    KNOWN_ERRORS.UNAUTHORIZED_PKP,
    KNOWN_ERRORS.NOT_LIQUIDATABLE,
    KNOWN_ERRORS.INSUFFICIENT_PYUSD,
  ]),
  error: z.string(),
});

export const executeSuccessSchema = z.object({
  txHashes: z.object({
    approve: z.string().optional(),
    deposit: z.string(),
    mint: z.string(),
    liquidate: z.string(),
  }),
  liquidatedAmount: z.string(),
  collateralSeized: z.string(),
  newPkpPyUsdBalance: z.string(),
  timestamp: z.number(),
});

export const executeFailSchema = z.object({
  reason: z.enum([
    KNOWN_ERRORS.INVALID_CHAIN_ID,
    KNOWN_ERRORS.INVALID_VAULT_ADDRESS,
    KNOWN_ERRORS.UNAUTHORIZED_PKP,
    KNOWN_ERRORS.NOT_LIQUIDATABLE,
    KNOWN_ERRORS.INSUFFICIENT_PYUSD,
    KNOWN_ERRORS.TRANSACTION_FAILED,
  ]),
  error: z.string(),
  partialTxHashes: z.array(z.string()).optional(),
});

export type AbilityParams = z.infer<typeof abilityParamsSchema>;
export type PrecheckSuccess = z.infer<typeof precheckSuccessSchema>;
export type PrecheckFail = z.infer<typeof precheckFailSchema>;
export type ExecuteSuccess = z.infer<typeof executeSuccessSchema>;
export type ExecuteFail = z.infer<typeof executeFailSchema>;