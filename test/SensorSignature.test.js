// Signing feasibility test, software path (ADR 0004 stages 1-3, §14 row 5).
//
// Pass criteria from the checkpoint plan:
//   - the address recovered on chain matches the registered sensor key
//   - a tampered message, a wrong key and an unregistered key each fail
//   - the layout lives in one shared file (scripts/lib/sensor-summary.js),
//     and the Solidity hashing matches it
//
// What is signed is the per-leg summary (0002), keyed by (batchId, leg) with
// leg = BeefSupplyChain.custodyLeg (0005), over a counter-numbered,
// hash-linked, Merkle-rooted log. The checks the temperature contract
// (row 7) depends on are tested here too.

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const layout = require("../scripts/lib/sensor-summary");
const vector = require("../scripts/lib/sensor-summary.vector.json");

const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const ONE_YEAR = 365 * 24 * 60 * 60;
const HOUR = 3600n;

// Mirrors SensorSignatureVerifier.Status.
const Status = {
  Valid: 0n,
  BadSignature: 1n,
  WrongSensor: 2n,
  SensorNotRegistered: 3n,
  WrongBatch: 4n,
  WrongLeg: 5n,
  WrongCustodian: 6n,
  WrongRange: 7n,
  EndsInFuture: 8n,
  Inconsistent: 9n,
};

