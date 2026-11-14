// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Fork-test stand-in for Mezo's oracle precompile (0x7b7c...0015), which Hardhat cannot execute.
///      Installed with hardhat_setCode; the price lives in storage slot 0 and is always fresh.
contract StubAggregator {
    int256 public price;

    function setPrice(int256 p) external {
        price = p;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, price, block.timestamp, block.timestamp, 1);
    }
}
