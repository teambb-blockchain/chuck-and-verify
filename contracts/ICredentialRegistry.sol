// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICredentialRegistry
/// @notice Minimal interface the operational chain uses to authorize writers.
interface ICredentialRegistry {
    function isValid(
        address holder,
        bytes32 credentialType
    ) external view returns (bool);
}
