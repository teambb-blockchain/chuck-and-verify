"use strict";

// Build the SQLite portal.db once. Boot never reads the seed file.
// A second run leaves existing roles alone.

const path = require("path");
const { openDatabase, seedOnce } = require("../server/db");

const { db, dbPath, dataDir } = openDatabase();
const seedPath = process.argv[2] || path.join(dataDir, "seed.json");

try {
  const result = seedOnce(db, seedPath);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  if (result.applied) {
    console.log(`Seeded ${result.count} user(s) into ${dbPath}`);
    console.log(
      "This file is SQLite. On DIDLab, paste the seed JSON into /srv/data/portal.db instead; the first boot converts it. Do not upload seed.json."
    );
  } else {
    console.log(`Already seeded. Roles in ${dbPath} were left unchanged.`);
  }
} finally {
  db.close();
}
