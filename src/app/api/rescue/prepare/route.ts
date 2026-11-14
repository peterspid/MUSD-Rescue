import { z } from "zod";
import { getAddress, isAddress } from "viem";
import { prepareRescue } from "@/lib/server/musd-adapter";
import { errorResponse, json, parseBody, rateLimit, clientKey, assertSameOrigin } from "@/lib/server/http";
import { getSession } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/records";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const uint = z.string().regex(/^\d{1,78}$/, "amount must be an integer string of base units");
const Body = z.object({
  owner: z.string().refine((a) => isAddress(a, { strict: false }), "owner must be an address"),
  repay: uint.default("0"),
  addColl: uint.default("0"),
});

/**
 * Server-side transaction preparation. Re-reads the trove at the latest block, validates the action
 * against the protocol rules, computes SortedTroves hints, simulates with eth_call from the owner and sets
 * an explicit gas limit. The client signs exactly what this returns (after showing a confirmation screen).
 * Preparing calldata is not privileged, so it does not require a session; recording does.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    rateLimit(`prep:${clientKey(req)}`, 12, 0.2);
    const body = await parseBody(req, Body);
    const owner = getAddress(body.owner);
    const prepared = await prepareRescue({ owner, repay: BigInt(body.repay), addColl: BigInt(body.addColl) });
    const session = await getSession(req);
    if (session && session.address.toLowerCase() === owner.toLowerCase()) {
      await logActivity({
        user: session.address,
        owner,
        category: "offchain",
        kind: "tx_prepared",
        title: `Prepared ${prepared.functionName} at block ${prepared.blockNumber}`,
        details: { amounts: prepared.amounts, icrBefore: prepared.before.icr, icrAfter: prepared.after.icr, gas: prepared.gas.limit },
      });
    }
    return json(prepared);
  } catch (e) {
    return errorResponse(e);
  }
}
