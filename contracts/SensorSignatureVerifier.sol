// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ICredentialRegistry.sol";
import "./SensorSummary.sol";

/// @title SensorSignatureVerifier
/// @notice Signing feasibility test (ADR 0004, stages 1-3): view functions
/// that check a sensor-signed per-leg temperature summary. No state, no
/// writes. The temperature contract (ADR 0005, §14 row 7) is expected to
/// reuse SensorSummary and this check, storing one summary per
/// (batchId, leg).
///
/// The check needs the leg the summary is for. In the temperature contract
/// every field of `Leg` must come from chain state, never from the caller:
/// `leg` from BeefSupplyChain.custodyLeg, the custodian who held the batch in
/// that leg, the sensor that custodian registered (one custodian = one zone =
/// one sensor in the proof of concept), and the required range. If the caller
/// could pick the sensor, a custodian holding any registered sensor key could
/// sign whatever summary it liked.
contract SensorSignatureVerifier {
    /// @dev The registry accepts any bytes32 type, so this works on the
    /// deployed registry with setIssuer and no redeploy (ADR 0005).
    bytes32 public constant CRED_SENSOR = keccak256("SENSOR");

    bytes32 public constant SUMMARY_TYPEHASH = SensorSummary.TYPEHASH;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
    bytes32 private constant NAME_HASH = keccak256("Chuck and Verify Sensor");
    bytes32 private constant VERSION_HASH = keccak256("1");

    /// @notice Why a summary was accepted or refused, in check order.
    enum Status {
        Valid,
        BadSignature, // malformed, high-s, or unrecoverable
        WrongSensor, // signed by a key other than the leg's sensor
        SensorNotRegistered, // leg's sensor holds no valid SENSOR credential
        WrongBatch,
        WrongLeg, // summary is for another custody leg of the batch
        WrongCustodian, // summary names a custodian other than the leg's
        WrongRange, // summary uses a range other than the required one
        EndsInFuture, // window ends after the current block
        Inconsistent // e.g. min above max, more readings than the counter range
    }

    /// @notice The on-chain facts about one custody leg.
    struct Leg {
        bytes32 batchId;
        uint32 leg;
        address custodian;
        address sensor;
        int16 rangeLowCentiC;
        int16 rangeHighCentiC;
    }

    ICredentialRegistry public immutable registry;

    constructor(ICredentialRegistry registry_) {
        registry = registry_;
    }

    function domainSeparator() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    DOMAIN_TYPEHASH,
                    NAME_HASH,
                    VERSION_HASH,
                    block.chainid,
                    address(this)
                )
            );
    }

    /// @notice EIP-712 hashStruct of a summary; domain-independent, so a fixed
    /// test vector can be compared with it.
    function structHash(
        SensorSummary.Summary memory s
    ) external pure returns (bytes32) {
        return SensorSummary.structHash(s);
    }

    /// @notice The digest passed to ecrecover.
    function summaryDigest(
        SensorSummary.Summary memory s
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    domainSeparator(),
                    SensorSummary.structHash(s)
                )
            );
    }

    /// @notice Address that signed `s`, or address(0) for a malformed or
    /// high-s signature.
    function recoverSigner(
        SensorSummary.Summary memory s,
        bytes memory sig
    ) public view returns (address) {
        return SensorSummary.recover(summaryDigest(s), sig);
    }

    /// @notice Check `s` against the leg it claims to describe.
    /// @return status  Status.Valid, or the first check that failed
    /// @return signer  the recovered address (address(0) if unrecoverable)
    function verify(
        SensorSummary.Summary memory s,
        bytes memory sig,
        Leg memory leg
    ) external view returns (Status status, address signer) {
        signer = recoverSigner(s, sig);
        if (signer == address(0)) return (Status.BadSignature, signer);
        if (signer != leg.sensor) return (Status.WrongSensor, signer);
        if (!registry.isValid(signer, CRED_SENSOR)) {
            return (Status.SensorNotRegistered, signer);
        }
        if (s.batchId != leg.batchId) return (Status.WrongBatch, signer);
        if (s.leg != leg.leg) return (Status.WrongLeg, signer);
        if (s.custodian != leg.custodian) return (Status.WrongCustodian, signer);
        if (
            s.rangeLowCentiC != leg.rangeLowCentiC ||
            s.rangeHighCentiC != leg.rangeHighCentiC
        ) return (Status.WrongRange, signer);
        if (s.endTime > block.timestamp) return (Status.EndsInFuture, signer);
        if (!SensorSummary.isConsistent(s)) return (Status.Inconsistent, signer);
        return (Status.Valid, signer);
    }

    /// @notice Readings the counter says were taken but the log lacks.
    function missingReadings(
        SensorSummary.Summary memory s
    ) external pure returns (uint256) {
        return SensorSummary.missingReadings(s);
    }

    /// @notice True if `r`, linked to `prevLeaf`, is in the log `s` commits
    /// to. Lets a custodian disclose one reading (an excursion, say) without
    /// publishing the rest of the log.
    function readingInLog(
        SensorSummary.Summary memory s,
        SensorSummary.Reading memory r,
        bytes32 prevLeaf,
        bytes32[] memory proof
    ) external pure returns (bool) {
        return
            r.seq >= s.firstSeq &&
            r.seq <= s.lastSeq &&
            SensorSummary.verifyProof(proof, s.logRoot, SensorSummary.leaf(r, prevLeaf));
    }
}
