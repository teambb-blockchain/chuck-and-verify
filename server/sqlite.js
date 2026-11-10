"use strict";

// Promise wrapper over the npm `sqlite3` package. The DIDLab container runs
// Node 20, which has no built-in node:sqlite, so this is the driver there.
//
// One connection, one queue: every statement waits its turn, and
// transaction(fn) holds the queue until fn finishes. Without that, another
// request's write could land between this request's BEGIN and COMMIT and be
// committed or rolled back with it.
//
//   await conn.get(sql, ...params)     first row or undefined
//   await conn.all(sql, ...params)     all rows
//   await conn.run(sql, ...params)     { changes, lastID }
//   await conn.exec(sql)               several statements, no params
//   await conn.transaction(async (tx) => { await tx.run(...) })
//
// Inside transaction(fn), use `tx`, not `conn`: `conn` would wait behind the
// transaction that is waiting on it.

const sqlite3 = require("sqlite3");

function raw(db) {
  return {
    get: (sql, ...params) =>
      new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
      ),
    all: (sql, ...params) =>
      new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
      ),
    run: (sql, ...params) =>
      new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, lastID: this.lastID });
        })
      ),
    exec: (sql) =>
      new Promise((resolve, reject) => db.exec(sql, (err) => (err ? reject(err) : resolve()))),
  };
}

// onBroken(error) runs once if a ROLLBACK fails. The connection may then still
// be inside the failed transaction, so every later call is refused rather than
// writing into a transaction nothing will commit. The server passes a handler
// that exits, so its supervisor restarts it on a fresh connection.
function openSqlite(filePath, { onBroken } = {}) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, (err) => {
      if (err) return reject(err);
      const tx = raw(db);
      let tail = Promise.resolve();
      let broken = null;

      // Run fn after everything already queued; the next caller waits for fn.
      function queued(fn) {
        const result = tail.then(() => {
          if (broken) throw broken;
          return fn();
        });
        tail = result.catch(() => {});
        return result;
      }

      resolve({
        get: (...args) => queued(() => tx.get(...args)),
        all: (...args) => queued(() => tx.all(...args)),
        run: (...args) => queued(() => tx.run(...args)),
        exec: (sql) => queued(() => tx.exec(sql)),
        transaction: (fn) =>
          queued(async () => {
            await tx.exec("BEGIN");
            try {
              const value = await fn(tx);
              await tx.exec("COMMIT");
              return value;
            } catch (error) {
              try {
                await tx.exec("ROLLBACK");
              } catch (rollbackError) {
                broken = new Error("Database connection is unusable after a failed rollback.", {
                  cause: rollbackError,
                });
                if (onBroken) onBroken(broken);
              }
              throw error;
            }
          }),
        close: () =>
          queued(() => new Promise((res, rej) => db.close((e) => (e ? rej(e) : res())))),
      });
    });
  });
}

module.exports = { openSqlite };
