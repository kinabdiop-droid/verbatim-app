const { Client } = require("pg");

exports.handler = async function (event, context) {
  const user = context.clientContext && context.clientContext.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Not logged in" }) };

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_storage (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        shared BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (user_id, key, shared)
      );
    `);
    const res = await client.query(
      "SELECT value FROM user_storage WHERE user_id=$1 AND key='subscription' AND shared=false",
      [user.sub]
    );
    if (res.rows.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ subscribed: false }) };
    }
    const record = JSON.parse(res.rows[0].value);
    return { statusCode: 200, body: JSON.stringify({ subscribed: record.status === "active", plan: record.plan }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally {
    await client.end();
  }
};
