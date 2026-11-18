// TemperatureLog (ADR 0005): one sensor-signed summary per (batch, custody
// leg), checked by SensorSignatureVerifier, with every leg fact taken from
// chain state. Summaries are built and signed with the shared layout in
// scripts/lib/sensor-summary.js, as a device would.

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const layout = require("../scripts/lib/sensor-summary");

const ONE_YEAR = 365 * 24 * 60 * 60;
const RANGE = { low: -220, high: 444 }; // 0.01 °C
// Mirrors SensorSignatureVerifier.Status.
const Status = { WrongSensor: 2, SensorNotRegistered: 3, WrongCustodian: 6, WrongRange: 7, EndsInFuture: 8, Inconsistent: 9 };

describe("TemperatureLog", function () {
  let registry, supplyChain, verifier, log, domain;
  let processor, custodianA, custodianB, sensorP, sensorA, rogueSensor, stranger;
  const BATCH = ethers.encodeBytes32String("BEEF-T-01");
  const COLD = [210, 180, 190, 230, 250, 240];
  const WARM = [210, 180, 520, 610, 300, 220];

  // Readings every 30 minutes ending an hour before now.
  async function readings(temps, seq0 = 1n) {
    const end = BigInt(await time.latest()) - 3600n;
    const start = end - BigInt(temps.length) * 1800n;
    return {
      start,
      end,
      list: temps.map((c, i) => ({ seq: seq0 + BigInt(i), timestamp: start + BigInt(i) * 1800n + 60n, tempCentiC: BigInt(c) })),
    };
  }

  async function signed({ leg = 0, custodian = processor, sensor = sensorP, temps = COLD, range = RANGE, batchId = BATCH, end } = {}) {
    const r = await readings(temps);
    const summary = layout.summarize(
      {
        batchId,
        leg,
        custodian: custodian.address,
        startTime: r.start,
        endTime: end ?? r.end,
        rangeLowCentiC: range.low,
        rangeHighCentiC: range.high,
      },
      r.list
    );
    return { summary, sig: await layout.sign(sensor, summary, domain) };
  }
  const tuple = (s) => layout.TYPES.TemperatureSummary.map((f) => s[f.name]);
  const record = (s, sig) => log.recordSummary(tuple(s), sig);

  beforeEach(async function () {
    [, processor, custodianA, custodianB, sensorP, sensorA, rogueSensor, stranger] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory("CredentialRegistry")).deploy();
    const [admin] = await ethers.getSigners();
    const expires = (await time.latest()) + ONE_YEAR;
    const SENSOR = ethers.id("SENSOR");
    for (const type of [await registry.CRED_PROCESSOR(), await registry.CRED_CUSTODIAN(), SENSOR]) {
      await registry.setIssuer(type, admin.address);
    }
    await registry.grant(processor.address, await registry.CRED_PROCESSOR(), expires);
    for (const who of [processor, custodianA, custodianB]) await registry.grant(who.address, await registry.CRED_CUSTODIAN(), expires);
    for (const s of [sensorP, sensorA]) await registry.grant(s.address, SENSOR, expires);

    supplyChain = await (await ethers.getContractFactory("BeefSupplyChain")).deploy(await registry.getAddress());
    verifier = await (await ethers.getContractFactory("SensorSignatureVerifier")).deploy(await registry.getAddress());
    log = await (await ethers.getContractFactory("TemperatureLog")).deploy(
      await verifier.getAddress(), await supplyChain.getAddress(), RANGE.low, RANGE.high
    );
    domain = { chainId: (await ethers.provider.getNetwork()).chainId, verifier: await verifier.getAddress() };

    await supplyChain.connect(processor).registerBatch(BATCH, 1000);
    await log.connect(processor).registerSensor(sensorP.address);
    await log.connect(custodianA).registerSensor(sensorA.address);
  });

  it("records a valid summary for the batch's current leg and emits it", async function () {
    const { summary, sig } = await signed();
    await expect(log.connect(stranger).recordSummary(tuple(summary), sig))
      .to.emit(log, "SummaryRecorded")
      .withArgs(BATCH, 0, processor.address, (r) => r.sensor === sensorP.address && r.maxCentiC === 250n);
    const stored = await log.getSummary(BATCH, 0);
    expect(stored.custodian).to.equal(processor.address);
    expect(stored.sensor).to.equal(sensorP.address);
    expect(stored.minCentiC).to.equal(180n);
    expect(stored.secondsOutOfRange).to.equal(0n);
    expect(stored.readingCount).to.equal(6n);
    expect(stored.logRoot).to.equal(summary.logRoot);
    expect(stored.recordedAt).to.be.greaterThan(0n);
  });

  it("records time out of range as the sensor reported it", async function () {
    const { summary, sig } = await signed({ temps: WARM });
    await record(summary, sig);
    const stored = await log.getSummary(BATCH, 0);
    expect(stored.maxCentiC).to.equal(610n);
    expect(stored.secondsOutOfRange).to.equal(summary.secondsOutOfRange);
    expect(stored.secondsOutOfRange).to.be.greaterThan(0n);
  });

  it("follows the batch: after a confirmed handoff only the new holder's leg can be recorded", async function () {
    const early = await signed();
    await supplyChain.connect(processor).recordShipment(BATCH, custodianA.address);
    // While the shipment is pending the sender is still on leg 0.
    const pendingLeg = await signed();
    await supplyChain.connect(custodianA).confirmReceipt(BATCH);
    await expect(record(early.summary, early.sig)).to.be.revertedWithCustomError(log, "NotCurrentLeg");
    await expect(record(pendingLeg.summary, pendingLeg.sig)).to.be.revertedWithCustomError(log, "NotCurrentLeg");
    const next = await signed({ leg: 1, custodian: custodianA, sensor: sensorA });
    await record(next.summary, next.sig);
    expect((await log.getSummary(BATCH, 1)).custodian).to.equal(custodianA.address);
  });

  it("lets the sender record its leg while its shipment is still pending", async function () {
    await supplyChain.connect(processor).recordShipment(BATCH, custodianA.address);
    const { summary, sig } = await signed();
    await record(summary, sig);
    expect((await log.getSummary(BATCH, 0)).custodian).to.equal(processor.address);
  });

  it("keeps one summary per leg", async function () {
    const first = await signed();
    await record(first.summary, first.sig);
    const second = await signed({ temps: WARM });
    await expect(record(second.summary, second.sig)).to.be.revertedWithCustomError(log, "AlreadyRecorded");
  });

  it("needs the holder to have registered a sensor", async function () {
    await supplyChain.connect(processor).recordShipment(BATCH, custodianB.address);
    await supplyChain.connect(custodianB).confirmReceipt(BATCH);
    const { summary, sig } = await signed({ leg: 1, custodian: custodianB, sensor: sensorA });
    await expect(record(summary, sig)).to.be.revertedWithCustomError(log, "NoSensor");
  });

  it("refuses a summary signed by any key but the holder's registered sensor", async function () {
    const other = await signed({ sensor: sensorA }); // a real sensor, but custodianA's
    await expect(record(other.summary, other.sig)).to.be.revertedWithCustomError(log, "SummaryRejected").withArgs(Status.WrongSensor);
    const rogue = await signed({ sensor: rogueSensor });
    await expect(record(rogue.summary, rogue.sig)).to.be.revertedWithCustomError(log, "SummaryRejected").withArgs(Status.WrongSensor);
  });

  it("refuses a registered sensor that has no valid SENSOR credential", async function () {
    await log.connect(processor).registerSensor(rogueSensor.address);
    const { summary, sig } = await signed({ sensor: rogueSensor });
    await expect(record(summary, sig)).to.be.revertedWithCustomError(log, "SummaryRejected").withArgs(Status.SensorNotRegistered);
  });

  it("refuses a summary naming another custodian, another range, or a window ending in the future", async function () {
    const who = await signed({ custodian: custodianA });
    await expect(record(who.summary, who.sig)).to.be.revertedWithCustomError(log, "SummaryRejected").withArgs(Status.WrongCustodian);
    const loose = await signed({ range: { low: -1000, high: 1000 } });
    await expect(record(loose.summary, loose.sig)).to.be.revertedWithCustomError(log, "SummaryRejected").withArgs(Status.WrongRange);
    const future = await signed({ end: BigInt(await time.latest()) + 86400n });
    await expect(record(future.summary, future.sig)).to.be.revertedWithCustomError(log, "SummaryRejected").withArgs(Status.EndsInFuture);
  });

  it("refuses a tampered summary", async function () {
    const { summary, sig } = await signed({ temps: WARM });
    const hidden = { ...summary, maxCentiC: 300n, secondsOutOfRange: 0n };
    await expect(record(hidden, sig)).to.be.revertedWithCustomError(log, "SummaryRejected").withArgs(Status.WrongSensor);
  });

  it("refuses a summary for a batch that doesn't exist", async function () {
    const { summary, sig } = await signed({ batchId: ethers.encodeBytes32String("NOPE") });
    await expect(record(summary, sig)).to.be.revertedWithCustomError(supplyChain, "BatchNotFound");
  });

  it("lets only credentialed custodians register a sensor, and keeps each record's own sensor", async function () {
    await expect(log.connect(stranger).registerSensor(sensorA.address)).to.be.revertedWithCustomError(log, "Unauthorized");
    await expect(log.connect(processor).registerSensor(ethers.ZeroAddress)).to.be.revertedWithCustomError(log, "ZeroAddress");
    const { summary, sig } = await signed();
    await record(summary, sig);
    await expect(log.connect(processor).registerSensor(sensorA.address))
      .to.emit(log, "SensorRegistered").withArgs(processor.address, sensorA.address);
    expect((await log.getSummary(BATCH, 0)).sensor).to.equal(sensorP.address);
    expect(await log.sensorOf(processor.address)).to.equal(sensorA.address);
  });

  it("works on lots: a lot's leg 0 is the splitting custodian's", async function () {
    await supplyChain.connect(processor).splitBatch(BATCH, [600, 400]);
    const lot = ethers.encodeBytes32String("BEEF-T-01-L1");
    const { summary, sig } = await signed({ batchId: lot });
    await record(summary, sig);
    expect((await log.getSummary(lot, 0)).custodian).to.equal(processor.address);
  });

  it("rejects a reversed range at deployment", async function () {
    const Factory = await ethers.getContractFactory("TemperatureLog");
    await expect(Factory.deploy(await verifier.getAddress(), await supplyChain.getAddress(), 444, -220))
      .to.be.revertedWithCustomError(Factory, "BadRange");
  });
});
