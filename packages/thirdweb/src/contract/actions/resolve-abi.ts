import { formatAbi, type Abi, parseAbi } from "abitype";
import type { ThirdwebContract } from "../index.js";
import { getChainIdFromChain } from "../../chain/index.js";
import { getClientFetch } from "../../utils/fetch.js";
import { getByteCode } from "./get-bytecode.js";
import { download } from "../../storage/download.js";
import { extractIPFSUri } from "../../utils/bytecode/extractIPFS.js";
import { detectMethodInBytecode } from "../../utils/bytecode/detectExtension.js";
import { readContractRaw } from "../../transaction/actions/raw/raw-read.js";

const ABI_RESOLUTION_CACHE = new WeakMap<ThirdwebContract<Abi>, Promise<Abi>>();

/**
 * Resolves the ABI (Application Binary Interface) for a given contract.
 * If the ABI is already cached, it returns the cached value.
 * Otherwise, it tries to resolve the ABI from the contract's API.
 * If that fails, it resolves the ABI from the contract's bytecode.
 * @param contract The contract for which to resolve the ABI.
 * @param contractApiBaseUrl The base URL of the contract API. Defaults to "https://contract.thirdweb.com/abi".
 * @returns A promise that resolves to the ABI of the contract.
 * @example
 * ```ts
 * import { createClient, getContract } from "thirdweb";
 * import { resolveContractAbi } from "thirdweb/contract"
 * const client = createClient({ clientId: "..." });
 * const myContract = getContract({
 *  client,
 *  address: "...",
 *  chain: 1,
 * });
 * const abi = await resolveContractAbi(myContract);
 */
export function resolveContractAbi<abi extends Abi>(
  contract: ThirdwebContract<abi>,
  contractApiBaseUrl = "https://contract.thirdweb.com/abi",
): Promise<abi> {
  if (ABI_RESOLUTION_CACHE.has(contract)) {
    return ABI_RESOLUTION_CACHE.get(contract) as Promise<abi>;
  }

  const prom = (async () => {
    // if the contract already HAS a user defined we always use that!
    if (contract.abi) {
      return contract.abi as abi;
    }
    // try to get it from the api
    try {
      return await resolveAbiFromContractApi(contract, contractApiBaseUrl);
    } catch (e) {
      // if that fails, try to resolve it from the bytecode
      return await resolveCompositeAbiFromBytecode(contract);
    }
  })();
  ABI_RESOLUTION_CACHE.set(contract, prom);
  return prom as Promise<abi>;
}

/**
 * Resolves the ABI (Application Binary Interface) for a contract from the contract API.
 * @param contract The ThirdwebContract instance representing the contract.
 * @param contractApiBaseUrl The base URL of the contract API. Defaults to "https://contract.thirdweb.com/abi".
 * @returns A promise that resolves to the ABI of the contract.
 * @example
 * ```ts
 * import { createClient, getContract } from "thirdweb";
 * import { resolveAbiFromContractApi } from "thirdweb/contract"
 * const client = createClient({ clientId: "..." });
 * const myContract = getContract({
 *  client,
 *  address: "...",
 *  chain: 1,
 * });
 * const abi = await resolveAbiFromContractApi(myContract);
 * ```
 */
export async function resolveAbiFromContractApi(
  contract: ThirdwebContract<any>,
  contractApiBaseUrl = "https://contract.thirdweb.com/abi",
): Promise<Abi> {
  const chainId = getChainIdFromChain(contract.chain);
  const response = await getClientFetch(contract.client)(
    `${contractApiBaseUrl}/${chainId}/${contract.address}`,
  );
  const json = await response.json();
  return json;
}

/**
 * Resolves the ABI (Application Binary Interface) from the bytecode of a contract.
 * @param contract The ThirdwebContract instance.
 * @returns The resolved ABI as a generic type.
 * @throws Error if no IPFS URI is found in the bytecode.
 * @example
 * ```ts
 * import { createClient, getContract } from "thirdweb";
 * import { resolveAbiFromBytecode } from "thirdweb/contract"
 * const client = createClient({ clientId: "..." });
 * const myContract = getContract({
 *  client,
 *  address: "...",
 *  chain: 1,
 * });
 * const abi = await resolveAbiFromBytecode(myContract);
 * ```
 */
export async function resolveAbiFromBytecode(
  contract: ThirdwebContract<any>,
): Promise<Abi> {
  const bytecode = await getByteCode(contract);
  const ipfsUri = extractIPFSUri(bytecode);
  if (!ipfsUri) {
    throw new Error("No IPFS URI found in bytecode");
  }
  const res = await download({ uri: ipfsUri, client: contract.client });
  const json = await res.json();
  // ABI is at `json.output.abi`
  return json.output.abi;
}

const PLUGINS_ABI = {
  inputs: [],
  name: "getAllPlugins",
  outputs: [
    {
      components: [
        {
          internalType: "bytes4",
          name: "functionSelector",
          type: "bytes4",
        },
        {
          internalType: "string",
          name: "functionSignature",
          type: "string",
        },
        {
          internalType: "address",
          name: "pluginAddress",
          type: "address",
        },
      ],
      internalType: "struct IPluginMap.Plugin[]",
      name: "registered",
      type: "tuple[]",
    },
  ],
  stateMutability: "view",
  type: "function",
} as const;

