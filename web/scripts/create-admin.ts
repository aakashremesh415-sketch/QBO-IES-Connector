/**
 * Create the first admin (or reset an existing user to admin with a new temporary password).
 *   npm run create-admin -- you@example.com "Your Name"
 */
import "dotenv/config";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  if (!email || !email.includes("@")) throw new Error('Usage: npm run create-admin -- you@example.com "Your Name"');
  const name = nameParts.join(" ") || email.split("@")[0];
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({ connectionString: url, ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined });
  const password = randomBytes(12).toString("base64url");
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `insert into users (email, name, password_hash, role, active, must_change_password)
     values ($1, $2, $3, 'ADMIN', true, true)
     on conflict (email) do update set password_hash = excluded.password_hash, role = 'ADMIN', active = true,
       must_change_password = true, failed_logins = 0, locked_until = null`,
    [email.toLowerCase().trim(), name, hash],
  );
  await pool.end();
  console.log(`Admin ready: ${email}\nTemporary password: ${password}\nYou'll be asked to choose a new one at first sign-in.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
