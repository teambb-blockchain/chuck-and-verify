// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ProjectAnchor
/// @author Bhavana
/// @notice Anchors a commitment (a hash) on chain. The committed content
/// itself is stored off chain. Never anchor a value derived from personal data.
contract ProjectAnchor {
    address public immutable owner;
    bytes32 private commitment;
    uint256 public updatedAt;

    event CommitmentAnchored(
        bytes32 indexed commitment,
        address indexed by,
        uint256 timestamp
    );

    error NotOwner();
    error EmptyCommitment();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function anchor(bytes32 newCommitment) external onlyOwner {
        if (newCommitment == bytes32(0)) revert EmptyCommitment();
        commitment = newCommitment;
        updatedAt = block.timestamp;
        emit CommitmentAnchored(newCommitment, msg.sender, block.timestamp);
    }

    function current() external view returns (bytes32, uint256) {
        return (commitment, updatedAt);
    }
}
