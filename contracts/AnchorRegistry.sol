// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AnchorRegistry
/// @notice Anchors commitments to off-chain ciphertext for a beef batch.
///         Content lives off chain. `recordId` is the batch id: a random lot
///         key, or keccak256 of a lot code that names the product lot and
///         nothing about a person. Hashing a person-identifying key does not
///         make it safe to use here.
/// @dev PROCESSOR may anchor. INSPECTOR may verify. The deployer holds ADMIN
///      only, until those roles are granted. The last ADMIN cannot be revoked.
///      SelfVerification stays: a processor must not be the party that attests
///      its own batch. Custody handoffs stay on BeefSupplyChain; this contract
///      does not grant CUSTODIAN.
contract AnchorRegistry {
    bytes32 public constant ADMIN = keccak256("ADMIN");
    bytes32 public constant PROCESSOR = keccak256("PROCESSOR");
    bytes32 public constant INSPECTOR = keccak256("INSPECTOR");

    // CIDv0 is 46 characters. CIDv1 base32 is about 59. 128 fits both and
    // stops a processor from storing an arbitrary string.
    uint256 public constant MAX_CID_LENGTH = 128;

    struct Record {
        bytes32 digest; // SHA-256 of the stored ciphertext
        string cid; // bare content id: letters and digits only
        address submitter;
        uint64 submittedAt;
        address verifier;
        uint64 verifiedAt; // zero until verified
    }

    mapping(bytes32 => mapping(address => bool)) private _roles;
    mapping(bytes32 => Record) private _records;
    uint256 private _adminCount;

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
    error EmptyRecordId();
    error EmptyCid();
    error CidTooLong();
    error InvalidCid();
    error AlreadyAnchored();
    error UnknownRecord();
    error AlreadyVerified();
    error SelfVerification();
    error ZeroAddress();
    error LastAdmin();

    modifier onlyRole(bytes32 role) {
        if (!_roles[role][msg.sender]) revert NotAuthorized(role);
        _;
    }

    constructor() {
        _roles[ADMIN][msg.sender] = true;
        _adminCount = 1;
        emit RoleGranted(ADMIN, msg.sender, msg.sender);
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    function grantRole(bytes32 role, address account) external onlyRole(ADMIN) {
        if (account == address(0)) revert ZeroAddress();
        // A repeat grant must not bump the count, or the last admin could
        // revoke itself after granting ADMIN to the same account again.
        if (role == ADMIN && !_roles[ADMIN][account]) _adminCount += 1;
        _roles[role][account] = true;
        emit RoleGranted(role, account, msg.sender);
    }

    function revokeRole(bytes32 role, address account) external onlyRole(ADMIN) {
        if (role == ADMIN && _roles[ADMIN][account]) {
            if (_adminCount == 1) revert LastAdmin();
            _adminCount -= 1;
        }
        _roles[role][account] = false;
        emit RoleRevoked(role, account, msg.sender);
    }

    function anchor(bytes32 recordId, bytes32 digest, string calldata cid)
        external
        onlyRole(PROCESSOR)
    {
        if (recordId == bytes32(0)) revert EmptyRecordId();
        if (digest == bytes32(0)) revert EmptyDigest();
        _checkCid(cid);
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

    function _checkCid(string calldata cid) private pure {
        bytes calldata raw = bytes(cid);
        uint256 len = raw.length;
        if (len == 0) revert EmptyCid();
        if (len > MAX_CID_LENGTH) revert CidTooLong();
        for (uint256 i = 0; i < len; i++) {
            bytes1 c = raw[i];
            bool ok = (c >= 0x30 && c <= 0x39) ||
                (c >= 0x41 && c <= 0x5A) ||
                (c >= 0x61 && c <= 0x7A);
            if (!ok) revert InvalidCid();
        }
    }
}
