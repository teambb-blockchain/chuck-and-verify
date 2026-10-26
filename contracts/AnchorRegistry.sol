// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AnchorRegistry
/// @notice Anchors commitments to off-chain ciphertext for a beef batch.
///         Content lives off chain. `recordId` is the batch id: a random lot
///         key, or keccak256 of a lot code that names the product lot and
///         nothing about a person. Hashing a person-identifying key does not
///         make it safe to use here.
/// @dev PROCESSOR may anchor. INSPECTOR may verify. The deployer holds ADMIN
///      only, until those roles are granted. SelfVerification stays: a
///      processor must not be the party that attests its own batch. Custody
///      handoffs stay on BeefSupplyChain; this contract does not grant
///      CUSTODIAN.
contract AnchorRegistry {
    bytes32 public constant ADMIN = keccak256("ADMIN");
    bytes32 public constant PROCESSOR = keccak256("PROCESSOR");
    bytes32 public constant INSPECTOR = keccak256("INSPECTOR");

    struct Record {
        bytes32 digest; // SHA-256 of the stored ciphertext
        string cid; // where the object lives
        address submitter;
        uint64 submittedAt;
        address verifier;
        uint64 verifiedAt; // zero until verified
    }

    mapping(bytes32 => mapping(address => bool)) private _roles;
    mapping(bytes32 => Record) private _records;

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed by);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed by);
    event RecordAnchored(
        bytes32 indexed recordId,
        bytes32 indexed digest,
        address indexed submitter,
        string cid
    );
    event RecordVerified(bytes32 indexed recordId, address indexed verifier, uint64 at);

    error NotAuthorized(bytes32 role);
    error EmptyDigest();
    error AlreadyAnchored();
    error UnknownRecord();
    error AlreadyVerified();
    error SelfVerification();

    modifier onlyRole(bytes32 role) {
        if (!_roles[role][msg.sender]) revert NotAuthorized(role);
        _;
    }

    constructor() {
        _roles[ADMIN][msg.sender] = true;
        emit RoleGranted(ADMIN, msg.sender, msg.sender);
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    function grantRole(bytes32 role, address account) external onlyRole(ADMIN) {
        _roles[role][account] = true;
        emit RoleGranted(role, account, msg.sender);
    }

    function revokeRole(bytes32 role, address account) external onlyRole(ADMIN) {
        _roles[role][account] = false;
        emit RoleRevoked(role, account, msg.sender);
    }

    function anchor(bytes32 recordId, bytes32 digest, string calldata cid)
        external
        onlyRole(PROCESSOR)
    {
        if (digest == bytes32(0)) revert EmptyDigest();
        if (_records[recordId].submittedAt != 0) revert AlreadyAnchored();

        _records[recordId] = Record({
            digest: digest,
            cid: cid,
            submitter: msg.sender,
            submittedAt: uint64(block.timestamp),
            verifier: address(0),
            verifiedAt: 0
        });

        emit RecordAnchored(recordId, digest, msg.sender, cid);
    }

    function verify(bytes32 recordId) external onlyRole(INSPECTOR) {
        Record storage r = _records[recordId];
        if (r.submittedAt == 0) revert UnknownRecord();
        if (r.verifiedAt != 0) revert AlreadyVerified();
        if (r.submitter == msg.sender) revert SelfVerification();

        r.verifier = msg.sender;
        r.verifiedAt = uint64(block.timestamp);

        emit RecordVerified(recordId, msg.sender, uint64(block.timestamp));
    }

    function get(bytes32 recordId) external view returns (Record memory) {
        return _records[recordId];
    }
}
