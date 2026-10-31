// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A deliberately vulnerable escrow vault. Do not deploy to a live chain.
///         Every public function hides at least one defect.
contract VulnerableVault {
    address public owner;
    mapping(address => uint256) public balances;
    bool public paused;

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    // Withdraw your balance.
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient");
        (bool ok, ) = msg.sender.call{value: amount}("");
        balances[msg.sender] -= amount;
    }

    // Move the vault to a new owner.
    function setOwner(address newOwner) external {
        owner = newOwner;
    }

    // Emergency: send the whole balance to an address.
    function sweep(address to) external {
        require(msg.sender == owner, "not owner");
        (bool ok, ) = to.call{value: address(this).balance}("");
    }

    function setPaused(bool v) external {
        require(msg.sender == owner, "not owner");
        paused = v;
    }
}