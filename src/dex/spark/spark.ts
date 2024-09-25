import { SimpleExchange } from '../simple-exchange';
import { Context, IDex } from '../idex';
import {
  SparkParams,
  SparkData,
  SparkSDaiFunctions,
  SparkSDaiPoolState,
} from './types';
import { Network, SwapSide } from '../../constants';
import { getDexKeysWithNetwork } from '../../utils';
import { Adapters, SDaiConfig } from './config';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  Logger,
  NumberAsString,
  PoolLiquidity,
  PoolPrices,
  SimpleExchangeParam,
  Token,
} from '../../types';
import { IDexHelper } from '../../dex-helper';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import PotAbi from '../../abi/maker-psm/pot.json';
import SavingsDaiAbi from '../../abi/sdai/SavingsDai.abi.json';
import { Interface } from 'ethers/lib/utils';
import { calcChi, RAY, SparkSDaiEventPool } from './spark-sdai-pool';
import { BI_POWS } from '../../bigint-constants';
import { SDAI_DEPOSIT_GAS_COST, SDAI_REDEEM_GAS_COST } from './constants';
import { extractReturnAmountPosition } from '../../executor/utils';

export class Spark
  extends SimpleExchange
  implements IDex<SparkData, SparkParams>
{
  readonly hasConstantPriceLargeAmounts = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(SDaiConfig);

  public readonly eventPool: SparkSDaiEventPool;
  logger: Logger;

  constructor(
    protected network: Network,
    dexKey: string,
    readonly dexHelper: IDexHelper,

    readonly daiAddress: string = SDaiConfig[dexKey][network].daiAddress,
    readonly sdaiAddress: string = SDaiConfig[dexKey][network].sdaiAddress,
    readonly potAddress: string = SDaiConfig[dexKey][network].potAddress,
    readonly abiInterface: Interface = SDaiConfig[dexKey][network]
      .poolInterface,

    protected adapters = Adapters[network] || {},
    protected sdaiInterface = new Interface(SavingsDaiAbi),
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPool = new SparkSDaiEventPool(
      this.dexKey,
      this.network,
      `${this.daiAddress}_${this.sdaiAddress}`,
      dexHelper,
      this.potAddress,
      this.abiInterface,
      this.logger,
      SDaiConfig[dexKey][network].savingsRate.topic,
      SDaiConfig[dexKey][network].savingsRate.symbol,
    );
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] || null;
  }

  isSDai(tokenAddress: Address) {
    return this.sdaiAddress.toLowerCase() === tokenAddress.toLowerCase();
  }

  isDai(tokenAddress: Address) {
    return this.daiAddress.toLowerCase() === tokenAddress.toLowerCase();
  }

  isAppropriatePair(srcToken: Token, destToken: Token) {
    return (
      (this.isDai(srcToken.address) && this.isSDai(destToken.address)) ||
      (this.isDai(destToken.address) && this.isSDai(srcToken.address))
    );
  }

  async initializePricing(blockNumber: number) {
    await this.eventPool.initialize(blockNumber);
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    return this.isAppropriatePair(srcToken, destToken)
      ? [`${this.dexKey}_${this.sdaiAddress}`]
      : [];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<SparkData>> {
    if (!this.isAppropriatePair(srcToken, destToken)) return null;
    const state = this.eventPool.getState(blockNumber);
    if (!state) return null;

    const isSrcAsset = this.isDai(srcToken.address);

    let calcFunction: Function;

    if (side === SwapSide.SELL) {
      if (isSrcAsset) {
        calcFunction = this.previewDeposit.bind(this);
      } else {
        calcFunction = this.previewRedeem.bind(this);
      }
    } else {
      if (isSrcAsset) {
        calcFunction = this.previewMint.bind(this);
      } else {
        calcFunction = this.previewWithdraw.bind(this);
      }
    }

    const timestamp = +(await this.dexHelper.provider.getBlock(blockNumber))
      .timestamp;
    // const timestamp = Math.floor(Date.now() / 1000);

    return [
      {
        prices: amounts.map(amount => calcFunction(amount, state, timestamp)),
        unit: BI_POWS[18],
        gasCost: SDAI_DEPOSIT_GAS_COST,
        exchange: this.dexKey,
        data: { exchange: `${this.sdaiAddress}` },
        poolAddresses: [`${this.sdaiAddress}`],
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<SparkData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.isDai(tokenAddress) && !this.isSDai(tokenAddress)) return [];

    return [
      {
        exchange: this.dexKey,
        address: this.sdaiAddress,
        connectorTokens: [
          {
            decimals: 18,
            address: this.isDai(tokenAddress)
              ? this.sdaiAddress
              : this.daiAddress,
          },
        ],
        liquidityUSD: 1000000000, // Just returning a big number so this DEX will be preferred
      },
    ];
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SparkData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const isSell = side === SwapSide.SELL;
    const { exchange } = data;

    let swapData: string;
    if (this.isDai(srcToken)) {
      swapData = this.sdaiInterface.encodeFunctionData(
        isSell ? SparkSDaiFunctions.deposit : SparkSDaiFunctions.mint,
        [isSell ? srcAmount : destAmount, this.augustusAddress],
      );
    } else {
      swapData = this.sdaiInterface.encodeFunctionData(
        isSell ? SparkSDaiFunctions.redeem : SparkSDaiFunctions.withdraw,
        [
          isSell ? srcAmount : destAmount,
          this.augustusAddress,
          this.augustusAddress,
        ],
      );
    }

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      exchange,
      undefined,
      undefined,
      undefined,
      isSell && this.isDai(destToken),
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: SparkData,
    side: SwapSide,
    _: Context,
    executorAddress: Address,
  ): DexExchangeParam {
    const isSell = side === SwapSide.SELL;
    const { exchange } = data;

    let swapData: string;
    if (this.isDai(srcToken)) {
      swapData = this.sdaiInterface.encodeFunctionData(
        isSell ? SparkSDaiFunctions.deposit : SparkSDaiFunctions.mint,
        [isSell ? srcAmount : destAmount, recipient],
      );
    } else {
      swapData = this.sdaiInterface.encodeFunctionData(
        isSell ? SparkSDaiFunctions.redeem : SparkSDaiFunctions.withdraw,
        [isSell ? srcAmount : destAmount, recipient, executorAddress],
      );
    }

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos: isSell
        ? extractReturnAmountPosition(
            this.sdaiInterface,
            this.isDai(srcToken)
              ? SparkSDaiFunctions.deposit
              : SparkSDaiFunctions.redeem,
            this.isDai(srcToken) ? 'shares' : 'assets',
          )
        : undefined,
      skipApproval: isSell && this.isDai(destToken),
    };
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SparkData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { exchange } = data;

    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          toStaked: 'bool',
        },
      },
      {
        toStaked: this.isDai(srcToken),
      },
    );

    return {
      targetExchange: exchange,
      payload,
      networkFee: '0',
    };
  }

  previewRedeem(
    shares: bigint,
    state: SparkSDaiPoolState,
    blockTimestamp: number,
  ) {
    return (shares * calcChi(state, blockTimestamp)) / RAY;
  }

  previewMint(
    shares: bigint,
    state: SparkSDaiPoolState,
    blockTimestamp: number,
  ) {
    return this.divUp(shares * calcChi(state, blockTimestamp), RAY);
  }

  previewWithdraw(
    assets: bigint,
    state: SparkSDaiPoolState,
    blockTimestamp: number,
  ) {
    return this.divUp(assets * RAY, calcChi(state, blockTimestamp));
  }

  previewDeposit(
    assets: bigint,
    state: SparkSDaiPoolState,
    blockTimestamp: number,
  ) {
    return (assets * RAY) / calcChi(state, blockTimestamp);
  }

  divUp(x: bigint, y: bigint): bigint {
    return x !== 0n ? (x - 1n) / y + 1n : 0n;
  }
}
