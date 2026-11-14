// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MockMUSD, MockPriceFeed} from "../MockMUSDProtocol.sol";

/// @dev Audit-only TroveManager (standalone, so later edits to MockTroveManager cannot clash). Same behaviour as
///      MockTroveManager plus the real MUSD getters a fixed RescueGuard may need (`getTroveDebt`, `getTroveColl`) and
///      `liquidate`, which follows MUSD's `_getTotalsFromBatchLiquidate`: a trove is liquidatable iff ICR < MCR (also in
///      Recovery Mode), and liquidation takes the whole trove (coll/principal/interest zeroed, closedByLiquidation).
///      Like the real TroveManager, getCurrentICR of a closed trove is type(uint256).max (_computeCR with debt == 0).
contract AuditTroveManager {
    struct Trove {
        uint256 coll;
        uint256 debt;
        uint8 status; // 0 nonExistent, 1 active, 2 closedByOwner, 3 closedByLiquidation, 4 closedByRedemption
    }

    uint256 public constant MCR = 1.1e18;
    MockPriceFeed public immutable priceFeed;
    mapping(address => Trove) public troves;
    address public operator;

    constructor(MockPriceFeed _pf) {
        priceFeed = _pf;
    }

    function setOperator(address o) external {
        operator = o;
    }

    function setTrove(address borrower, uint256 coll, uint256 debt, uint8 status) external {
        troves[borrower] = Trove(coll, debt, status);
    }

    function getTroveStatus(address borrower) external view returns (uint8) {
        return troves[borrower].status;
    }

    function getCurrentICR(address borrower, uint256 price) public view returns (uint256) {
        Trove memory t = troves[borrower];
        if (t.debt == 0) return type(uint256).max;
        return (t.coll * price) / t.debt;
    }

    function applyAdjustment(address borrower, uint256 collIncrease, uint256 debtDecrease) external {
        require(msg.sender == operator, "TM: caller is not operator");
        troves[borrower].coll += collIncrease;
        troves[borrower].debt -= debtDecrease;
    }

    /// @dev Real TroveManager getter (coll, principal, interest, pending...). The mock keeps all debt as principal.
    function getEntireDebtAndColl(address borrower) external view returns (uint256, uint256, uint256, uint256, uint256, uint256) {
        Trove memory t = troves[borrower];
        return (t.coll, t.debt, 0, 0, 0, 0);
    }

    function getTroveDebt(address borrower) external view returns (uint256) {
        return troves[borrower].debt;
    }

    function getTroveColl(address borrower) external view returns (uint256) {
        return troves[borrower].coll;
    }

    function liquidate(address borrower) external {
        require(troves[borrower].status == 1, "TroveManager: Trove does not exist or is closed");
        require(getCurrentICR(borrower, priceFeed.fetchPrice()) < MCR, "TroveManager: nothing to liquidate");
        troves[borrower] = Trove(0, 0, 3);
    }
}

