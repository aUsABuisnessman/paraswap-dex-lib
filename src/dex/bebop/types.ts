import { SwapSide } from '../../constants';
import { RequestHeaders } from '../../dex-helper';

export type BebopRateFetcherConfig = {
  rateConfig: {
    pricesReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    tokensReqParams: {
      url: string;
      headers?: RequestHeaders;
      params?: any;
    };
    tokensIntervalMs: number;
    pricesCacheKey: string;
    tokensAddrCacheKey: string;
    tokensCacheKey: string;
    pricesCacheTTLSecs: number;
    tokensCacheTTLSecs: number;
  };
};

export type TokenDataMap = { [index: string]: BebopToken };

export type BebopToken = {
  decimals: number;
  contractAddress: string;
  ticker: string;
};

export type BebopTokensResponse = {
  tokens: { [symbol: string]: BebopToken };
};

export type BebopLevel = [price: number, size: number];

export type BebopPair = {
  bids: BebopLevel[];
  asks: BebopLevel[];
  last_update_ts: number;
};

export type BebopPricingResponse = {
  [pair: string]: BebopPair;
};

export type PoolState = {
  // TODO: poolState is the state of event
  // subscriber. This should be the minimum
  // set of parameters required to compute
  // pool prices. Complete me!
};

export interface BebopTx {
  to: string;
  value: string;
  data: string;
  from: string;
  gas: number;
}

export type BebopTokenAmount = {
  amount: string;
  priceUsd: number;
};

// For now nothing but we may have to add something
export type BebopData = {
  expiry?: number;
  buyTokens?: { [address: string]: BebopTokenAmount };
  sellTokens?: { [address: string]: BebopTokenAmount };
  tx?: BebopTx;
};

export type DexParams = {
  // TODO: DexParams is set of parameters the can
  // be used to initiate a DEX fork.
  // Complete me!
  settlementAddress: string;
  chainName: string;
  middleTokens: string[];
};

export type RoutingInstruction = {
  side: SwapSide; // Buy for bids, Sell for asks
  book: BebopPair;
  pair: string;
  targetQuote: boolean;
};
