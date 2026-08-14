const { getConnectionString } = require("@netlify/database");
const { Client } = require("pg");

async function getClient() {
  const client = new Client({ connectionString: getConnectionString() });
  await client.connect();
  return client;
}

async function ensureTable(client) {
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
}

exports.handler = async function (event, context) {
  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: "Not logged in" }) };
  }
  const userId = user.sub;

  let client;
  try {
    client = await getClient();
    await ensureTable(client);

    const params = event.queryStringParameters || {};
    const shared = params.shared === "true";

    if (event.httpMethod === "GET" && params.list === "true") {
      const prefix = params.prefix || "";
      const res = await client.query(
        "SELECT key FROM user_storage WHERE user_id=$1 AND shared=$2 AND key LIKE $3",
        [userId, shared, prefix + "%"]
      );
      return { statusCode: 200, body: JSON.stringify({ keys: res.rows.map((r) => r.key), prefix, shared }) };
    }

    if (event.httpMethod === "GET") {
      const key = params.key;
      const res = await client.query(
        "SELECT value FROM user_storage WHERE user_id=$1 AND key=$2 AND shared=$3",
        [userId, key, shared]
      );
      if (res.rows.length === 0) {
        return { statusCode: 404, body: JSON.stringify({ error: "not found" }) };
      }
      return { statusCode: 200, body: JSON.stringify({ key, value: res.rows[0].value, shared }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body);
      await client.query(
        `INSERT INTO user_storage (user_id, key, value, shared, updated_at)
         VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (user_id, key, shared) DO UPDATE SET value=$3, updated_at=now()`,
        [userId, body.key, body.value, !!body.shared]
      );
      return { statusCode: 200, body: JSON.stringify({ key: body.key, value: body.value, shared: !!body.shared }) };
    }

    if (event.httpMethod === "DELETE") {
      const key = params.key;
      await client.query("DELETE FROM user_storage WHERE user_id=$1 AND key=$2 AND shared=$3", [userId, key, shared]);
      return { statusCode: 200, body: JSON.stringify({ key, deleted: true, shared }) };
    }

    return { statusCode: 405, body: "Method not allowed" };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Storage error: " + err.message }) };
  } finally {
    if (client) await client.end();
  }
};
