// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Subset of Mezo MUSD `BorrowerOperationsSignatures` (github.com/mezo-org/musd). On a signed repayment
///      the MUSD is burned from `msg.sender` of this contract (the "caller"), not from the borrower, which is
///      what lets RescueGuard repay out of a reserve it holds on the borrower's behalf.
interface IBorrowerOperationsSignatures {
    function repayMUSDWithSignature(
        uint256 _amount,
        address _upperHint,
        address _lowerHint,
        address _borrower,
        bytes memory _signature,
        uint256 _deadline
    ) external;

    function addCollWithSignature(
        address _upperHint,
        address _lowerHint,
        address _borrower,
        bytes memory _signature,
        uint256 _deadline
    ) external payable;

    function getNonce(address user) external view returns (uint256);

    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        );
}

interface ITroveManager {
    function getCurrentICR(address _borrower, uint256 _price) external view returns (uint256);

    function getTroveStatus(address _borrower) external view returns (uint8);
}

interface IPriceFeed {
    function fetchPrice() external view returns (uint256);
}

/**
 * @title RescueGuard
 * @notice Trigger-gated, non-custodial auto-rescue for Mezo MUSD troves.
 *
 * A borrower deposits a reserve (MUSD, pulled with EIP-2612 permit, or BTC) and stores a rescue plan: a
 * `RepayMUSD` or `AddColl` authorization signed for MUSD's own `BorrowerOperationsSignatures` contract, plus a
 * trigger collateral ratio. Anyone may call {execute}. The rescue only goes through if, at that block and at
 * the MUSD oracle price, the trove's ICR is strictly below the borrower's trigger. Funds can only ever leave
 * this contract in three ways: back to their owner ({withdrawMUSD}/{withdrawBTC}/{exit}), into the owner's own
 * trove as a repayment or collateral top-up, or as the owner-chosen keeper tip to whoever executed the rescue.
 *
 * There is no owner, no admin, no upgrade path and no fee.
 */
