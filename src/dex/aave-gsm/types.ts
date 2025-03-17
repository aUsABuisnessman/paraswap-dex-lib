import { Address } from '../../types';

export type PoolState = {
  blockNumber: number;
  buyFee: bigint;
  sellFee: bigint;
  underlyingLiquidity: bigint;
  isFrozen: boolean;
  isSeized: boolean;
  exposureCap: bigint;
  rate: bigint;
};

export type AaveGsmData = {
  // returned by the API that can be used for
  // tx building. The data structure should be minimal.
  exchange: Address;
};

export type DexParams = {
  GSM_USDT: string;
  GSM_USDC: string;
  waEthUSDT: string;
  waEthUSDC: string;
  GHO: string;
};
