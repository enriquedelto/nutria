// Fake external services for E2E (compose.e2e.yml → service "fakes", port 8080):
//  - Webhook receiver: POST /hook accepts only signed requests; GET /hook/last shows the last one.
//  - Minimal openGym: pairing code K7WQ2MZP → token; /api/me (renews the token), /api/data/rev and /api/data
//    with one workout and one weigh-in today; POST /fake/og/delete removes the workout (bumps the revision).
//  - Open Prices: GET /api/v1/prices?product_code=8437000000017; writes: POST /api/v1/auth (e2e / e2e-pass),
//    /api/v1/proofs/upload and /api/v1/prices with the bearer token; GET /fake/op/last shows what arrived.
//  - Nominatim: GET /search?q=… finds one Mercadona for any query that mentions it.
import { createServer } from "node:http";

const TOKEN = "og-e2e-token";
const RENEWED = "og-e2e-token-2";
let lastHook = null;
const OP_TOKEN = "op-e2e-token";
const op = { proofs: [], prices: [] };

// openGym state: a workout with a catalogue exercise and a custom one, and a weigh-in, both today.
let ogRev = 1;
let ogWorkoutDeleted = false;
const ogState = () => {
  const start = Date.now() - 3 * 3600_000;
  return {
    unit: "kg",
    customEx: [{ id: "c-e2e", name: "Zancada en mi banco" }],
    workouts: ogWorkoutDeleted
      ? []
      : [
          {
            id: "w-e2e-1",
            d: today(),
            start,
            end: start + 50 * 60_000,
            name: "Pierna (openGym e2e)",
            vol: 6200,
            entries: [
              { id: "1436", sets: [{ w: 60, r: 8 }, { w: 60, r: 8 }, { w: 60, r: 8 }] },
              { id: "c-e2e", sets: [{ w: 10, r: 12 }, { w: 12, r: 10 }] },
            ],
            prs: ["1436"],
          },
        ],
    bodyweight: [{ d: today(), w: 61.8, t: start }],
  };
};

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
    return code === "K7WQ2MZP" ? send(res, 200, { token: TOKEN }) : send(res, 404, { error: "código no válido" });
  }
  if (req.method === "POST" && url.pathname === "/fake/og/delete") {
    ogWorkoutDeleted = true;
    ogRev++;
    return send(res, 200, { ok: true, rev: ogRev });
  }
  if (req.method === "POST" && url.pathname === "/fake/og/reset") {
    ogWorkoutDeleted = false;
    ogRev++;
    return send(res, 200, { ok: true, rev: ogRev });
  }
  // Like openGym, the old token keeps working after /api/me hands out a renewed one.
  const auth = req.headers.authorization;
  const authed = auth === `Bearer ${TOKEN}` || auth === `Bearer ${RENEWED}`;
  if (url.pathname === "/api/me") return authed ? send(res, 200, { user: { name: "Ana (openGym)" }, ...(auth === `Bearer ${TOKEN}` ? { token: RENEWED } : {}) }) : send(res, 401, {});
  if (url.pathname === "/api/data/rev") return authed ? send(res, 200, { rev: ogRev, wid: "e2e" }) : send(res, 401, {});
  if (url.pathname === "/api/data") return authed ? send(res, 200, { rev: ogRev, state: ogState() }) : send(res, 401, {});
  if (req.method === "POST" && url.pathname === "/api/v1/auth") {
    const f = new URLSearchParams(body);
    return f.get("username") === "e2e" && f.get("password") === "e2e-pass" ? send(res, 200, { access_token: OP_TOKEN, token_type: "bearer" }) : send(res, 401, { detail: "Invalid authentication credentials" });
  }
  const opAuthed = req.headers.authorization === `Bearer ${OP_TOKEN}`;
  if (req.method === "POST" && url.pathname === "/api/v1/proofs/upload") {
    if (!opAuthed) return send(res, 401, { detail: "Authentication required" });
    const field = (name) => new RegExp(`name="${name}"\r\n\r\n([^\r]*)`).exec(body)?.[1] ?? null;
    const proof = { id: 500 + op.proofs.length + 1, type: field("type"), osm: `${field("location_osm_type")}:${field("location_osm_id")}`, date: field("date"), bytes: body.length };
    op.proofs.push(proof);
    return send(res, 201, { id: proof.id });
  }
  if (req.method === "POST" && url.pathname === "/api/v1/prices") {
    if (!opAuthed) return send(res, 401, { detail: "Authentication required" });
    const price = JSON.parse(body || "{}");
    op.prices.push(price);
    return send(res, 201, { id: 9000 + op.prices.length });
  }
  if (url.pathname === "/fake/op/last") return send(res, 200, op);
  if (url.pathname === "/search") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    return send(res, 200, q.includes("mercadona") ? [{ osm_id: 4242424242, osm_type: "node", name: "Mercadona", display_name: "Mercadona, Calle Mayor, 1, Centro, Madrid, 28013, España", lat: "40.4168", lon: "-3.7038" }] : []);
  }
  // Open Prices: one receipt for the e2e barcode (2,40 € the 500 g pack → 4,80 €/kg).
  if (req.method === "GET" && url.pathname === "/api/v1/prices") {
    const items = url.searchParams.get("product_code") === "8437000000017" ? [{ price: 2.4, currency: "EUR", date: today(), price_per: null, product: { product_quantity: 500, product_quantity_unit: "g" } }] : [];
    return send(res, 200, { items, total: items.length });
  }
  send(res, 404, { error: "no encontrado" });
}).listen(8080, () => console.log("fakes listo en :8080"));
