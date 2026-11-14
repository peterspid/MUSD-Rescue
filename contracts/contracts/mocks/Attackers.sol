// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IGuard {
    function execute(address borrower, address upperHint, address lowerHint) external returns (uint256, uint256);
    function withdrawBTC(uint256 amount) external;
    function depositBTC() external payable;
}

/// @dev Keeper that tries to re-enter RescueGuard when it receives its BTC tip.
contract ReentrantKeeper {
    IGuard public immutable guard;
    address public target;
    bool public reentered;

    constructor(IGuard g) {
        guard = g;
    }

    function run(address borrower) external {
        target = borrower;
        guard.execute(borrower, address(0), address(0));
    }

    receive() external payable {
        reentered = true;
        // Second execute on the same (now consumed) plan or any other entry point must fail.
        guard.execute(target, address(0), address(0));
    }
}

/// @dev Reserve owner that tries to withdraw twice by re-entering from its receive hook.
contract ReentrantWithdrawer {
    IGuard public immutable guard;
    uint256 public chunk;

    constructor(IGuard g) {
        guard = g;
    }

    function fund() external payable {
        guard.depositBTC{value: msg.value}();
    }

    function drain(uint256 amount) external {
        chunk = amount;
        guard.withdrawBTC(amount);
    }

    receive() external payable {
        if (address(guard).balance >= chunk) guard.withdrawBTC(chunk);
    }
}
