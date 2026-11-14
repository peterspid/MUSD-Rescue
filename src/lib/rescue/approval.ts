/**
 * Does a repayment need an ERC-20 approval first?
 *
 * MUSD: NO. BorrowerOperations._repayMUSD calls MUSD.burn(caller, amount), and MUSD.burn is gated by
 * `burnList[msg.sender]` (BorrowerOperations is on the burn list — verified live: burnList(BorrowerOperations)
 * == true). Burning does not go through transferFrom, so no allowance is read. We also confirmed it by
 * simulating repayMUSD from an address whose allowance to BorrowerOperations is 0: the call succeeds.
 *
 * The generic path is kept so adapters for protocols that pull tokens with transferFrom can require one.
 */
export type RepaymentTokenModel = "burn-by-protocol" | "transfer-from";

export interface ApprovalRequirement {
  needed: boolean;
  /** Exact amount to approve (never unlimited). */
  amount: bigint;
  spender: `0x${string}` | null;
  explanation: string;
}

export function approvalRequirement(model: RepaymentTokenModel, allowance: bigint, amount: bigint, spender: `0x${string}`): ApprovalRequirement {
  if (model === "burn-by-protocol") {
    return {
      needed: false,
      amount: 0n,
      spender: null,
      explanation:
        "No approval needed. BorrowerOperations burns the repaid MUSD directly from your wallet (it holds the MUSD burn role), so it never calls transferFrom and your allowance is irrelevant.",
    };
  }
  if (allowance >= amount) {
    return { needed: false, amount: 0n, spender, explanation: "Existing allowance already covers this repayment." };
  }
  return {
    needed: true,
    amount,
    spender,
    explanation: `Approve exactly this amount for ${spender}. Approvals are never unlimited.`,
  };
}
