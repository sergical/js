import type { AbiConstructor, AbiFunction } from "abitype";
import type { Chain } from "../../chains/types.js";
import type { ThirdwebClient } from "../../client/client.js";
import { getContract } from "../../contract/contract.js";
import { fetchPublishedContractMetadata } from "../../contract/deployment/publisher.js";
import { zkDeployContract } from "../../contract/deployment/zksync/zkDeployContract.js";
import { sendAndConfirmTransaction } from "../../transaction/actions/send-and-confirm-transaction.js";
import { simulateTransaction } from "../../transaction/actions/simulate.js";
import { prepareContractCall } from "../../transaction/prepare-contract-call.js";
import { resolveMethod } from "../../transaction/resolve-method.js";
import type { CompilerMetadata } from "../../utils/any-evm/deploy-metadata.js";
import { isZkSyncChain } from "../../utils/any-evm/zksync/isZkSyncChain.js";
import type { Account } from "../../wallets/interfaces/wallet.js";

/**
 * @extension DEPLOY
 */
export type DeployPublishedContractOptions = {
  client: ThirdwebClient;
  chain: Chain;
  account: Account;
  contractId: string;
  contractParams: unknown[];
  publisher?: string;
  version?: string;
  implementationConstructorParams?: unknown[];
};

/**
 * Deploy an instance of a published contract on a given chain
 * @param options - the deploy options
 * @returns a promise that resolves to the deployed contract address
 * @example
 * ```ts
 * import { deployPublishedContract } from "thirdweb/deploys";
 *
 * const address = await deployedPublishedContract({
 *   client,
 *   chain,
 *   account,
 *   contractId: "MyPublishedContract",
 *   contractParams: [...],
 *   publisher: "0x...",
 * });
 * ```
 * @extension DEPLOY
 */
export async function deployPublishedContract(
  options: DeployPublishedContractOptions,
): Promise<string> {
  const {
    client,
    account,
    chain,
    contractId,
    contractParams,
    publisher,
    version,
    implementationConstructorParams,
  } = options;
  const { compilerMetadata, extendedMetadata } =
    await fetchPublishedContractMetadata({
      client,
      contractId: isZkSyncChain(chain) ? `${contractId}_ZkSync` : contractId,
      publisher,
      version,
    });

  switch (extendedMetadata?.deployType) {
    case "standard": {
      return directDeploy({
        account,
        client,
        chain,
        compilerMetadata,
        contractParams,
      });
    }
    case "autoFactory": {
      const [
        { deployViaAutoFactory },
        { getOrDeployInfraForPublishedContract },
      ] = await Promise.all([
        import("../../contract/deployment/deploy-via-autofactory.js"),
        import("../../contract/deployment/utils/bootstrap.js"),
      ]);
      const { cloneFactoryContract, implementationContract } =
        await getOrDeployInfraForPublishedContract({
          chain,
          client,
          account,
          contractId,
          constructorParams: implementationConstructorParams || [],
          publisher,
        });
      const initializeFunction = compilerMetadata.abi.find(
        (i) =>
          i.type === "function" &&
          i.name ===
            (extendedMetadata.factoryDeploymentData
              ?.implementationInitializerFunction || "initialize"),
      ) as AbiFunction;
      if (!initializeFunction) {
        throw new Error(`Could not find initialize function for ${contractId}`);
      }
      const initializeTransaction = prepareContractCall({
        contract: getContract({
          client,
          chain,
          address: implementationContract.address,
        }),
        method: initializeFunction,
        params: contractParams,
      });

      return deployViaAutoFactory({
        client,
        chain,
        account,
        cloneFactoryContract,
        initializeTransaction,
      });
    }
    case "customFactory": {
      if (!extendedMetadata?.factoryDeploymentData?.customFactoryInput) {
        throw new Error("No custom factory info found");
      }
      const factoryAddress =
        extendedMetadata?.factoryDeploymentData?.customFactoryInput
          ?.customFactoryAddresses?.[chain.id];
      const factoryFunction =
        extendedMetadata.factoryDeploymentData?.customFactoryInput
          ?.factoryFunction;
      if (!factoryAddress || !factoryFunction) {
        throw new Error(`No factory address found on chain ${chain.id}`);
      }

      const factory = getContract({
        client,
        chain,
        address: factoryAddress,
      });
      const deployTx = prepareContractCall({
        contract: factory,
        method: resolveMethod(factoryFunction),
        params: contractParams,
      });
      // asumption here is that the factory address returns the deployed proxy address
      const address = simulateTransaction({
        transaction: deployTx,
      });
      await sendAndConfirmTransaction({
        transaction: deployTx,
        account,
      });
      return address;
    }
    case undefined: {
      // Default to standard deployment if none was specified
      return directDeploy({
        account,
        client,
        chain,
        compilerMetadata,
        contractParams,
      });
    }
    default:
      // If a deployType was specified but we don't support it, throw an error
      throw new Error(
        `Unsupported deploy type: ${extendedMetadata?.deployType}`,
      );
  }
}

async function directDeploy(options: {
  account: Account;
  client: ThirdwebClient;
  chain: Chain;
  compilerMetadata: CompilerMetadata;
  contractParams: unknown[];
}) {
  const { account, client, chain, compilerMetadata, contractParams } = options;

  if (isZkSyncChain(chain)) {
    return zkDeployContract({
      account,
      client,
      chain,
      bytecode: compilerMetadata.bytecode,
      abi: compilerMetadata.abi,
      params: contractParams,
    });
  }

  const { deployContract } = await import(
    "../../contract/deployment/deploy-with-abi.js"
  );
  return deployContract({
    account,
    client,
    chain,
    bytecode: compilerMetadata.bytecode,
    constructorAbi:
      (compilerMetadata.abi.find(
        (i) => i.type === "constructor",
      ) as AbiConstructor) || [],
    constructorParams: contractParams,
  });
}
