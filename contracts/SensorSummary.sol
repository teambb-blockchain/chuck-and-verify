// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SensorSummary
/// @notice Layout v1 of a sensor-signed per-leg temperature summary (EIP-712)
/// and its Merkle-rooted, hash-linked log. The layout is defined in
/// scripts/lib/sensor-summary.js; this library must hash identically, and
/// test/SensorSignature.test.js checks that it does.
library SensorSummary {
    struct Summary {
        bytes32 batchId;
        uint32 leg;
        address custodian;
        uint64 startTime;
        uint64 endTime;
        int16 rangeLowCentiC;
        int16 rangeHighCentiC;
        int16 minCentiC;
        int16 maxCentiC;
        uint32 secondsOutOfRange;
        uint32 readingCount;
        uint32 firstSeq;
        uint32 lastSeq;
        bytes32 logRoot;
    }

    struct Reading {
        uint32 seq;
        uint64 timestamp;
        int16 tempCentiC;
    }

    bytes32 internal constant TYPEHASH =
        keccak256(
            "TemperatureSummary(bytes32 batchId,uint32 leg,address custodian,uint64 startTime,uint64 endTime,int16 rangeLowCentiC,int16 rangeHighCentiC,int16 minCentiC,int16 maxCentiC,uint32 secondsOutOfRange,uint32 readingCount,uint32 firstSeq,uint32 lastSeq,bytes32 logRoot)"
        );

    /// @dev secp256k1 n / 2. Signatures with a larger s are rejected (EIP-2).
    uint256 private constant HALF_N =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /// @notice EIP-712 hashStruct(summary).
    /// @dev Every field is a static type, so abi.encode(struct) is the fields
    /// in order, each padded to 32 bytes (int16 sign-extended), which is
    /// exactly EIP-712 encodeData.
    function structHash(Summary memory s) internal pure returns (bytes32) {
        return keccak256(abi.encode(TYPEHASH, s));
    }

    /// @notice Checks a summary can be true of some log, whoever signed it.
    /// A gap in the counter is allowed: it is recorded, not refused.
    function isConsistent(Summary memory s) internal pure returns (bool) {
        return
            s.endTime > s.startTime &&
            s.rangeHighCentiC >= s.rangeLowCentiC &&
            s.maxCentiC >= s.minCentiC &&
            s.readingCount > 0 &&
            s.lastSeq >= s.firstSeq &&
            uint256(s.readingCount) <= uint256(s.lastSeq) - s.firstSeq + 1 &&
            uint256(s.secondsOutOfRange) <= uint256(s.endTime - s.startTime) &&
            s.logRoot != bytes32(0);
    }

    /// @notice Readings the counter says were taken but the log lacks.
    function missingReadings(Summary memory s) internal pure returns (uint256) {
        return uint256(s.lastSeq) - s.firstSeq + 1 - s.readingCount;
    }

    /// @notice leaf_i = keccak256(seq || timestamp || temp || leaf_(i-1)).
    function leaf(
        Reading memory r,
        bytes32 prevLeaf
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(r.seq, r.timestamp, r.tempCentiC, prevLeaf)
            );
    }

    /// @notice Sorted-pair Merkle proof check against `root`.
    function verifyProof(
        bytes32[] memory proof,
        bytes32 root,
        bytes32 leaf_
    ) internal pure returns (bool) {
        bytes32 h = leaf_;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h <= p
                ? keccak256(abi.encodePacked(h, p))
                : keccak256(abi.encodePacked(p, h));
        }
        return h == root;
    }

    /// @notice Signer of `digest`, or address(0) if the signature is
    /// malformed, high-s, or does not recover.
    function recover(
        bytes32 digest,
        bytes memory sig
    ) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (v < 27) v += 27; // some device libraries emit 0/1
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > HALF_N) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
