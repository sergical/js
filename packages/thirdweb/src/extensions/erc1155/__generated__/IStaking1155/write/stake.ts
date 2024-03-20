import type { AbiParameterToPrimitiveType } from "abitype";
import type { BaseTransactionOptions } from "../../../../../transaction/types.js";
import { prepareContractCall } from "../../../../../transaction/prepare-contract-call.js";
import type { Prettify } from "../../../../../utils/type-utils.js";
import { encodeAbiParameters } from "../../../../../utils/abi/encodeAbiParameters.js";

/**
 * Represents the parameters for the "stake" function.
 */

type StakeParamsInternal = {
  tokenId: AbiParameterToPrimitiveType<{ type: "uint256"; name: "tokenId" }>;
  amount: AbiParameterToPrimitiveType<{ type: "uint64"; name: "amount" }>;
};

export type StakeParams = Prettify<
  | StakeParamsInternal
  | {
      asyncParams: () => Promise<StakeParamsInternal>;
    }
>;
const FN_SELECTOR = "0x952e68cf" as const;
const FN_INPUTS = [
  {
    type: "uint256",
    name: "tokenId",
  },
  {
    type: "uint64",
    name: "amount",
  },
] as const;
const FN_OUTPUTS = [] as const;

/**
 * Encodes the parameters for the "stake" function.
 * @param options - The options for the stake function.
 * @returns The encoded ABI parameters.
 * @extension ERC1155
 * @example
 * ```
 * import { encodeStakeParams } "thirdweb/extensions/erc1155";
 * const result = encodeStakeParams({
 *  tokenId: ...,
 *  amount: ...,
 * });
 * ```
 */
export function encodeStakeParams(options: StakeParamsInternal) {
  return encodeAbiParameters(FN_INPUTS, [options.tokenId, options.amount]);
}

/**
 * Calls the "stake" function on the contract.
 * @param options - The options for the "stake" function.
 * @returns A prepared transaction object.
 * @extension ERC1155
 * @example
 * ```
 * import { stake } from "thirdweb/extensions/erc1155";
 *
 * const transaction = stake({
 *  tokenId: ...,
 *  amount: ...,
 * });
 *
 * // Send the transaction
 * ...
 *
 * ```
 */
export function stake(options: BaseTransactionOptions<StakeParams>) {
  return prepareContractCall({
    contract: options.contract,
    method: [FN_SELECTOR, FN_INPUTS, FN_OUTPUTS] as const,
    params:
      "asyncParams" in options
        ? async () => {
            const resolvedParams = await options.asyncParams();
            return [resolvedParams.tokenId, resolvedParams.amount] as const;
          }
        : [options.tokenId, options.amount],
  });
}
