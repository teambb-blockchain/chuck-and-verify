"use strict";

// server/sqlite.js: the queue that keeps one request's writes out of another
// request's transaction, and what happens when a ROLLBACK fails.

const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { openSqlite } = require("../server/sqlite");

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

describe("sqlite wrapper", function () {
  let dir;
  let conn;

  beforeEach(async function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-wrapper-"));
    conn = await openSqlite(path.join(dir, "t.db"));
    await conn.exec("CREATE TABLE t (v TEXT NOT NULL)");
  });

  afterEach(async function () {
    await conn.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const values = async () => (await conn.all("SELECT v FROM t ORDER BY v")).map((r) => r.v);

  it("rolls back a failed transaction and keeps one running beside it", async function () {
    const failing = conn.transaction(async (tx) => {
      await tx.run("INSERT INTO t (v) VALUES ('a1')");
      await pause(20);
      throw new Error("halfway");
    });
    const passing = conn.transaction(async (tx) => {
      await tx.run("INSERT INTO t (v) VALUES ('b1')");
      await tx.run("INSERT INTO t (v) VALUES ('b2')");
    });
    const results = await Promise.allSettled([failing, passing]);
    expect(results[0].status).to.equal("rejected");
    expect(results[1].status).to.equal("fulfilled");
    expect(await values()).to.deep.equal(["b1", "b2"]);
  });

  it("does not let a plain write join an open transaction", async function () {
    const failing = conn.transaction(async (tx) => {
      await tx.run("INSERT INTO t (v) VALUES ('in-tx')");
      await pause(20);
      throw new Error("halfway");
    });
    // Issued while the transaction is waiting; must run after it, not in it.
    const outside = conn.run("INSERT INTO t (v) VALUES ('outside')");
    await Promise.allSettled([failing, outside]);
    expect(await values()).to.deep.equal(["outside"]);
  });

  it("refuses every later call once a ROLLBACK fails", async function () {
    await conn.close();
    let brokenError = null;
    conn = await openSqlite(path.join(dir, "t.db"), { onBroken: (e) => (brokenError = e) });

    // COMMIT inside fn, then throw: the wrapper's ROLLBACK finds no transaction.
    const failed = await conn
      .transaction(async (tx) => {
        await tx.run("INSERT INTO t (v) VALUES ('x')");
        await tx.exec("COMMIT");
        throw new Error("original");
      })
      .catch((e) => e);

    expect(failed.message).to.equal("original");
    expect(brokenError).to.be.an("error");
    expect(brokenError.cause.message).to.match(/no transaction is active/);
    const later = await conn.get("SELECT 1").catch((e) => e);
    expect(later).to.equal(brokenError);
  });
});
