"use strict";

// Add or update businesses in portal.db from a directory file, such as the
// one scripts/seed-demo.js writes. Unlike seed:portal, this runs any number
// of times: each listed wallet gets its roles, organization type and public
// profile, and wallets not in the file are left alone.
//
//   npm run seed:directory                         # scripts/demo/directory.json
//   npm run seed:directory -- path/to/file.json
//
// Uses the same data folder as the server (DATA_DIR, /srv/data, or ./data).
// On the live site, an admin can import the same file from the Portal users
// card instead.

const path = require("path");
const { openDatabase, upsertUser } = require("../server/db");

async function main() {
  const file = path.resolve(process.argv[2] || path.join(__dirname, "demo", "directory.json"));
  const { users } = require(file);
  if (!Array.isArray(users) || !users.length) throw new Error("No users in " + file);
  const { db, dbPath } = await openDatabase();
  try {
    for (const user of users) {
      await upsertUser(db, {
        address: user.address,
        label: user.label,
        roles: user.roles || [],
        organization: user.organization,
        profile: user.profile,
        grantedBy: "directory-import",
        replaceRoles: false,
      });
    }
    await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    console.log(`Imported ${users.length} business(es) into ${dbPath}`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