const BASE_ROUTER_ABI = {
  inputs: [],
  name: "getAllExtensions",
  outputs: [
    {
      components: [
        {
          components: [
            {
              internalType: "string",
              name: "name",
              type: "string",
            },
            {
              internalType: "string",
              name: "metadataURI",
              type: "string",
            },
            {
              internalType: "address",
              name: "implementation",
              type: "address",
            },
          ],
          internalType: "struct IExtension.ExtensionMetadata",
          name: "metadata",
          type: "tuple",
        },
        {
          components: [
            {
              internalType: "bytes4",
              name: "functionSelector",
              type: "bytes4",
            },
            {
              internalType: "string",
              name: "functionSignature",
              type: "string",
            },
          ],
          internalType: "struct IExtension.ExtensionFunction[]",
          name: "functions",
          type: "tuple[]",
        },
      ],
      internalType: "struct IExtension.Extension[]",
      name: "allExtensions",
      type: "tuple[]",
    },
  ],
  stateMutability: "view",
  type: "function",
} as const;

const DIAMOND_ABI = {
  inputs: [],
  name: "facets",
  outputs: [
    {
      components: [
        {
          internalType: "address",
          name: "facetAddress",
          type: "address",
        },
        {
          internalType: "bytes4[]",
          name: "functionSelectors",
          type: "bytes4[]",
        },
      ],
      type: "tuple[]",
    },
  ],
  stateMutability: "view",
  type: "function",
} as const;

/**
 * Resolves the ABI for a contract based on its bytecode.
 * If the contract follows the plugin-pattern or dynamic pattern, it resolves the ABIs for the plugins and merges them with the root ABI.
 * If the contract follows the base router pattern, it resolves the ABIs for the plugins and merges them with the root ABI.
 * If the contract follows the diamond pattern, it resolves the ABIs for the facets and merges them with the root ABI.
 * @param contract The contract for which to resolve the ABI.
 * @returns The resolved ABI for the contract.
 * @example
 * ```ts
 * import { createClient, getContract } from "thirdweb";
 * import { resolveCompositeAbiFromBytecode } from "thirdweb/contract"
 * const client = createClient({ clientId: "..." });
 * const myContract = getContract({
 *  client,
 *  address: "...",
 *  chain: 1,
 * });
 * const abi = await resolveCompositeAbiFromBytecode(myContract);
 * ```
 */
export async function resolveCompositeAbiFromBytecode(
  contract: ThirdwebContract<any>,
) {
  const [rootAbi, bytecode] = await Promise.all([
    resolveAbiFromBytecode(contract),
    getByteCode(contract),
  ]);

  // check if contract is plugin-pattern / dynamic
  if (detectMethodInBytecode({ bytecode, method: PLUGINS_ABI })) {
    try {
      const pluginMap = await readContractRaw({
        contract,
        method: PLUGINS_ABI,
      });
      // if there are no plugins, return the root ABI
      if (!pluginMap.length) {
        return rootAbi;
      }
      // get all the plugin addresses
      const plugins = [...new Set(pluginMap.map((item) => item.pluginAddress))];
      // resolve all the plugin ABIs
      const pluginAbis = await getAbisForPlugins({ contract, plugins });
      // return the merged ABI
      return joinAbis({ pluginAbis, rootAbi });
    } catch (err) {
      console.warn("[resolveCompositeAbi:dynamic] ", err);
    }
  }

  // check for "base router" pattern
  if (detectMethodInBytecode({ bytecode, method: BASE_ROUTER_ABI })) {
    try {
      const pluginMap = await readContractRaw({
        contract,
        method: BASE_ROUTER_ABI,
      });
      // if there are no plugins, return the root ABI
      if (!pluginMap.length) {
        return rootAbi;
      }
      // get all the plugin addresses
      const plugins = [
        ...new Set(pluginMap.map((item) => item.metadata.implementation)),
      ];
      // resolve all the plugin ABIs
      const pluginAbis = await getAbisForPlugins({ contract, plugins });
      // return the merged ABI
      return joinAbis({ pluginAbis, rootAbi });
    } catch (err) {
      console.warn("[resolveCompositeAbi:base-router] ", err);
    }
  }

  // detect diamond pattern
  if (detectMethodInBytecode({ bytecode, method: DIAMOND_ABI })) {
    try {
      const facets = await readContractRaw({ contract, method: DIAMOND_ABI });
      // if there are no facets, return the root ABI
      if (!facets.length) {
        return rootAbi;
      }
      // get all the plugin addresses
      const plugins = facets.map((item) => item.facetAddress);
      const pluginAbis = await getAbisForPlugins({ contract, plugins });
      return joinAbis({ pluginAbis, rootAbi });
    } catch (err) {
      console.warn("[resolveCompositeAbi:diamond] ", err);
    }
  }
  return rootAbi;
}

type GetAbisForPluginsOptions = {
  contract: ThirdwebContract<any>;
  plugins: string[];
};

async function getAbisForPlugins(
  options: GetAbisForPluginsOptions,
): Promise<Abi[]> {
  return Promise.all(
    options.plugins.map((pluginAddress) =>
      resolveAbiFromBytecode({
        ...options.contract,
        address: pluginAddress,
      }),
    ),
  );
}

type JoinAbisOptions = {
  pluginAbis: Abi[];
  rootAbi?: Abi;
};

function joinAbis(options: JoinAbisOptions): Abi {
  const mergedPlugins = options.pluginAbis
    .flat()
    .filter((item) => item.type !== "constructor");

  if (options.rootAbi) {
    mergedPlugins.push(...options.rootAbi);
  }

  // unique by formatting every abi and then throwing them in a set
  // TODO: this may not be super efficient...
  const humanReadableAbi = [...new Set(...formatAbi(mergedPlugins))];
  // finally parse it back out
  return parseAbi(humanReadableAbi);
}