/// @dev Audit-only BorrowerOperationsSignatures + BorrowerOperations. Identical signature handling to the live BOS
///      (domain, typehashes, encodePacked digest, per-borrower nonce consumed on success, MUSD burned from the CALLER).
///      Differences from MockBorrowerOperationsSignatures, all taken from the real BorrowerOperations._adjustTrove:
///        - Recovery Mode (real: TCR < CCR; here a switch). In Recovery Mode `_requireValidAdjustmentInRecoveryMode`
///          only forbids coll withdrawals and constrains debt increases, so a pure repayment or pure top-up is
///          accepted at ANY resulting ICR. In Normal Mode the result must be >= MCR (the TCR >= CCR check always holds
///          for a repay/top-up and is omitted).
///        - minNetDebt is a (governable) variable and `_requireValidMUSDRepayment` is checked separately.
///        - On a repayment ActivePool.sendCollateral(borrower, 0) makes a 0-value call to the borrower after the burn.
///        - `borrowerOperations()`, `minNetDebt()` and `MUSD_GAS_COMPENSATION()` exist with the live signatures (BOS
///          exposes `borrowerOperations()`; BO exposes the other two). Here BOS and BO are the same contract.
contract AuditBorrowerOperationsSignatures is EIP712 {
    bytes32 private constant ADD_COLL_TYPEHASH =
        keccak256("AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)");
    bytes32 private constant REPAY_MUSD_TYPEHASH =
        keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");

    uint256 public constant MCR = 1.1e18;
    uint256 public constant MUSD_GAS_COMPENSATION = 200e18;
    uint256 public minNetDebt = 1_800e18;
    bool public recoveryMode;

    mapping(address => uint256) private nonces;
    MockMUSD public immutable musd;
    AuditTroveManager public immutable troveManager;
    MockPriceFeed public immutable priceFeed;

    constructor(MockMUSD _musd, AuditTroveManager _tm, MockPriceFeed _pf) EIP712("BorrowerOperationsSignatures", "1") {
        musd = _musd;
        troveManager = _tm;
        priceFeed = _pf;
    }

    function borrowerOperations() external view returns (address) {
        return address(this);
    }

    function setRecoveryMode(bool r) external {
        recoveryMode = r;
    }

    function setMinNetDebt(uint256 m) external {
        minNetDebt = m;
    }

    function getNonce(address user) public view returns (uint256) {
        return nonces[user];
    }

    function repayMUSDWithSignature(
        uint256 _amount,
        address, /* upperHint */
        address, /* lowerHint */
        address _borrower,
        bytes memory _signature,
        uint256 _deadline
    ) external {
        _verifySignature(REPAY_MUSD_TYPEHASH, abi.encode(_amount, _borrower), _borrower, _signature, _deadline);
        require(troveManager.getTroveStatus(_borrower) == 1, "BorrowerOps: Trove does not exist or is closed");
        require(_amount > 0, "BorrowerOps: There must be either a collateral change or a debt change");
        (uint256 coll, uint256 debt, ) = troveManager.troves(_borrower);
        if (!recoveryMode) {
            require((coll * priceFeed.fetchPrice()) / (debt - _amount) >= MCR, "BorrowerOps: An operation that would result in ICR < MCR is not permitted");
        }
        require(debt - MUSD_GAS_COMPENSATION - _amount >= minNetDebt, "BorrowerOps: Trove's net debt must be greater than minimum");
        require(_amount <= debt - MUSD_GAS_COMPENSATION, "BorrowerOps: Amount repaid must not be larger than the Trove's debt");
        require(musd.balanceOf(msg.sender) >= _amount, "BorrowerOps: Caller doesnt have enough mUSD to make repayment");
        troveManager.applyAdjustment(_borrower, 0, _amount);
        musd.burn(msg.sender, _amount);
        (bool ok, ) = _borrower.call{value: 0}("");
        require(ok, "Sending BTC failed");
    }

    function addCollWithSignature(
        address, /* upperHint */
        address, /* lowerHint */
        address _borrower,
        bytes memory _signature,
        uint256 _deadline
    ) external payable {
        _verifySignature(ADD_COLL_TYPEHASH, abi.encode(msg.value, _borrower), _borrower, _signature, _deadline);
        require(troveManager.getTroveStatus(_borrower) == 1, "BorrowerOps: Trove does not exist or is closed");
        require(msg.value > 0, "BorrowerOps: There must be either a collateral change or a debt change");
        (uint256 coll, uint256 debt, ) = troveManager.troves(_borrower);
        if (!recoveryMode) {
            require(((coll + msg.value) * priceFeed.fetchPrice()) / debt >= MCR, "BorrowerOps: An operation that would result in ICR < MCR is not permitted");
        }
        troveManager.applyAdjustment(_borrower, msg.value, 0);
    }

    function _verifySignature(
        bytes32 _typeHash,
        bytes memory _data,
        address _borrower,
        bytes memory _signature,
        uint256 _deadline
    ) internal {
        require(block.timestamp <= _deadline, "Signature expired");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encodePacked(_typeHash, _data, nonces[_borrower], _deadline)));
        require(ECDSA.recover(digest, _signature) == _borrower, "BorrowerOperationsSignatures: Invalid signature");
        nonces[_borrower]++;
    }
}

interface IAuditGuard {
    function execute(address borrower, address upperHint, address lowerHint) external returns (uint256, uint256);
}

/// @dev Keeper that liquidates the borrower from inside its BTC-tip callback, i.e. between the protocol call and
///      RescueGuard's post-condition check.
contract LiquidatingKeeper {
    IAuditGuard public immutable guard;
    AuditTroveManager public immutable troveManager;
    address public target;

    constructor(IAuditGuard g, AuditTroveManager tm) {
        guard = g;
        troveManager = tm;
    }

    function run(address borrower) external {
        target = borrower;
        guard.execute(borrower, address(0), address(0));
    }

    receive() external payable {
        troveManager.liquidate(target);
    }
}
