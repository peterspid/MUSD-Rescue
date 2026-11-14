// AUTO-GENERATED from the official Mezo MUSD deployment artifacts
// (github.com/mezo-org/musd → solidity/artifacts/deployments/matsnet/*.json).
// Entries are copied verbatim from those ABIs; only unused entries are omitted.

export const borrowerOperationsAbi = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_fee",
        "type": "uint256"
      }
    ],
    "name": "BorrowingFeePaid",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "arrayIndex",
        "type": "uint256"
      }
    ],
    "name": "TroveCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_principal",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_interest",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_coll",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_stake",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "_interestRate",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_lastInterestUpdateTime",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "_operation",
        "type": "uint8"
      }
    ],
    "name": "TroveUpdated",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "CCR",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MCR",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MUSD_GAS_COMPENSATION",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_upperHint",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lowerHint",
        "type": "address"
      }
    ],
    "name": "addColl",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_collWithdrawal",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_debtChange",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "_isDebtIncrease",
        "type": "bool"
      },
      {
        "internalType": "address",
        "name": "_upperHint",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lowerHint",
        "type": "address"
      }
    ],
    "name": "adjustTrove",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "borrowingRate",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "closeTrove",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_debt",
        "type": "uint256"
      }
    ],
    "name": "getBorrowingFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getEntireSystemColl",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "entireSystemColl",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getEntireSystemDebt",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "entireSystemDebt",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "minNetDebt",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_debtAmount",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "_upperHint",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lowerHint",
        "type": "address"
      }
    ],
    "name": "openTrove",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "redemptionRate",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_upperHint",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lowerHint",
        "type": "address"
      }
    ],
    "name": "refinance",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "refinancingFeePercentage",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_amount",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "_upperHint",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lowerHint",
        "type": "address"
      }
    ],
    "name": "repayMUSD",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_amount",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "_upperHint",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lowerHint",
        "type": "address"
      }
    ],
    "name": "withdrawColl",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_amount",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "_upperHint",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_lowerHint",
        "type": "address"
      }
    ],
    "name": "withdrawMUSD",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

export const troveManagerAbi = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_liquidatedPrincipal",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_liquidatedInterest",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_liquidatedColl",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_collGasCompensation",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_gasCompensation",
        "type": "uint256"
      }
    ],
    "name": "Liquidation",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_attemptedAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_actualAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_collateralSent",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_collateralFee",
        "type": "uint256"
      }
    ],
    "name": "Redemption",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_debt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_coll",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "operation",
        "type": "uint8"
      }
    ],
    "name": "TroveLiquidated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_principal",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_interest",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_coll",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_stake",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "_interestRate",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "_lastInterestUpdateTime",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "_operation",
        "type": "uint8"
      }
    ],
    "name": "TroveUpdated",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "Troves",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "coll",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "principal",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "interestOwed",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "stake",
        "type": "uint256"
      },
      {
        "internalType": "enum ITroveManager.Status",
        "name": "status",
        "type": "uint8"
      },
      {
        "internalType": "uint16",
        "name": "interestRate",
        "type": "uint16"
      },
      {
        "internalType": "uint256",
        "name": "lastInterestUpdateTime",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxBorrowingCapacity",
        "type": "uint256"
      },
      {
        "internalType": "uint128",
        "name": "arrayIndex",
        "type": "uint128"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_price",
        "type": "uint256"
      }
    ],
    "name": "checkRecoveryMode",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "_price",
        "type": "uint256"
      }
    ],
    "name": "getCurrentICR",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getEntireDebtAndColl",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "coll",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "principal",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "interest",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "pendingCollateral",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "pendingPrincipal",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "pendingInterest",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getEntireSystemColl",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "entireSystemColl",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getEntireSystemDebt",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "entireSystemDebt",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getNominalICR",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getPendingCollateral",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getPendingDebt",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "pendingPrincipal",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "pendingInterest",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_price",
        "type": "uint256"
      }
    ],
    "name": "getTCR",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getTroveColl",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getTroveDebt",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_index",
        "type": "uint256"
      }
    ],
    "name": "getTroveFromTroveOwnersArray",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getTroveInterestOwed",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getTroveInterestRate",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getTroveLastInterestUpdateTime",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getTroveMaxBorrowingCapacity",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getTroveOwnersCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getTrovePrincipal",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "getTroveStatus",
    "outputs": [
      {
        "internalType": "enum ITroveManager.Status",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_borrower",
        "type": "address"
      }
    ],
    "name": "hasPendingRewards",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const priceFeedAbi = [
  {
    "inputs": [],
    "name": "fetchPrice",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "oracle",
    "outputs": [
      {
        "internalType": "contract ChainlinkAggregatorV3Interface",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const sortedTrovesAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_id",
        "type": "address"
      }
    ],
    "name": "contains",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_NICR",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "_prevId",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_nextId",
        "type": "address"
      }
    ],
    "name": "findInsertPosition",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getFirst",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getLast",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_id",
        "type": "address"
      }
    ],
    "name": "getNext",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_id",
        "type": "address"
      }
    ],
    "name": "getPrev",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getSize",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_NICR",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "_prevId",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_nextId",
        "type": "address"
      }
    ],
    "name": "validInsertPosition",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const hintHelpersAbi = [
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_coll",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_debt",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_price",
        "type": "uint256"
      }
    ],
    "name": "computeCR",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_coll",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_debt",
        "type": "uint256"
      }
    ],
    "name": "computeNominalCR",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_CR",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_numTrials",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "_inputRandomSeed",
        "type": "uint256"
      }
    ],
    "name": "getApproxHint",
    "outputs": [
      {
        "internalType": "address",
        "name": "hintAddress",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "diff",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "latestRandomSeed",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const interestRateManagerAbi = [
  {
    "inputs": [],
    "name": "MAX_INTEREST_RATE",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "interestRate",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "proposedInterestRate",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const stabilityPoolAbi = [
  {
    "inputs": [],
    "name": "getCollateralBalance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getTotalMUSDDeposits",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const mUSDAbi = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "Approval",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "Transfer",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      }
    ],
    "name": "allowance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "burnList",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "mintList",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "name",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

