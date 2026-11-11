// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ICredentialRegistry.sol";

/// @title BeefSupplyChain
/// @notice Operational-chain contract. Each write checks the credential
/// registry (except recall; see recordRecall); custody handoff completes only
/// when the receiver confirms receipt. v2 applies the fixes from
/// docs/SECURITY_REVIEW.md §5 (BSC-1, BSC-2, BSC-4, BSC-5, BSC-6).
///
/// Lots: the holder of a batch can split it once into 2–20 lots named
/// "<batch>-L1" … "<batch>-Ln". Each lot is its own custody record. A lot
/// reads its inspection from the batch it came from, and a recall of that
/// batch applies to every lot (see _effective).
///
/// Custody legs: custodyLeg counts confirmed receipts, so another contract
/// can tie a record (such as a temperature summary) to one holder's leg.
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

    uint256 public constant MAX_LOTS = 20;

    mapping(bytes32 => Batch) private batches;
    /// Lot ID → the batch it was split from. Zero for a batch that is not a lot.
    mapping(bytes32 => bytes32) private parentOf;
    /// Batch ID → how many lots it was split into. Zero means not split.
    mapping(bytes32 => uint8) private lotCount;
    /// Batch ID → number of confirmed receipts so far (see custodyLeg).
    mapping(bytes32 => uint256) private legOf;

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
    event LotCreated(
        bytes32 indexed parentId,
        bytes32 indexed lotId,
        address indexed holder,
        uint256 weightLbs
    );

    error Unauthorized();
    error BatchNotFound();
    error BatchAlreadyExists();
    error NotCurrentHolder();
    error NoPendingShipment();
    error NotPendingReceiver();
    error ZeroAddress();
    error EmptyBatchId();
    error NotBatchProcessor();
    error ZeroWeight();
    error EmptyReportHash();
    error SelfInspection();
    error AlreadyInspected();
    error BatchRecalled();
    error InvalidClassification();
    error EmptyNoticeHash();
    error RecallNotEscalated();
    error BadLotCount();
    error LotWeightMismatch();
    error ShipmentPending();
    error AlreadySplit();
    error LotCannotBeSplit();
    error LotNameTooLong();
    error InspectParentBatch();
    error ReservedLotName();

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
        if (weightLbs == 0) revert ZeroWeight(); // BSC-6
        // Names ending in "-L<digits>" belong to splitBatch, so no one can
        // take a lot's name ahead of the split and block it (BSC-10).
        if (_isLotName(batchId)) revert ReservedLotName();
        if (batches[batchId].exists) revert BatchAlreadyExists();

        _store(batchId, msg.sender, weightLbs, msg.sender);
        emit BatchRegistered(batchId, msg.sender, weightLbs);
    }

    /// @notice Split a batch in your custody into lots. `weights[i]` is the
    /// weight of lot i+1, and the weights must add up to the batch weight.
    /// A batch can be split once, a lot cannot be split, and a batch with a
    /// pending shipment cannot be split. A recalled batch can be split: its
    /// product still has to be tracked while it is retrieved (BSC-8).
    function splitBatch(bytes32 batchId, uint256[] calldata weights) external {
        if (!registry.isValid(msg.sender, CRED_CUSTODIAN)) revert Unauthorized();
        Batch storage parent = _requireBatch(batchId);
        if (parent.currentHolder != msg.sender) revert NotCurrentHolder();
        if (parentOf[batchId] != bytes32(0)) revert LotCannotBeSplit();
        if (lotCount[batchId] != 0) revert AlreadySplit();
        if (parent.pendingReceiver != address(0)) revert ShipmentPending();
        uint256 n = weights.length;
        if (n < 2 || n > MAX_LOTS) revert BadLotCount();

        uint256 total;
        for (uint256 i = 0; i < n; ++i) {
            uint256 weight = weights[i];
            if (weight == 0) revert ZeroWeight();
            total += weight;
            // Lot names are free: registerBatch refuses them, and a batch is
            // split only once.
            bytes32 lotId = _lotId(batchId, i + 1);
            _store(lotId, parent.processor, weight, msg.sender);
            parentOf[lotId] = batchId;
            emit LotCreated(batchId, lotId, msg.sender, weight);
        }
        if (total != parent.weightLbs) revert LotWeightMismatch();
        lotCount[batchId] = uint8(n);
    }

    /// @notice Record the inspection of a batch. An inspection is final: it
    /// cannot be overwritten (BSC-1), recorded on a recalled batch (BSC-1),
    /// or recorded by the batch's own processor (BSC-2).
    function recordInspection(
        bytes32 batchId,
        bytes32 reportHash,
        bool passed
    ) external {
        if (!registry.isValid(msg.sender, CRED_INSPECTOR)) revert Unauthorized();
        if (reportHash == bytes32(0)) revert EmptyReportHash(); // BSC-6
        Batch storage batch = _requireBatch(batchId);
        // A lot carries the inspection of the batch it came from.
        if (parentOf[batchId] != bytes32(0)) revert InspectParentBatch();
        if (batch.processor == msg.sender) revert SelfInspection(); // BSC-2
        if (batch.recalled) revert BatchRecalled(); // BSC-1
        if (batch.inspected) revert AlreadyInspected(); // BSC-1

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
        // A split batch lives on as its lots; shipping it too would count the
        // same product twice. (A split batch never has a pending shipment, so
        // confirmReceipt needs no matching check.)
        if (lotCount[batchId] != 0) revert AlreadySplit();

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
        ++legOf[batchId];

        emit ReceiptConfirmed(batchId, msg.sender);
    }

    /// @notice Record a recall. Only the processor that registered the batch
    /// may recall it (BSC-0). Its PROCESSOR credential need not still be valid:
    /// a recall only fails safe, and a lapsed or revoked plant must still be
    /// able to pull its product (BSC-4). Classification is USDA Class I–III,
    /// and a later recall may only escalate it to a lower class number (BSC-5).
    /// A lot can be recalled on its own; a recall of the batch it came from
    /// already applies to it, so a lot recall must be more serious than that.
    function recordRecall(
        bytes32 batchId,
        bytes32 noticeHash,
        uint8 classification
    ) external {
        Batch storage batch = _requireBatch(batchId);
        if (batch.processor != msg.sender) revert NotBatchProcessor();
        if (classification < 1 || classification > 3) revert InvalidClassification();
        if (noticeHash == bytes32(0)) revert EmptyNoticeHash();
        Batch memory current = _effective(batchId);
        if (current.recalled && classification >= current.recallClassification) {
            revert RecallNotEscalated();
        }

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
        Batch memory batch = _effective(batchId);
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

    /// @notice Where a batch sits in a split. For a lot, `parentId` is the
    /// batch it came from and `lotIds` is empty. For a split batch,
    /// `parentId` is zero and `lotIds` lists its lots in order.
    function getLotInfo(
        bytes32 batchId
    ) external view returns (bytes32 parentId, bytes32[] memory lotIds) {
        _requireBatch(batchId);
        parentId = parentOf[batchId];
        lotIds = new bytes32[](lotCount[batchId]);
        for (uint256 i = 0; i < lotIds.length; ++i) {
            lotIds[i] = _lotId(batchId, i + 1);
        }
    }

    /// @notice Which custody leg a batch is in: one holder's stretch of
    /// custody. Leg 0 is the first holder (the processor for a batch, the
    /// splitting custodian for a lot), and each confirmed receipt starts the
    /// next leg. A pending shipment stays in the sender's leg until the
    /// receiver confirms. Lets a separate contract (temperature summaries)
    /// key its records to one leg of one batch.
    function custodyLeg(bytes32 batchId) external view returns (uint256) {
        _requireBatch(batchId);
        return legOf[batchId];
    }

    function _requireBatch(
        bytes32 batchId
    ) private view returns (Batch storage batch) {
        batch = batches[batchId];
        if (!batch.exists) revert BatchNotFound();
    }

    function _store(
        bytes32 batchId,
        address processor,
        uint256 weightLbs,
        address holder
    ) private {
        batches[batchId] = Batch({
            batchId: batchId,
            processor: processor,
            weightLbs: weightLbs,
            currentHolder: holder,
            pendingReceiver: address(0),
            exists: true,
            inspected: false,
            inspectionPassed: false,
            inspectionReportHash: bytes32(0),
            recalled: false,
            recallNoticeHash: bytes32(0),
            recallClassification: 0
        });
    }

    /// A batch as the public should see it. A lot takes its parent's
    /// inspection, and its parent's recall when that is the more serious one
    /// (the lower class number). Reading through, rather than copying at
    /// split time, means a later inspection or recall of the parent still
    /// reaches every lot.
    function _effective(bytes32 batchId) private view returns (Batch memory b) {
        b = _requireBatch(batchId);
        bytes32 pid = parentOf[batchId];
        if (pid == bytes32(0)) return b;
        Batch storage p = batches[pid];
        b.inspected = p.inspected;
        b.inspectionPassed = p.inspectionPassed;
        b.inspectionReportHash = p.inspectionReportHash;
        if (p.recalled && (!b.recalled || p.recallClassification < b.recallClassification)) {
            b.recalled = true;
            b.recallNoticeHash = p.recallNoticeHash;
            b.recallClassification = p.recallClassification;
        }
    }

    /// Length of a readable ID: the bytes before its zero right-padding.
    function _nameLength(bytes32 id) private pure returns (uint256 len) {
        len = 32;
        while (len > 0 && id[len - 1] == 0) --len;
    }

    /// "<parent>-L<index>", for index 1–MAX_LOTS. Reverts LotNameTooLong past the
    /// 31-byte limit the portal applies to every batch ID.
    function _lotId(bytes32 parentId, uint256 index) private pure returns (bytes32 lotId) {
        uint256 len = _nameLength(parentId);
        bytes memory suffix = index < 10
            ? abi.encodePacked("-L", bytes1(uint8(48 + index)))
            : abi.encodePacked("-L", bytes1(uint8(48 + index / 10)), bytes1(uint8(48 + index % 10)));
        if (len + suffix.length > 31) revert LotNameTooLong();
        lotId = parentId; // bytes past `len` are zero, so the suffix can be OR-ed in
        for (uint256 k = 0; k < suffix.length; ++k) {
            lotId |= bytes32(suffix[k]) >> (8 * (len + k));
        }
    }

    /// True when an ID ends in "-L" followed by one or more digits.
    function _isLotName(bytes32 id) private pure returns (bool) {
        uint256 i = _nameLength(id);
        uint256 end = i;
        while (i > 0 && id[i - 1] >= "0" && id[i - 1] <= "9") --i;
        return i < end && i >= 2 && id[i - 1] == "L" && id[i - 2] == "-";
    }
}
