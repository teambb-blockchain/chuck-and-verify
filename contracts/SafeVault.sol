// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SafeVault {
    address public owner;
    mapping(address => uint256) public balances;

    error NotOwner();
    error InsufficientBalance();
    error ZeroAddress();
    error TransferFailed();

    // reentrancy guard
    uint256 private _lock = 1;
    modifier nonReentrant() {
        if (_lock != 1) revert TransferFailed();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    event OwnerChanged(address indexed from, address indexed to);
    event Withdrawn(address indexed who, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        // checks → effects → interactions:
        // reduce the balance BEFORE sending
        balances[msg.sender] -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount);
    }

    function setOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
    }
}