describe("Sensor signing feasibility (software path)", function () {
  let registry, verifier, domain;
  let sensorIssuer, custodianIssuer, custodian, nextCustodian;
  let sensor, otherSensor, unregistered;
  let CRED_SENSOR, CRED_CUSTODIAN;

  const T0 = 1793750400n; // 2026-11-04T00:00:00Z, before the test chain's clock
  const BATCH = ethers.encodeBytes32String("BB-2026-014");
  const RANGE = { rangeLowCentiC: -220n, rangeHighCentiC: 444n };
  const COLD = [210, 180, 190, 230, 250, 240, 220, 200, 190, 185, 180, 175];
  const WARM = [210, 180, 190, 230, 520, 610, 300, 220, 200, 190, 185, 180];

  // The leg as the chain would record it.
  const legFor = (overrides = {}) => ({
    batchId: BATCH,
    leg: 1n,
    custodian: custodian.address,
    sensor: sensor.address,
    ...RANGE,
    ...overrides,
  });
  const legTuple = (l) => [
    l.batchId, l.leg, l.custodian, l.sensor, l.rangeLowCentiC, l.rangeHighCentiC,
  ];
  const summaryTuple = (s) => layout.TYPES.TemperatureSummary.map((f) => s[f.name]);
  const readingTuple = (r) => [r.seq, r.timestamp, r.tempCentiC];

  // A reading every 30 minutes from `start`, counter from `seq0`.
  function readings(temps, { start = T0, seq0 = 1001n } = {}) {
    return temps.map((tempCentiC, i) => ({
      seq: seq0 + BigInt(i),
      timestamp: start + BigInt(i) * 1800n,
      tempCentiC: BigInt(tempCentiC),
    }));
  }

  function summaryFor(leg = legFor(), log = readings(COLD), window = {}) {
    return layout.summarize(
      {
        batchId: leg.batchId,
        leg: leg.leg,
        custodian: leg.custodian,
        startTime: window.startTime ?? T0,
        endTime: window.endTime ?? T0 + 6n * HOUR,
        rangeLowCentiC: leg.rangeLowCentiC,
        rangeHighCentiC: leg.rangeHighCentiC,
      },
      log
    );
  }

  async function check(summary, sig, leg = legFor()) {
    const [status, signer] = await verifier.verify(
      summaryTuple(summary),
      sig,
      legTuple(leg)
    );
    return { status, signer };
  }

  async function grantSensor(wallet, ttl = ONE_YEAR) {
    await registry
      .connect(sensorIssuer)
      .grant(wallet.address, CRED_SENSOR, (await time.latest()) + ttl);
  }

  beforeEach(async function () {
    [, sensorIssuer, custodianIssuer, custodian, nextCustodian] =
      await ethers.getSigners();

    const Registry = await ethers.getContractFactory("CredentialRegistry");
    registry = await Registry.deploy();
    const Verifier = await ethers.getContractFactory("SensorSignatureVerifier");
    verifier = await Verifier.deploy(await registry.getAddress());

    CRED_SENSOR = await verifier.CRED_SENSOR();
    CRED_CUSTODIAN = await registry.CRED_CUSTODIAN();
    await registry.setIssuer(CRED_SENSOR, sensorIssuer.address);
    await registry.setIssuer(CRED_CUSTODIAN, custodianIssuer.address);

    // Sensor keys never send transactions, so plain wallets are enough.
    sensor = ethers.Wallet.createRandom();
    otherSensor = ethers.Wallet.createRandom();
    unregistered = ethers.Wallet.createRandom();
    await grantSensor(sensor);
    await grantSensor(otherSensor);

    domain = {
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifier: await verifier.getAddress(),
    };
  });

  describe("shared layout", function () {
    it("CRED_SENSOR is keccak256(\"SENSOR\")", async function () {
      expect(CRED_SENSOR).to.equal(ethers.id("SENSOR"));
    });

    it("type hash and domain separator match the JS definition", async function () {
      expect(await verifier.SUMMARY_TYPEHASH()).to.equal(layout.TYPEHASH);
      expect(await verifier.domainSeparator()).to.equal(layout.domainSeparator(domain));
    });

    it("Solidity hashing matches scripts/lib/sensor-summary.js, including edge values", async function () {
      const base = summaryFor();
      const cases = [
        base,
        { ...base, minCentiC: -32768n, maxCentiC: 32767n, rangeLowCentiC: -32768n },
        {
          ...base,
          batchId: ethers.hexlify(ethers.randomBytes(32)),
          leg: 2n ** 32n - 1n,
          startTime: 0n,
          endTime: 2n ** 64n - 1n,
          secondsOutOfRange: 2n ** 32n - 1n,
          readingCount: 2n ** 32n - 1n,
          firstSeq: 0n,
          lastSeq: 2n ** 32n - 1n,
        },
      ];
      for (const s of cases) {
        expect(await verifier.structHash(summaryTuple(s))).to.equal(layout.structHash(s));
        expect(await verifier.summaryDigest(summaryTuple(s))).to.equal(
          layout.digest(s, domain)
        );
      }
    });

    it("the committed test vector still matches the layout and the contract", async function () {
      const log = vector.log;
      const summary = layout.summarize(
        { ...log, batchId: ethers.encodeBytes32String(log.batch) },
        log.readings
      );
      for (const [k, v] of Object.entries(vector.summary)) {
        expect(summary[k], k).to.equal(typeof summary[k] === "bigint" ? BigInt(v) : v);
      }
      expect(layout.missingReadings(summary)).to.equal(BigInt(vector.missingReadings));
      expect(log.readings.map(layout.encodeReading)).to.deep.equal(vector.readingBytes);
      for (const b of vector.readingBytes) {
        expect(ethers.dataLength(b)).to.equal(layout.READING_BYTES);
      }
      expect(layout.logLeaves(log.readings)).to.deep.equal(vector.leaves);
      expect(layout.TYPEHASH).to.equal(vector.typeHash);
      const d = { chainId: vector.domain.chainId, verifier: vector.domain.verifyingContract };
      expect(layout.domainSeparator(d)).to.equal(vector.domainSeparator);
      expect(layout.structHash(summary)).to.equal(vector.structHash);
      expect(await verifier.structHash(summaryTuple(summary))).to.equal(vector.structHash);
      expect(layout.digest(summary, d)).to.equal(vector.digest);
      const wallet = new ethers.Wallet(vector.privateKey);
      expect(wallet.address).to.equal(vector.sensor);
      expect(await layout.sign(wallet, summary, d)).to.equal(vector.signature);
      expect(ethers.recoverAddress(vector.digest, vector.signature)).to.equal(vector.sensor);

      const p = vector.readingProof;
      expect(
        await verifier.readingInLog(summaryTuple(summary), readingTuple(p.reading), p.prevLeaf, p.proof)
      ).to.equal(true);
    });
  });

  describe("the log behind a summary", function () {
    it("counts the time each out-of-range reading stands for", function () {
      // 5.20 °C and 6.10 °C, 30 minutes each, above the 4.44 °C limit.
      const s = summaryFor(legFor(), readings(WARM));
      expect(s.minCentiC).to.equal(180n);
      expect(s.maxCentiC).to.equal(610n);
      expect(s.secondsOutOfRange).to.equal(3600n);
      expect(s.readingCount).to.equal(12n);
      expect([s.firstSeq, s.lastSeq]).to.deep.equal([1001n, 1012n]);
    });

    it("the first reading covers from the window start and the last to its end", function () {
      const log = [
        { seq: 1n, timestamp: T0 + HOUR, tempCentiC: 600n },
        { seq: 2n, timestamp: T0 + 5n * HOUR, tempCentiC: 600n },
      ];
      expect(summaryFor(legFor(), log).secondsOutOfRange).to.equal(6n * HOUR);
    });

    it("a dropped reading shows as a gap in the counter, on and off chain", async function () {
      const log = readings(COLD).filter((r) => r.seq !== 1005n);
      const s = summaryFor(legFor(), log);
      expect(layout.missingReadings(s)).to.equal(1n);
      expect(await verifier.missingReadings(summaryTuple(s))).to.equal(1n);
      // Recorded, not refused.
      const sig = await layout.sign(sensor, s, domain);
      expect((await check(s, sig)).status).to.equal(Status.Valid);
    });

    it("an edited, reordered or trimmed log no longer matches the signed root", function () {
      const log = readings(WARM);
      const root = layout.logRoot(log);
      const edited = log.map((r) => (r.tempCentiC > 444n ? { ...r, tempCentiC: 400n } : r));
      const swapped = [...log];
      [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
      expect(layout.logRoot(edited)).to.not.equal(root);
      expect(layout.logRoot(swapped)).to.not.equal(root);
      expect(layout.logRoot(log.slice(0, -1))).to.not.equal(root);
      expect(summaryFor(legFor(), edited).secondsOutOfRange).to.equal(0n);
    });

    it("every reading can be proven on its own, in JS and on chain, for odd and even logs", async function () {
      for (const n of [1, 2, 3, 5, 8, 12]) {
        const log = readings(WARM.slice(0, n));
        const s = summaryFor(legFor(), log);
        for (let i = 0; i < n; i++) {
          const { reading, prevLeaf, proof } = layout.proveReading(log, i);
          expect(layout.verifyProof(layout.leafFor(reading, prevLeaf), proof, s.logRoot)).to.equal(true);
          expect(
            await verifier.readingInLog(summaryTuple(s), readingTuple(reading), prevLeaf, proof)
          ).to.equal(true);
        }
      }
    });

    it("a proof fails for an altered reading, a wrong link or a seq outside the range", async function () {
      const log = readings(WARM);
      const s = summaryFor(legFor(), log);
      const { reading, prevLeaf, proof } = layout.proveReading(log, 5);
      const st = summaryTuple(s);
      const ok = (r, prev, pr = proof) => verifier.readingInLog(st, readingTuple(r), prev, pr);
      expect(await ok({ ...reading, tempCentiC: 300n }, prevLeaf)).to.equal(false);
      expect(await ok(reading, ethers.ZeroHash)).to.equal(false);
      expect(await ok(reading, prevLeaf, proof.slice(1))).to.equal(false);
      // A leaf from another log cannot be claimed against this root either.
      const other = readings(COLD);
      const foreign = layout.proveReading(other, 5);
      expect(await ok(foreign.reading, foreign.prevLeaf, foreign.proof)).to.equal(false);
      // seq outside [firstSeq, lastSeq] is refused even before the proof.
      expect(await ok({ ...reading, seq: s.lastSeq + 1n }, prevLeaf)).to.equal(false);
    });

    it("rejects logs that cannot describe the window", function () {
      const leg = { ...legFor(), startTime: T0, endTime: T0 + HOUR };
      const r = (seq, t, c = 200n) => ({ seq, timestamp: t, tempCentiC: c });
      expect(() => layout.summarize(leg, [])).to.throw(RangeError);
      expect(() => layout.summarize(leg, [r(1n, T0 - 1n)])).to.throw(RangeError);
      expect(() => layout.summarize(leg, [r(1n, T0 + 2n * HOUR)])).to.throw(RangeError);
      expect(() => layout.summarize(leg, [r(1n, T0 + 10n), r(2n, T0 + 10n)])).to.throw(RangeError);
      expect(() => layout.summarize(leg, [r(2n, T0), r(2n, T0 + 10n)])).to.throw(RangeError);
      expect(() => layout.summarize(leg, [r(3n, T0), r(2n, T0 + 10n)])).to.throw(RangeError);
      expect(() => layout.summarize(leg, [r(1n, T0, 32768n)])).to.throw(RangeError);
      expect(() => layout.summarize({ ...leg, endTime: T0 }, [r(1n, T0)])).to.throw(RangeError);
    });
  });

  describe("pass criterion: a registered sensor's summary verifies", function () {
    it("recovers the registered sensor address on chain", async function () {
      const s = summaryFor();
      const sig = await layout.sign(sensor, s, domain);
      expect(await verifier.recoverSigner(summaryTuple(s), sig)).to.equal(sensor.address);
      const { status, signer } = await check(s, sig);
      expect(signer).to.equal(sensor.address);
      expect(status).to.equal(Status.Valid);
    });

    it("accepts v as 0/1 as well as 27/28 (device libraries differ)", async function () {
      const s = summaryFor();
      const sig = ethers.Signature.from(await layout.sign(sensor, s, domain));
      const raw = ethers.concat([sig.r, sig.s, ethers.toBeHex(sig.yParity, 1)]);
      expect((await check(s, raw)).status).to.equal(Status.Valid);
    });
  });

  describe("negative cases from the plan", function () {
    it("tampered message: any changed field fails", async function () {
      const s = summaryFor();
      const sig = await layout.sign(sensor, s, domain);
      const tampered = [
        { ...s, maxCentiC: s.maxCentiC - 100n },
        { ...s, secondsOutOfRange: s.secondsOutOfRange + 1800n },
        { ...s, logRoot: ethers.id("another log") },
        { ...s, custodian: nextCustodian.address },
        { ...s, leg: s.leg + 1n },
        { ...s, firstSeq: s.firstSeq + 1n },
        { ...s, endTime: s.endTime - HOUR },
      ];
      for (const t of tampered) {
        const { status, signer } = await check(t, sig);
        expect(signer).to.not.equal(sensor.address);
        expect(status).to.equal(Status.WrongSensor);
      }
    });

    it("wrong key: a different sensor, even a registered one, fails", async function () {
      const s = summaryFor();
      const sig = await layout.sign(otherSensor, s, domain);
      const { status, signer } = await check(s, sig);
      expect(signer).to.equal(otherSensor.address);
      expect(status).to.equal(Status.WrongSensor);
    });

    it("unregistered key: the leg's sensor with no SENSOR credential fails", async function () {
      const leg = legFor({ sensor: unregistered.address });
      const s = summaryFor(leg);
      const sig = await layout.sign(unregistered, s, domain);
      expect((await check(s, sig, leg)).status).to.equal(Status.SensorNotRegistered);
    });
  });

  describe("other credential and signature cases", function () {
    it("a credential of another type (CUSTODIAN) does not count as SENSOR", async function () {
      await registry
        .connect(custodianIssuer)
        .grant(unregistered.address, CRED_CUSTODIAN, (await time.latest()) + ONE_YEAR);
      const leg = legFor({ sensor: unregistered.address });
      const s = summaryFor(leg);
      const sig = await layout.sign(unregistered, s, domain);
      expect((await check(s, sig, leg)).status).to.equal(Status.SensorNotRegistered);
    });

    it("revoked and expired sensor credentials fail", async function () {
      const s = summaryFor();
      const sig = await layout.sign(sensor, s, domain);
      await registry.connect(sensorIssuer).revoke(sensor.address, CRED_SENSOR);
      expect((await check(s, sig)).status).to.equal(Status.SensorNotRegistered);

      const shortLived = ethers.Wallet.createRandom();
      await grantSensor(shortLived, 60);
      const leg = legFor({ sensor: shortLived.address });
      const sig2 = await layout.sign(shortLived, s, domain);
      expect((await check(s, sig2, leg)).status).to.equal(Status.Valid);
      await time.increase(120);
      expect((await check(s, sig2, leg)).status).to.equal(Status.SensorNotRegistered);
    });

    it("a signature made for another deployment or chain fails here", async function () {
      const s = summaryFor();
      const Verifier = await ethers.getContractFactory("SensorSignatureVerifier");
      const other = await Verifier.deploy(await registry.getAddress());
      const forOther = await layout.sign(sensor, s, { ...domain, verifier: await other.getAddress() });
      const [otherStatus] = await other.verify(summaryTuple(s), forOther, legTuple(legFor()));
      expect(otherStatus).to.equal(Status.Valid);
      expect((await check(s, forOther)).status).to.equal(Status.WrongSensor);

      const forOtherChain = await layout.sign(sensor, s, { ...domain, chainId: 1n });
      expect((await check(s, forOtherChain)).status).to.equal(Status.WrongSensor);
    });

    it("rejects the high-s (malleated) form of a valid signature", async function () {
      const s = summaryFor();
      const sig = ethers.Signature.from(await layout.sign(sensor, s, domain));
      const highS = ethers.toBeHex(SECP256K1_N - BigInt(sig.s), 32);
      const flippedV = sig.v === 27 ? 28 : 27;
      const malleated = ethers.concat([sig.r, highS, ethers.toBeHex(flippedV, 1)]);
      // The raw ecrecover precompile (0x01) accepts this and returns the
      // sensor, so the low-s check in SensorSummary.recover is what stops it.
      const raw = await ethers.provider.call({
        to: "0x0000000000000000000000000000000000000001",
        data: ethers.concat([layout.digest(s, domain), ethers.toBeHex(flippedV, 32), sig.r, highS]),
      });
      expect(ethers.getAddress(ethers.dataSlice(raw, 12))).to.equal(sensor.address);
      expect(await verifier.recoverSigner(summaryTuple(s), malleated)).to.equal(ethers.ZeroAddress);
      expect((await check(s, malleated)).status).to.equal(Status.BadSignature);
    });

    it("malformed signatures are refused, even with a zero-address sensor", async function () {
      const s = summaryFor();
      const sig = await layout.sign(sensor, s, domain);
      const bad = [
        "0x",
        ethers.dataSlice(sig, 0, 64), // missing v
        ethers.concat([sig, "0x00"]), // 66 bytes
        ethers.concat([ethers.dataSlice(sig, 0, 64), "0x1d"]), // v = 29
        ethers.zeroPadValue("0x", 65),
      ];
      for (const b of bad) {
        const leg = legFor({ sensor: ethers.ZeroAddress });
        expect((await check(s, b, leg)).status).to.equal(Status.BadSignature);
      }
    });
  });

  describe("leg binding (what the temperature contract depends on)", function () {
    it("a summary for another batch or lot fails", async function () {
      const s = summaryFor(legFor({ batchId: ethers.encodeBytes32String("BB-2026-014-L1") }));
      const sig = await layout.sign(sensor, s, domain);
      expect((await check(s, sig)).status).to.equal(Status.WrongBatch);
    });

    it("a cold summary from leg 1 cannot be filed for leg 3 of the same batch", async function () {
      // Same batch, same custodian (the batch came back), same sensor, so the
      // leg number is the only thing that tells the two stays apart.
      const s = summaryFor(legFor({ leg: 1n }));
      const sig = await layout.sign(sensor, s, domain);
      expect((await check(s, sig, legFor({ leg: 1n }))).status).to.equal(Status.Valid);
      expect((await check(s, sig, legFor({ leg: 3n }))).status).to.equal(Status.WrongLeg);
    });

    it("a summary naming another custodian fails", async function () {
      const s = summaryFor(legFor({ custodian: nextCustodian.address }));
      const sig = await layout.sign(sensor, s, domain);
      expect((await check(s, sig)).status).to.equal(Status.WrongCustodian);
    });

    it("a summary signed against a lenient range fails", async function () {
      const s = summaryFor(legFor({ rangeHighCentiC: 1000n }), readings([210, 180, 520, 610]));
      expect(s.secondsOutOfRange).to.equal(0n);
      const sig = await layout.sign(sensor, s, domain);
      expect((await check(s, sig)).status).to.equal(Status.WrongRange);
    });

    it("a window that ends after the current block fails", async function () {
      const now = BigInt(await time.latest());
      const log = readings(COLD.slice(0, 4), { start: now });
      const s = summaryFor(legFor(), log, { startTime: now, endTime: now + 6n * HOUR });
      const sig = await layout.sign(sensor, s, domain);
      expect((await check(s, sig)).status).to.equal(Status.EndsInFuture);
      await time.increaseTo(now + 6n * HOUR);
      expect((await check(s, sig)).status).to.equal(Status.Valid);
    });

    it("a validly signed but impossible summary fails", async function () {
      const base = summaryFor();
      const impossible = [
        { ...base, minCentiC: 500n, maxCentiC: 100n },
        { ...base, secondsOutOfRange: 6n * HOUR + 1n },
        { ...base, readingCount: 0n },
        { ...base, readingCount: base.lastSeq - base.firstSeq + 2n }, // more than the counter allows
        { ...base, firstSeq: base.lastSeq + 1n },
        { ...base, logRoot: ethers.ZeroHash },
      ];
      for (const s of impossible) {
        const sig = await layout.sign(sensor, s, domain);
        expect((await check(s, sig)).status).to.equal(Status.Inconsistent);
      }
    });
  });
});
