const PAYPAL_CLIENT_ID = "BAAM2cIUN1zwRZnNDU__Mj9r9Y8pd92xbjHut0J4lTt9BmOI1IQmx3kqpN-XXJ-bjQd4J8DZXsuz3GN4xI";

const PLAN_IDS = {
  monthly: "P-7H78015375966184ANKLGGYY",
  yearly: "P-9RW93862BR088871MNKLGERQ",
};

async function getAccessToken() {
  const secret = process.env.PAYPAL_SECRET;
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${secret}`).toString("base64");
  const res = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || "Could not authenticate with PayPal");
  return data.access_token;
}

const { Client } = require("pg");

exports.handler = async function (event, context) {
  const user = context.clientContext && context.clientContext.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Not logged in" }) };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request" }) };
  }
  const { subscriptionId } = body;
  if (!subscriptionId) return { statusCode: 400, body: JSON.stringify({ error: "Missing subscriptionId" }) };

  try {
    const token = await getAccessToken();
    const subRes = await fetch(`https://api-m.paypal.com/v1/billing/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sub = await subRes.json();

    if (!subRes.ok) {
      return { statusCode: 400, body: JSON.stringify({ error: "Could not verify subscription with PayPal" }) };
    }

    const knownPlan = Object.entries(PLAN_IDS).find(([, id]) => id === sub.plan_id);
    if (!knownPlan) {
      return { statusCode: 400, body: JSON.stringify({ error: "Subscription does not match a known Verbatim plan" }) };
    }

    if (sub.status !== "ACTIVE" && sub.status !== "APPROVAL_PENDING") {
      return { statusCode: 400, body: JSON.stringify({ error: `Subscription status is ${sub.status}, not active` }) };
    }

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
      const record = JSON.stringify({
        status: "active",
        subscriptionId: sub.id,
        plan: knownPlan[0],
        activatedAt: new Date().toISOString(),
      });
      await client.query(
        `INSERT INTO user_storage (user_id, key, value, shared, updated_at)
         VALUES ($1, 'subscription', $2, false, now())
         ON CONFLICT (user_id, key, shared) DO UPDATE SET value=$2, updated_at=now()`,
        [user.sub, record]
      );
    } finally {
      await client.end();
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, plan: knownPlan[0] }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
