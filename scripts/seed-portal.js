"use strict";

// Build portal.db once, before it is uploaded to DIDLab. Boot never reads
// the seed file. A second run leaves existing roles alone.

const path = require("path");
const { openDatabase, seedOnce } = require("../server/db");

const { db, dbPath, dataDir } = openDatabase();
const seedPath = process.argv[2] || path.join(dataDir, "seed.json");

try {
  const result = seedOnce(db, seedPath);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  if (result.applied) {
    console.log(`Seeded ${result.count} user(s) into ${dbPath}`);
    console.log("Upload this file to /srv/data/portal.db. Do not upload seed.json.");
  } else {
    console.log(`Already seeded. Roles in ${dbPath} were left unchanged.`);
  }
} finally {
  db.close();
}
