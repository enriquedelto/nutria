// Fake external services for E2E (compose.e2e.yml → service "fakes", port 8080):
//  - Webhook receiver: POST /hook accepts only signed requests; GET /hook/last shows the last one.
//  - Minimal openGym: pairing code 123456 → token; /api/me and /api/data with one workout and one weigh-in today.
//  - Open Prices: GET /api/v1/prices?product_code=8437000000017.
import { createServer } from "node:http";

const TOKEN = "og-e2e-token";
let lastHook = null;

const today = () => new Date().toISOString().slice(0, 10);
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => resolve(b));
});

createServer(async (req, res) => {
  const url = new URL(req.url, "http://fakes");
  const body = await readBody(req);
  if (req.method === "POST" && url.pathname === "/hook") {
    const sig = req.headers["x-nutria-signature"];
    if (typeof sig !== "string" || !/^sha256=[0-9a-f]{64}$/.test(sig)) return send(res, 400, { error: "sin firma" });
    lastHook = { event: req.headers["x-nutria-event"], body: JSON.parse(body || "{}") };
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/hook/last") return send(res, 200, lastHook);
  if (req.method === "POST" && url.pathname === "/api/pair/redeem") {
    const { code } = JSON.parse(body || "{}");
    return code === "123456" ? send(res, 200, { token: TOKEN }) : send(res, 404, { error: "código no válido" });
  }
  const authed = req.headers.authorization === `Bearer ${TOKEN}`;
  if (url.pathname === "/api/me") return authed ? send(res, 200, { user: { name: "Ana (openGym)" } }) : send(res, 401, {});
  if (url.pathname === "/api/data") {
    if (!authed) return send(res, 401, {});
    const start = Date.now() - 3 * 3600_000;
    return send(res, 200, {
      rev: 1,
      state: {
        unit: "kg",
        workouts: [{ id: "w-e2e-1", d: today(), start, end: start + 50 * 60_000, name: "Pierna (openGym e2e)", vol: 6200, entries: [{ id: "sq", sets: [{ w: 60, r: 8 }, { w: 60, r: 8 }, { w: 60, r: 8 }] }] }],
        bodyweight: [{ d: today(), w: 61.8, t: start }],
      },
    });
  }
  // Open Prices: one receipt for the e2e barcode (2,40 € the 500 g pack → 4,80 €/kg).
  if (url.pathname === "/api/v1/prices") {
    const items = url.searchParams.get("product_code") === "8437000000017" ? [{ price: 2.4, currency: "EUR", date: today(), price_per: null, product: { product_quantity: 500, product_quantity_unit: "g" } }] : [];
    return send(res, 200, { items, total: items.length });
  }
  send(res, 404, { error: "no encontrado" });
}).listen(8080, () => console.log("fakes listo en :8080"));
