const { neon } = require("@neondatabase/serverless");
const Ably = require("ably");
require("dotenv").config({ path: ".env.local" });

async function main() {
  const sql = neon(process.env.DATABASE_URL);

  // Capture room codes before truncating so we know which channels to notify.
  const rooms = await sql`SELECT code FROM rooms`;

  await sql`TRUNCATE rooms CASCADE`;
  console.log("Database reset.");

  // Publish a room-reset event on all active room channels so connected clients
  // can detect the reset and navigate away cleanly.
  if (rooms.length > 0 && process.env.ABLY_API_KEY) {
    const ably = new Ably.Rest({ key: process.env.ABLY_API_KEY });
    const suffixes = ["players", "status", "round:timer", "round:pass", "reveal:advance"];
    await Promise.all(
      rooms.flatMap(({ code }) =>
        suffixes.map((s) =>
          ably.channels.get(`room:${code}:${s}`).publish("room-reset", null)
        )
      )
    );
    console.log(`Notified ${rooms.length} room channel(s).`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
