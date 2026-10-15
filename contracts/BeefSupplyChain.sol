// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ICredentialRegistry.sol";

/// @title BeefSupplyChain
/// @notice Skeleton operational-chain contract. Each write checks the credential
/// registry; custody handoff completes only when the receiver confirms receipt.
contract BeefSupplyChain {
    ICredentialRegistry public immutable registry;

    bytes32 public constant CRED_PROCESSOR = keccak256("PROCESSOR");
    bytes32 public constant CRED_INSPECTOR = keccak256("INSPECTOR");
    bytes32 public constant CRED_CUSTODIAN = keccak256("CUSTODIAN");

    struct Batch {
        bytes32 batchId;
        address processor;
        uint256 weightLbs;
        address currentHolder;
        address pendingReceiver;
        bool exists;
        bool inspected;
        bool inspectionPassed;
        bytes32 inspectionReportHash;
        bool recalled;
        bytes32 recallNoticeHash;
        uint8 recallClassification;
    }

    mapping(bytes32 => Batch) private batches;

    event BatchRegistered(
        bytes32 indexed batchId,
        address indexed processor,
        uint256 weightLbs
    );
    event InspectionRecorded(
        bytes32 indexed batchId,
        address indexed inspector,
        bytes32 reportHash,
        bool passed
    );
    event ShipmentRecorded(
        bytes32 indexed batchId,
        address indexed from,
        address indexed to
    );
    event ReceiptConfirmed(
        bytes32 indexed batchId,
        address indexed receiver
    );
    event RecallRecorded(
        bytes32 indexed batchId,
        address indexed by,
        bytes32 noticeHash,
        uint8 classification
    );

    error Unauthorized();
    error BatchNotFound();
    error BatchAlreadyExists();
    error NotCurrentHolder();
    error NoPendingShipment();
    error NotPendingReceiver();
    error ZeroAddress();
    error EmptyBatchId();

    constructor(address registryAddress) {
        if (registryAddress == address(0)) revert ZeroAddress();
        registry = ICredentialRegistry(registryAddress);
    }

    function registerBatch(
        bytes32 batchId,
        uint256 weightLbs
    ) external {
        if (!registry.isValid(msg.sender, CRED_PROCESSOR)) revert Unauthorized();
        if (batchId == bytes32(0)) revert EmptyBatchId();
        if (batches[batchId].exists) revert BatchAlreadyExists();

        batches[batchId] = Batch({
            batchId: batchId,
            processor: msg.sender,
            weightLbs: weightLbs,
            currentHolder: msg.sender,
            pendingReceiver: address(0),
            exists: true,
            inspected: false,
            inspectionPassed: false,
            inspectionReportHash: bytes32(0),
            recalled: false,
            recallNoticeHash: bytes32(0),
            recallClassification: 0
        });

        emit BatchRegistered(batchId, msg.sender, weightLbs);
    }

    function recordInspection(
        bytes32 batchId,
        bytes32 reportHash,
        bool passed
    ) external {
        if (!registry.isValid(msg.sender, CRED_INSPECTOR)) revert Unauthorized();
        Batch storage batch = _requireBatch(batchId);

        batch.inspected = true;
        batch.inspectionPassed = passed;
        batch.inspectionReportHash = reportHash;

        emit InspectionRecorded(batchId, msg.sender, reportHash, passed);
    }

    function recordShipment(bytes32 batchId, address to) external {
        if (!registry.isValid(msg.sender, CRED_CUSTODIAN)) revert Unauthorized();
        if (to == address(0)) revert ZeroAddress();
        Batch storage batch = _requireBatch(batchId);
        if (batch.currentHolder != msg.sender) revert NotCurrentHolder();

        batch.pendingReceiver = to;
        emit ShipmentRecorded(batchId, msg.sender, to);
    }

    function confirmReceipt(bytes32 batchId) external {
        if (!registry.isValid(msg.sender, CRED_CUSTODIAN)) revert Unauthorized();
        Batch storage batch = _requireBatch(batchId);
        if (batch.pendingReceiver == address(0)) revert NoPendingShipment();
        if (batch.pendingReceiver != msg.sender) revert NotPendingReceiver();

        batch.currentHolder = msg.sender;
        batch.pendingReceiver = address(0);

        emit ReceiptConfirmed(batchId, msg.sender);
    }

    function recordRecall(
        bytes32 batchId,
        bytes32 noticeHash,
        uint8 classification
    ) external {
        if (!registry.isValid(msg.sender, CRED_INSPECTOR)) revert Unauthorized();
        Batch storage batch = _requireBatch(batchId);

        batch.recalled = true;
        batch.recallNoticeHash = noticeHash;
        batch.recallClassification = classification;

        emit RecallRecorded(batchId, msg.sender, noticeHash, classification);
    }

    function getBatch(
        bytes32 batchId
    )
        external
        view
        returns (
            address processor,
            uint256 weightLbs,
            address currentHolder,
            address pendingReceiver,
            bool inspected,
            bool inspectionPassed,
            bytes32 inspectionReportHash,
            bool recalled,
            bytes32 recallNoticeHash,
            uint8 recallClassification
        )
    {
        Batch storage batch = _requireBatch(batchId);
        return (
            batch.processor,
            batch.weightLbs,
            batch.currentHolder,
            batch.pendingReceiver,
            batch.inspected,
            batch.inspectionPassed,
            batch.inspectionReportHash,
            batch.recalled,
            batch.recallNoticeHash,
            batch.recallClassification
        );
    }

    function _requireBatch(
        bytes32 batchId
    ) private view returns (Batch storage batch) {
        batch = batches[batchId];
        if (!batch.exists) revert BatchNotFound();
    }
}
