const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);
sql`TRUNCATE rooms CASCADE`
  .then(() => console.log("Database reset."))
  .catch((err) => { console.error(err); process.exit(1); });
