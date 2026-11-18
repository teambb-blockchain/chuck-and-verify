// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ICredentialRegistry.sol";
import "./SensorSummary.sol";
import "./SensorSignatureVerifier.sol";

/// The parts of BeefSupplyChain this contract reads.
interface IBeefSupplyChainLegs {
    function custodyLeg(bytes32 batchId) external view returns (uint256);

    function getBatch(bytes32 batchId)
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
        );
}

/// @title TemperatureLog
/// @notice The temperature contract of ADR 0005: one sensor-signed summary
/// per (batchId, custody leg), checked by the deployed
/// SensorSignatureVerifier and kept on chain.
///
/// Every fact the check needs comes from chain state, never from the caller
/// (see SensorSignatureVerifier): the leg is BeefSupplyChain.custodyLeg, the
/// custodian is that batch's current holder, the sensor is the one that
/// custodian registered here, and the range is fixed at deployment. So a
/// summary is recorded for a batch's current leg: by the holder before it
/// ships, or while its shipment is pending, and in any case before the next
/// receiver confirms receipt (BeefSupplyChain keeps no history of who held
/// a past leg). Anyone may send it; the sensor's signature is what counts.
///
/// One custodian, one zone, one sensor (the proof-of-concept assumption in
/// scripts/lib/sensor-summary.js). A custodian registers its sensor and can
/// replace it later; a recorded summary keeps the sensor that signed it.
contract TemperatureLog {
    bytes32 public constant CRED_CUSTODIAN = keccak256("CUSTODIAN");

    SensorSignatureVerifier public immutable verifier;
    IBeefSupplyChainLegs public immutable supplyChain;
    ICredentialRegistry public immutable registry;
    /// Required storage range in 0.01 °C, inclusive. Every summary must use it.
    int16 public immutable rangeLowCentiC;
    int16 public immutable rangeHighCentiC;

    struct Record {
        address custodian;
        address sensor;
        uint64 startTime;
        uint64 endTime;
        int16 minCentiC;
        int16 maxCentiC;
        uint32 secondsOutOfRange;
        uint32 readingCount;
        uint32 firstSeq;
        uint32 lastSeq;
        bytes32 logRoot;
        uint64 recordedAt;
    }

    /// Custodian → its registered sensor (zero if none).
    mapping(address => address) public sensorOf;
    /// Batch ID → leg → recorded summary (recordedAt is zero if none).
    mapping(bytes32 => mapping(uint32 => Record)) private records;

    event SensorRegistered(address indexed custodian, address indexed sensor);
    /// Missing readings = lastSeq - firstSeq + 1 - readingCount.
    event SummaryRecorded(
        bytes32 indexed batchId,
        uint32 indexed leg,
        address indexed custodian,
        Record record
    );

    error Unauthorized();
    error ZeroAddress();
    error BadRange();
    error NoSensor();
    error AlreadyRecorded();
    error NotCurrentLeg();
    /// The verifier's reason, as SensorSignatureVerifier.Status.
    error SummaryRejected(SensorSignatureVerifier.Status status);

    constructor(
        SensorSignatureVerifier verifier_,
        IBeefSupplyChainLegs supplyChain_,
        int16 rangeLowCentiC_,
        int16 rangeHighCentiC_
    ) {
        if (address(verifier_) == address(0) || address(supplyChain_) == address(0)) revert ZeroAddress();
        if (rangeHighCentiC_ < rangeLowCentiC_) revert BadRange();
        verifier = verifier_;
        supplyChain = supplyChain_;
        registry = verifier_.registry();
        rangeLowCentiC = rangeLowCentiC_;
        rangeHighCentiC = rangeHighCentiC_;
    }

    /// @notice Name the sensor that monitors your storage. Needs a valid
    /// CUSTODIAN credential. The sensor needs its own SENSOR credential for
    /// its summaries to be accepted; that is checked when one is recorded.
    function registerSensor(address sensor) external {
        if (!registry.isValid(msg.sender, CRED_CUSTODIAN)) revert Unauthorized();
        if (sensor == address(0)) revert ZeroAddress();
        sensorOf[msg.sender] = sensor;
        emit SensorRegistered(msg.sender, sensor);
    }

    /// @notice Record a sensor-signed summary for a batch's current custody leg.
    function recordSummary(SensorSummary.Summary calldata s, bytes calldata sig) external {
        uint256 currentLeg = supplyChain.custodyLeg(s.batchId); // reverts BatchNotFound
        if (s.leg != currentLeg) revert NotCurrentLeg();
        if (records[s.batchId][s.leg].recordedAt != 0) revert AlreadyRecorded();
        (, , address holder, , , , , , , ) = supplyChain.getBatch(s.batchId);
        address sensor = sensorOf[holder];
        if (sensor == address(0)) revert NoSensor();

        SensorSignatureVerifier.Leg memory leg = SensorSignatureVerifier.Leg({
            batchId: s.batchId,
            leg: uint32(currentLeg),
            custodian: holder,
            sensor: sensor,
            rangeLowCentiC: rangeLowCentiC,
            rangeHighCentiC: rangeHighCentiC
        });
        (SensorSignatureVerifier.Status status, ) = verifier.verify(s, sig, leg);
        if (status != SensorSignatureVerifier.Status.Valid) revert SummaryRejected(status);

        Record memory record = Record({
            custodian: holder,
            sensor: sensor,
            startTime: s.startTime,
            endTime: s.endTime,
            minCentiC: s.minCentiC,
            maxCentiC: s.maxCentiC,
            secondsOutOfRange: s.secondsOutOfRange,
            readingCount: s.readingCount,
            firstSeq: s.firstSeq,
            lastSeq: s.lastSeq,
            logRoot: s.logRoot,
            recordedAt: uint64(block.timestamp)
        });
        records[s.batchId][s.leg] = record;
        emit SummaryRecorded(s.batchId, s.leg, holder, record);
    }

    /// @notice The summary recorded for one leg of a batch (recordedAt is
    /// zero if there is none).
    function getSummary(bytes32 batchId, uint32 leg) external view returns (Record memory) {
        return records[batchId][leg];
    }
}