contract RescueGuard is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Kind {
        None,
        Repay,
        AddColl
    }

    enum Asset {
        MUSD,
        BTC
    }

    /// @notice Result of {planStatus}, ordered roughly by how a UI should explain it.
    enum Status {
        None,
        Waiting,
        Ready,
        Expired,
        StaleAuthorization,
        Underfunded,
        TroveNotActive,
        OracleUnavailable
    }

    struct Plan {
        Kind kind;
        uint64 deadline; // signature deadline (unix seconds), enforced again by BorrowerOperationsSignatures
        uint128 amount; // MUSD to repay (Repay) or BTC to add (AddColl), 18 decimals
        uint128 keeperTip; // paid to the executor in the plan's asset, capped at MAX_TIP_BPS of amount
        uint128 triggerIcr; // 1e18 = 100%; executes only while ICR < triggerIcr
        uint256 nonce; // BorrowerOperationsSignatures nonce the authorization was signed for
        bytes signature; // 65-byte ECDSA signature by the borrower
    }

    struct PlanInput {
        uint128 amount;
        uint128 keeperTip;
        uint128 triggerIcr;
        uint64 deadline;
    }

    struct PermitInput {
        uint256 value; // MUSD to deposit
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// @dev TroveManager.Status.active
    uint8 private constant TROVE_ACTIVE = 1;
    /// @notice Lowest accepted trigger (112%). The MUSD liquidation line (MCR) is 110%; a trigger must leave room
    ///         for the rescue to land before liquidators can act.
    uint128 public constant MIN_TRIGGER_ICR = 1.12e18;
    /// @notice Highest accepted trigger (400%): above this a "rescue" is just an early repayment.
    uint128 public constant MAX_TRIGGER_ICR = 4e18;
    /// @notice Keeper tip cap: 10% of the rescue amount.
    uint256 public constant MAX_TIP_BPS = 1_000;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    /// @dev Identical to the typehashes in BorrowerOperationsSignatures.
    bytes32 public constant REPAY_MUSD_TYPEHASH =
        keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");
    bytes32 public constant ADD_COLL_TYPEHASH =
        keccak256("AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)");

    IBorrowerOperationsSignatures public immutable borrowerOperationsSignatures;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IERC20 public immutable musd;

    mapping(address => Plan) private _plans;
    mapping(address => uint256) public musdReserve;
    mapping(address => uint256) public btcReserve;
    /// @notice Sum of all MUSD / BTC reserves. Invariant: never exceeds the contract's balance of that asset.
    uint256 public totalMusdReserves;
    uint256 public totalBtcReserves;

    event Deposited(address indexed user, Asset indexed asset, uint256 amount);
    event Withdrawn(address indexed user, Asset indexed asset, uint256 amount);
    event Armed(
        address indexed borrower,
        Kind kind,
        uint256 amount,
        uint256 keeperTip,
        uint256 triggerIcr,
        uint256 deadline,
        uint256 nonce
    );
    event Disarmed(address indexed borrower);
    event RescueExecuted(
        address indexed borrower,
        address indexed keeper,
        Kind kind,
        uint256 amount,
        uint256 keeperTip,
        uint256 icrBefore,
        uint256 icrAfter,
        uint256 price
    );

    error ZeroAddress();
    error ZeroAmount();
    error TriggerOutOfRange(uint256 triggerIcr);
    error TipTooHigh(uint256 keeperTip, uint256 maxTip);
    error DeadlineInPast(uint256 deadline);
    error TroveNotActive(address borrower);
    error InvalidAuthorization();
    error InsufficientReserve(uint256 available, uint256 required);
    error NoPlan(address borrower);
    error AuthorizationExpired(uint256 deadline);
    error StaleAuthorization(uint256 signedNonce, uint256 currentNonce);
    error TriggerNotReached(uint256 icr, uint256 triggerIcr);
    error UnexpectedBurn(uint256 expected, uint256 actual);
    error RescueDidNotImprove(uint256 icrBefore, uint256 icrAfter);
    error BTCTransferFailed();

    constructor(
        IBorrowerOperationsSignatures _borrowerOperationsSignatures,
        ITroveManager _troveManager,
        IPriceFeed _priceFeed,
        IERC20 _musd
    ) {
        if (
            address(_borrowerOperationsSignatures) == address(0) ||
            address(_troveManager) == address(0) ||
            address(_priceFeed) == address(0) ||
            address(_musd) == address(0)
        ) revert ZeroAddress();
        borrowerOperationsSignatures = _borrowerOperationsSignatures;
        troveManager = _troveManager;
        priceFeed = _priceFeed;
        musd = _musd;
    }

    // ------------------------------------------------------------------ reserves

    /// @notice Deposit MUSD into your reserve using a prior `approve`.
    function depositMUSD(uint256 amount) external nonReentrant {
        _pullMUSD(msg.sender, amount);
    }

    /// @notice Deposit MUSD into your reserve in one transaction with an EIP-2612 permit signature.
    function depositMUSDWithPermit(PermitInput calldata permit) external nonReentrant {
        _permitAndPull(permit);
    }

    /// @notice Deposit BTC (Mezo's native coin) into your reserve.
    function depositBTC() external payable nonReentrant {
        _addBTC(msg.sender, msg.value);
    }

    /// @notice Withdraw MUSD from your reserve. Always available, armed or not.
    function withdrawMUSD(uint256 amount) external nonReentrant {
        _withdrawMUSD(msg.sender, amount);
    }

    /// @notice Withdraw BTC from your reserve. Always available, armed or not.
    function withdrawBTC(uint256 amount) external nonReentrant {
        _withdrawBTC(msg.sender, amount);
    }

    /// @notice Cancel your plan and withdraw both reserves in one call.
    function exit() external nonReentrant {
        _disarm(msg.sender);
        uint256 m = musdReserve[msg.sender];
        uint256 b = btcReserve[msg.sender];
        if (m > 0) _withdrawMUSD(msg.sender, m);
        if (b > 0) _withdrawBTC(msg.sender, b);
    }

    // ------------------------------------------------------------------ plans

    /// @notice Store (or replace) a repay plan, funding it from your existing MUSD reserve.
    function armRepay(PlanInput calldata p, bytes calldata signature) external nonReentrant {
        _arm(Kind.Repay, p, signature);
    }

    /// @notice Deposit MUSD with a permit and store a repay plan in a single transaction (no separate approve).
    function armRepayWithPermit(
        PlanInput calldata p,
        bytes calldata signature,
        PermitInput calldata permit
    ) external nonReentrant {
        _permitAndPull(permit);
        _arm(Kind.Repay, p, signature);
    }

    /// @notice Store (or replace) a collateral top-up plan; any BTC sent is added to your reserve first.
    function armAddColl(PlanInput calldata p, bytes calldata signature) external payable nonReentrant {
        if (msg.value > 0) _addBTC(msg.sender, msg.value);
        _arm(Kind.AddColl, p, signature);
    }

    /// @notice Cancel your plan. Reserves stay deposited until you withdraw them.
    function disarm() external nonReentrant {
        _disarm(msg.sender);
    }

    /**
     * @notice Execute a borrower's rescue. Callable by anyone; succeeds only while the trove's ICR at the MUSD
     *         oracle price is below the borrower's trigger. The plan is consumed (one rescue per authorization).
     * @param upperHint SortedTroves hint for the trove's new position (any value is safe, good hints save gas)
     * @param lowerHint SortedTroves hint for the trove's new position
     */
    function execute(
        address borrower,
        address upperHint,
        address lowerHint
    ) external nonReentrant returns (uint256 icrBefore, uint256 icrAfter) {
        Plan memory plan = _plans[borrower];
        if (plan.kind == Kind.None) revert NoPlan(borrower);
        if (block.timestamp > plan.deadline) revert AuthorizationExpired(plan.deadline);
        if (troveManager.getTroveStatus(borrower) != TROVE_ACTIVE) revert TroveNotActive(borrower);
        uint256 currentNonce = borrowerOperationsSignatures.getNonce(borrower);
        if (currentNonce != plan.nonce) revert StaleAuthorization(plan.nonce, currentNonce);

        uint256 price = priceFeed.fetchPrice();
        icrBefore = troveManager.getCurrentICR(borrower, price);
        if (icrBefore >= plan.triggerIcr) revert TriggerNotReached(icrBefore, plan.triggerIcr);

        uint256 cost = uint256(plan.amount) + plan.keeperTip;
        delete _plans[borrower];

        if (plan.kind == Kind.Repay) {
            uint256 available = musdReserve[borrower];
            if (available < cost) revert InsufficientReserve(available, cost);
            musdReserve[borrower] = available - cost;
            totalMusdReserves -= cost;

            uint256 balanceBefore = musd.balanceOf(address(this));
            borrowerOperationsSignatures.repayMUSDWithSignature(
                plan.amount,
                upperHint,
                lowerHint,
                borrower,
                plan.signature,
                plan.deadline
            );
            uint256 burned = balanceBefore - musd.balanceOf(address(this));
            if (burned != plan.amount) revert UnexpectedBurn(plan.amount, burned);
            if (plan.keeperTip > 0) musd.safeTransfer(msg.sender, plan.keeperTip);
        } else {
            uint256 available = btcReserve[borrower];
            if (available < cost) revert InsufficientReserve(available, cost);
            btcReserve[borrower] = available - cost;
            totalBtcReserves -= cost;

            borrowerOperationsSignatures.addCollWithSignature{value: plan.amount}(
                upperHint,
                lowerHint,
                borrower,
                plan.signature,
                plan.deadline
            );
            if (plan.keeperTip > 0) _sendBTC(msg.sender, plan.keeperTip);
        }

        icrAfter = troveManager.getCurrentICR(borrower, price);
        if (icrAfter <= icrBefore) revert RescueDidNotImprove(icrBefore, icrAfter);

        emit RescueExecuted(borrower, msg.sender, plan.kind, plan.amount, plan.keeperTip, icrBefore, icrAfter, price);
    }

    // ------------------------------------------------------------------ views

    function getPlan(address borrower) external view returns (Plan memory) {
        return _plans[borrower];
    }

    /**
     * @notice What would happen if someone called {execute} for `borrower` right now.
     * @return status  see {Status}; `Ready` means every on-chain precondition RescueGuard checks is met
     * @return icr     the trove's current ICR at the oracle price (0 if unavailable)
     * @return price   the MUSD oracle price (0 if the oracle reverted)
     */
    function planStatus(address borrower) external view returns (Status status, uint256 icr, uint256 price) {
        Plan storage plan = _plans[borrower];
        if (plan.kind == Kind.None) return (Status.None, 0, 0);
        if (troveManager.getTroveStatus(borrower) != TROVE_ACTIVE) return (Status.TroveNotActive, 0, 0);

        try priceFeed.fetchPrice() returns (uint256 p) {
            price = p;
        } catch {
            return (Status.OracleUnavailable, 0, 0);
        }
        icr = troveManager.getCurrentICR(borrower, price);

        if (block.timestamp > plan.deadline) return (Status.Expired, icr, price);
        if (borrowerOperationsSignatures.getNonce(borrower) != plan.nonce) return (Status.StaleAuthorization, icr, price);
        uint256 cost = uint256(plan.amount) + plan.keeperTip;
        uint256 reserve = plan.kind == Kind.Repay ? musdReserve[borrower] : btcReserve[borrower];
        if (reserve < cost) return (Status.Underfunded, icr, price);
        if (icr >= plan.triggerIcr) return (Status.Waiting, icr, price);
        return (Status.Ready, icr, price);
    }

    /// @notice The EIP-712 digest a borrower must sign for a plan, computed from the live BorrowerOperationsSignatures domain.
    function authorizationDigest(Kind kind, address borrower, uint256 amount, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        if (kind == Kind.None) revert NoPlan(borrower);
        bytes32 typeHash = kind == Kind.Repay ? REPAY_MUSD_TYPEHASH : ADD_COLL_TYPEHASH;
        bytes32 structHash = keccak256(abi.encode(typeHash, amount, borrower, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    // ------------------------------------------------------------------ internals

    function _arm(Kind kind, PlanInput calldata p, bytes calldata signature) internal {
        address borrower = msg.sender;
        if (p.amount == 0) revert ZeroAmount();
        if (p.triggerIcr < MIN_TRIGGER_ICR || p.triggerIcr > MAX_TRIGGER_ICR) revert TriggerOutOfRange(p.triggerIcr);
        uint256 maxTip = (uint256(p.amount) * MAX_TIP_BPS) / 10_000;
        if (p.keeperTip > maxTip) revert TipTooHigh(p.keeperTip, maxTip);
        if (p.deadline <= block.timestamp) revert DeadlineInPast(p.deadline);
        if (troveManager.getTroveStatus(borrower) != TROVE_ACTIVE) revert TroveNotActive(borrower);

        uint256 nonce = borrowerOperationsSignatures.getNonce(borrower);
        bytes32 digest = authorizationDigest(kind, borrower, p.amount, nonce, p.deadline);
        // OZ ECDSA rejects malformed lengths and high-s (malleable) signatures.
        if (ECDSA.recover(digest, signature) != borrower) revert InvalidAuthorization();

        uint256 cost = uint256(p.amount) + p.keeperTip;
        uint256 reserve = kind == Kind.Repay ? musdReserve[borrower] : btcReserve[borrower];
        if (reserve < cost) revert InsufficientReserve(reserve, cost);

        _plans[borrower] = Plan({
            kind: kind,
            deadline: p.deadline,
            amount: p.amount,
            keeperTip: p.keeperTip,
            triggerIcr: p.triggerIcr,
            nonce: nonce,
            signature: signature
        });
        emit Armed(borrower, kind, p.amount, p.keeperTip, p.triggerIcr, p.deadline, nonce);
    }

    function _disarm(address borrower) internal {
        if (_plans[borrower].kind == Kind.None) return;
        delete _plans[borrower];
        emit Disarmed(borrower);
    }

    function _permitAndPull(PermitInput calldata permit) internal {
        // A front-runner can submit the same permit first; that only sets the allowance we need, so ignore the
        // failure and let transferFrom decide.
        try
            IERC20Permit(address(musd)).permit(
                msg.sender,
                address(this),
                permit.value,
                permit.deadline,
                permit.v,
                permit.r,
                permit.s
            )
        {} catch {}
        _pullMUSD(msg.sender, permit.value);
    }

    function _pullMUSD(address from, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        uint256 before = musd.balanceOf(address(this));
        musd.safeTransferFrom(from, address(this), amount);
        uint256 received = musd.balanceOf(address(this)) - before;
        musdReserve[from] += received;
        totalMusdReserves += received;
        emit Deposited(from, Asset.MUSD, received);
    }

    function _addBTC(address to, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        btcReserve[to] += amount;
        totalBtcReserves += amount;
        emit Deposited(to, Asset.BTC, amount);
    }

    function _withdrawMUSD(address to, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        uint256 available = musdReserve[to];
        if (available < amount) revert InsufficientReserve(available, amount);
        musdReserve[to] = available - amount;
        totalMusdReserves -= amount;
        musd.safeTransfer(to, amount);
        emit Withdrawn(to, Asset.MUSD, amount);
    }

    function _withdrawBTC(address to, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        uint256 available = btcReserve[to];
        if (available < amount) revert InsufficientReserve(available, amount);
        btcReserve[to] = available - amount;
        totalBtcReserves -= amount;
        _sendBTC(to, amount);
        emit Withdrawn(to, Asset.BTC, amount);
    }

    function _sendBTC(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert BTCTransferFailed();
    }

    function _domainSeparator() internal view returns (bytes32) {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract, , ) =
            borrowerOperationsSignatures.eip712Domain();
        return keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(version)), chainId, verifyingContract)
        );
    }
}
