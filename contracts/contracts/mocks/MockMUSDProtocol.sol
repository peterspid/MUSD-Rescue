// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Test double for the MUSD token: OZ ERC20Permit with the live domain name "Mezo USD", plus a burn that
///      only the protocol may call (on Mezo, BorrowerOperations is on MUSD's burnList and burns without allowance).
contract MockMUSD is ERC20, ERC20Permit {
    address public burner;

    constructor() ERC20("Mezo USD", "MUSD") ERC20Permit("Mezo USD") {}

    function setBurner(address b) external {
        burner = b;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address account, uint256 amount) external {
        require(msg.sender == burner, "MUSD: caller is not the burner");
        _burn(account, amount);
    }
}

/// @dev Settable oracle; reverts like the real PriceFeed when stale.
contract MockPriceFeed {
    uint256 public price;
    bool public stale;

    constructor(uint256 p) {
        price = p;
    }

    function setPrice(uint256 p) external {
        price = p;
    }

    function setStale(bool s) external {
        stale = s;
    }

    function fetchPrice() external view returns (uint256) {
        require(!stale, "PriceFeed: Oracle is stale.");
        return price;
    }
}

/// @dev Minimal TroveManager: entire debt (principal + interest) and collateral per borrower.
contract MockTroveManager {
    struct Trove {
        uint256 coll;
        uint256 debt;
        uint8 status; // 0 nonExistent, 1 active, 2 closedByOwner, 3 closedByLiquidation, 4 closedByRedemption
    }

    mapping(address => Trove) public troves;
    address public operator;

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
}

/// @dev Reproduces BorrowerOperationsSignatures' signature handling exactly (domain, typehashes, encodePacked
///      digest, per-borrower nonces) and the BorrowerOperations rules a rescue hits: trove active, minNetDebt
///      after a repayment, ICR >= MCR after the adjustment (Normal Mode), caller balance, and burning MUSD from the
///      CALLER (msg.sender of this contract). Fault switches let tests model a misbehaving protocol.
contract MockBorrowerOperationsSignatures is EIP712 {
    bytes32 private constant ADD_COLL_TYPEHASH =
        keccak256("AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)");
    bytes32 private constant REPAY_MUSD_TYPEHASH =
        keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");

    uint256 public constant MCR = 1.1e18;
    uint256 public constant GAS_COMPENSATION = 200e18;
    uint256 public constant MIN_NET_DEBT = 1_800e18;

    mapping(address => uint256) private nonces;
    MockMUSD public immutable musd;
    MockTroveManager public immutable troveManager;
    MockPriceFeed public immutable priceFeed;

    uint256 public extraBurn; // fault injection: burn this much more than asked
    bool public skipStateUpdate; // fault injection: accept the call but do not improve the trove

    constructor(MockMUSD _musd, MockTroveManager _tm, MockPriceFeed _pf) EIP712("BorrowerOperationsSignatures", "1") {
        musd = _musd;
        troveManager = _tm;
        priceFeed = _pf;
    }

    function setExtraBurn(uint256 x) external {
        extraBurn = x;
    }

    function setSkipStateUpdate(bool s) external {
        skipStateUpdate = s;
    }

    function getNonce(address user) public view returns (uint256) {
        return nonces[user];
    }

    /// @dev Models the borrower using their nonce on another signed operation.
    function burnNonce(address user) external {
        nonces[user]++;
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
        (uint256 coll, uint256 debt, ) = troveManager.troves(_borrower);
        require(debt - GAS_COMPENSATION - _amount >= MIN_NET_DEBT, "BorrowerOps: Trove's net debt must be greater than minimum");
        uint256 price = priceFeed.fetchPrice();
        require((coll * price) / (debt - _amount) >= MCR, "BorrowerOps: An operation that would result in ICR < MCR is not permitted");
        require(musd.balanceOf(msg.sender) >= _amount, "BorrowerOps: Caller doesnt have enough mUSD to make repayment");
        if (!skipStateUpdate) troveManager.applyAdjustment(_borrower, 0, _amount);
        musd.burn(msg.sender, _amount + extraBurn);
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
        require(((coll + msg.value) * priceFeed.fetchPrice()) / debt >= MCR, "BorrowerOps: An operation that would result in ICR < MCR is not permitted");
        if (!skipStateUpdate) troveManager.applyAdjustment(_borrower, msg.value, 0);
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
