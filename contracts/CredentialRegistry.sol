// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ICredentialRegistry.sol";

/// @title CredentialRegistry
/// @notice Simulated administrative-chain registry. Admin assigns one issuer per
/// credential type; that issuer alone may grant or revoke credentials of that type.
contract CredentialRegistry is ICredentialRegistry {
    address public immutable admin;

    bytes32 public constant CRED_PROCESSOR = keccak256("PROCESSOR");
    bytes32 public constant CRED_INSPECTOR = keccak256("INSPECTOR");
    bytes32 public constant CRED_CUSTODIAN = keccak256("CUSTODIAN");

    struct Credential {
        uint256 expiresAt;
        bool revoked;
        bool exists;
    }

    mapping(bytes32 => address) public issuerOf;
    mapping(address => mapping(bytes32 => Credential)) private credentials;

    event IssuerSet(
        bytes32 indexed credentialType,
        address indexed issuer,
        address indexed by
    );
    event CredentialGranted(
        address indexed holder,
        bytes32 indexed credentialType,
        uint256 expiresAt,
        address indexed by
    );
    event CredentialRevoked(
        address indexed holder,
        bytes32 indexed credentialType,
        address indexed by
    );

    error NotAdmin();
    error NotIssuer();
    error InvalidExpiry();
    error CredentialNotFound();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /// @notice Assign the sole issuer for `credentialType`. Only admin.
    function setIssuer(
        bytes32 credentialType,
        address issuer
    ) external onlyAdmin {
        if (issuer == address(0)) revert ZeroAddress();
        issuerOf[credentialType] = issuer;
        emit IssuerSet(credentialType, issuer, msg.sender);
    }

    /// @notice Grant or renew a credential for `holder` until `expiresAt`.
    /// Only the issuer registered for `credentialType` may call this.
    function grant(
        address holder,
        bytes32 credentialType,
        uint256 expiresAt
    ) external {
        if (msg.sender != issuerOf[credentialType]) revert NotIssuer();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        credentials[holder][credentialType] = Credential({
            expiresAt: expiresAt,
            revoked: false,
            exists: true
        });
        emit CredentialGranted(holder, credentialType, expiresAt, msg.sender);
    }

    /// @notice Revoke an existing credential so `isValid` returns false.
    /// Only the issuer registered for `credentialType` may call this.
    function revoke(address holder, bytes32 credentialType) external {
        if (msg.sender != issuerOf[credentialType]) revert NotIssuer();
        Credential storage cred = credentials[holder][credentialType];
        if (!cred.exists) revert CredentialNotFound();
        cred.revoked = true;
        emit CredentialRevoked(holder, credentialType, msg.sender);
    }

    /// @inheritdoc ICredentialRegistry
    function isValid(
        address holder,
        bytes32 credentialType
    ) external view returns (bool) {
        Credential storage cred = credentials[holder][credentialType];
        if (!cred.exists || cred.revoked) return false;
        return block.timestamp <= cred.expiresAt;
    }
}
