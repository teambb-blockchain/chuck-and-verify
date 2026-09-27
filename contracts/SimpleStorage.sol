// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SimpleStorage {
    uint256 private value;

    event ValueChanged(uint256 oldValue, uint256 newValue);

    function set(uint256 newValue) external {
        emit ValueChanged(value, newValue);
        value = newValue;
    }

    function get() external view returns (uint256) {
        return value;
    }
}
