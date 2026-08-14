// Proxies book search so the Google Books key (if you set one) never reaches the browser.
// Works fine with NO key set too -- it just falls back to Google's anonymous rate limit.
exports.handler = async function (event) {
  const q = event.queryStringParameters && event.queryStringParameters.q;
  if (!q || q.trim().length < 3) {
    return { statusCode: 200, body: JSON.stringify({ items: [] }) };
  }

  const key = process.env.GOOGLE_BOOKS_API_KEY;
  const url = `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(q)}&maxResults=6${key ? "&key=" + encodeURIComponent(key) : ""}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: "Book search error", status: response.status }) };
    }

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Could not reach book search" }) };
  }
};
