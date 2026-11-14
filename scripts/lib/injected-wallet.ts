/**
 * A real EIP-1193 wallet for browser e2e tests. The page gets a thin provider (window.ethereum + EIP-6963
 * announcement, so wagmi discovers it like MetaMask); every request is forwarded to Node through
 * page.exposeFunction, where viem signs with a testnet key and sends to Mezo testnet. Keys never enter the page.
 */
import type { Page } from "playwright-core";
import { createPublicClient, createWalletClient, http, type Hex, type TypedDataDefinition } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { mezoTestnet } from "../../src/config/chains";

type Field = { name: string; type: string };

/** JSON typed data carries uint values as strings; turn them back into bigints using the declared types. */
function reviveTyped(types: Record<string, Field[]>, typeName: string, value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of types[typeName] ?? []) {
    const v = value[f.name];
    if (/^u?int\d*$/.test(f.type)) out[f.name] = BigInt(v as string);
    else if (types[f.type]) out[f.name] = reviveTyped(types, f.type, v as Record<string, unknown>);
    else out[f.name] = v;
  }
  return out;
}

export interface InjectedWallet {
  address: `0x${string}`;
  sent: Hex[];
}

export async function injectWallet(page: Page, account: PrivateKeyAccount, label = "E2E Wallet"): Promise<InjectedWallet> {
  const pub = createPublicClient({ chain: mezoTestnet, transport: http() });
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http() });
  const state: InjectedWallet = { address: account.address, sent: [] };

  await page.exposeFunction("__e2eWallet", async (method: string, paramsJson: string) => {
    const params = JSON.parse(paramsJson || "[]") as unknown[];
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return `0x${mezoTestnet.id.toString(16)}`;
      case "net_version":
        return String(mezoTestnet.id);
      case "wallet_requestPermissions":
      case "wallet_getPermissions":
        return [{ parentCapability: "eth_accounts" }];
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        return null;
      case "wallet_watchAsset":
        return true;
      case "personal_sign":
        return account.signMessage({ message: { raw: params[0] as Hex } });
      case "eth_signTypedData_v4": {
        const td = JSON.parse(params[1] as string) as { domain: Record<string, unknown>; types: Record<string, Field[]>; primaryType: string; message: Record<string, unknown> };
        const { EIP712Domain: _ignored, ...types } = td.types; // eslint-disable-line @typescript-eslint/no-unused-vars
        const domain = { ...td.domain, ...(td.domain.chainId !== undefined ? { chainId: Number(td.domain.chainId) } : {}) };
        return account.signTypedData({ domain, types, primaryType: td.primaryType, message: reviveTyped(types, td.primaryType, td.message) } as unknown as TypedDataDefinition);
      }
      case "eth_sendTransaction": {
        const tx = params[0] as { to: Hex; data?: Hex; value?: Hex; gas?: Hex };
        for (let attempt = 1; ; attempt++) {
          try {
            const nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
            const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, gas: tx.gas ? BigInt(tx.gas) : undefined, nonce });
            state.sent.push(hash);
            return hash;
          } catch (e) {
            if (attempt >= 4 || !/nonce too low|already known|underpriced/i.test((e as Error).message)) throw e;
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
      }
      default:
        return pub.request({ method: method as never, params: params as never });
    }
  });

  // Plain-string init script: a serialized TS function would carry esbuild helpers (__name) that do not exist in
  // the page and make the script throw before window.ethereum is set.
  const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='4' fill='%231e40ff'/%3E%3C/svg%3E";
  await page.addInitScript(`(() => {
    const listeners = {};
    const provider = {
      isE2EWallet: true,
      request: async ({ method, params }) => {
        try {
          return await window.__e2eWallet(method, JSON.stringify(params ?? [], (_k, v) => (typeof v === "bigint" ? "0x" + v.toString(16) : v)));
        } catch (e) {
          const err = new Error(e && e.message ? e.message : String(e));
          err.code = -32603;
          throw err;
        }
      },
      on: (e, cb) => { (listeners[e] = listeners[e] || []).push(cb); },
      removeListener: (e, cb) => { listeners[e] = (listeners[e] || []).filter((x) => x !== cb); },
    };
    window.ethereum = provider;
    const info = { uuid: "6f1d6a2e-0e2e-4e2e-9e2e-e2ee2ee2e2e2", name: ${JSON.stringify(label)}, rdns: "org.musdrescue.e2e", icon: ${JSON.stringify(icon)} };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  })();`);
  return state;
}
