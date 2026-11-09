import { and, eq, foods, inArray, pantryItems, prices, receiptAliases, receiptItems, receipts, searchFoods, shoppingItems, sql, stores, type Database } from "@nutria/db";
import { searchPlaces, type Place } from "@nutria/integrations";
import { chainKey, guessCategory, nameSimilarity, normReceiptText, receiptLinePrice } from "@nutria/nutrition";

export interface ReceiptLine {
  rawText: string;
  name: string;
  quantity: number;
  unit: "ud" | "kg" | "l";
  unitPrice: number | null;
  lineTotal: number;
  discount: number | null;
  isFood: boolean;
  foodId: string | null;
  matchConfidence: number | null;
}

export interface ReceiptHeader {
  chain: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
}

/** What the review screen needs besides the lines (stored in receipts.reading). */
export interface ReceiptReadingMeta {
  store: ReceiptHeader;
  candidates: Place[];
  time: string | null;
  cropBottom: number | null;
  confidence: number;
  aiTotal: number | null;
}

/**
 * Link each line to a food: learned alias for this household and chain first, then a fuzzy
 * search with the AI's clean name (foods on the shopping list the receipt comes from score higher).
 */
export async function matchReceiptLines(db: Database, groupId: string, chain: string, lines: Omit<ReceiptLine, "foodId" | "matchConfidence">[], opts: { listFoodIds?: string[] } = {}): Promise<ReceiptLine[]> {
  const norms = lines.map((l) => normReceiptText(l.rawText));
  const aliases = norms.length
    ? await db.select({ normText: receiptAliases.normText, foodId: receiptAliases.foodId }).from(receiptAliases).where(and(eq(receiptAliases.groupId, groupId), eq(receiptAliases.chain, chain), inArray(receiptAliases.normText, norms)))
    : [];
  const byAlias = new Map(aliases.map((a) => [a.normText, a.foodId]));
  const onList = new Set(opts.listFoodIds ?? []);
  return Promise.all(
    lines.map(async (l, i) => {
      const alias = byAlias.get(norms[i]!);
      if (alias) return { ...l, foodId: alias, matchConfidence: 1 };
      if (!l.isFood) return { ...l, foodId: null, matchConfidence: null };
      const found = await searchFoods(db, l.name, { groupId, limit: 8 });
      let best: { id: string; score: number } | null = null;
      for (const f of found) {
        const score = nameSimilarity(l.name, f.nameEs ?? f.name) + (onList.has(f.id) ? 0.3 : 0) + (f.groupId ? 0.1 : 0);
        if (!best || score > best.score) best = { id: f.id, score };
      }
      return best && best.score >= 0.5 ? { ...l, foodId: best.id, matchConfidence: Math.min(0.95, Math.round(best.score * 100) / 100) } : { ...l, foodId: null, matchConfidence: null };
    }),
  );
}

/** A branch of the chain already known (same street), so the user only confirms a new store once. */
export async function knownStore(db: Database, header: ReceiptHeader) {
  const chain = chainKey(header.chain ?? header.name);
  if (!chain || !header.address) return null;
  const rows = await db.select().from(stores).where(eq(stores.chain, chain));
  return rows.find((s) => s.address && nameSimilarity(s.address, header.address!) >= 0.75 && (!header.postalCode || !s.postalCode || s.postalCode === header.postalCode)) ?? null;
}

/** OpenStreetMap shops that could be the receipt's store (searched once, at reading time). */
export async function storeCandidates(header: ReceiptHeader, f: typeof fetch = fetch): Promise<Place[]> {
  const who = header.chain ?? header.name;
  if (!who) return [];
  const where = [header.address, header.postalCode, header.city].filter(Boolean).join(" ");
  const first = where ? await searchPlaces(`${who} ${where}`, f).catch(() => []) : [];
  if (first.length || !header.city) return first;
  return searchPlaces(`${who} ${header.city}`, f).catch(() => []);
}

export async function createReceiptDraft(
  db: Database,
  input: {
    groupId: string;
    userId: string;
    estimateId: string | null;
    files: { key: string; mime: string }[];
    shoppingListId?: string | null;
    date: string | null;
    total: number | null;
    lines: Omit<ReceiptLine, "foodId" | "matchConfidence">[];
    meta: Omit<ReceiptReadingMeta, "candidates">;
  },
  f: typeof fetch = fetch,
) {
  const chain = chainKey(input.meta.store.chain ?? input.meta.store.name);
  let listFoodIds: string[] = [];
  if (input.shoppingListId) {
    listFoodIds = (await db.select({ foodId: shoppingItems.foodId }).from(shoppingItems).where(eq(shoppingItems.listId, input.shoppingListId))).map((r) => r.foodId).filter((x): x is string => !!x);
  }
  const [lines, known] = await Promise.all([matchReceiptLines(db, input.groupId, chain, input.lines, { listFoodIds }), knownStore(db, input.meta.store)]);
  const candidates = known ? [] : await storeCandidates(input.meta.store, f);
  const reading: ReceiptReadingMeta = { ...input.meta, candidates };
  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(receipts)
      .values({ groupId: input.groupId, userId: input.userId, storeId: known?.id ?? null, purchasedOn: input.date, purchasedTime: input.meta.time, total: input.total != null ? input.total.toFixed(2) : null, files: input.files, aiEstimateId: input.estimateId, shoppingListId: input.shoppingListId ?? null, reading: reading as unknown as Record<string, unknown> })
      .returning({ id: receipts.id });
    if (lines.length) await tx.insert(receiptItems).values(lines.map((l, i) => itemRow(r!.id, i, l)));
    return r!.id;
  });
}

const locationFor = (category: string) => (category === "congelados" ? "congelador" : ["fruta_verdura", "carne", "pescado", "lacteos_huevos"].includes(category) ? "nevera" : "despensa");
const money = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : n.toFixed(2));
const itemRow = (receiptId: string, i: number, l: Omit<ReceiptLine, "isFood"> & { isFood?: boolean }, priceId?: string | null) => ({
  receiptId,
  line: i + 1,
  rawText: l.rawText.slice(0, 200),
  name: l.name.slice(0, 160),
  quantity: l.quantity,
  unit: l.unit,
  unitPrice: money(l.unitPrice),
  lineTotal: money(l.lineTotal) ?? "0.00",
  discount: money(l.discount),
  foodId: l.foodId,
  matchConfidence: l.matchConfidence,
  priceId: priceId ?? null,
});

export type StoreChoice = { kind: "existing"; storeId: string } | { kind: "osm"; place: Place } | { kind: "manual"; name: string } | { kind: "none" };

/** Store row for the choice; OSM shops and manual stores are created on first use. */
export async function ensureStore(db: Database, choice: StoreChoice, header: ReceiptHeader): Promise<string | null> {
  const chain = chainKey(header.chain ?? header.name) || null;
  if (choice.kind === "existing") return choice.storeId;
  if (choice.kind === "none") return null;
  if (choice.kind === "osm") {
    const p = choice.place;
    const [s] = await db
      .insert(stores)
      .values({ code: `osm:${p.osmType.toLowerCase()}:${p.osmId}`, name: p.name.slice(0, 120), chain, address: header.address, postalCode: header.postalCode, osmId: p.osmId, osmType: p.osmType, lat: p.lat, lon: p.lon })
      .onConflictDoUpdate({ target: stores.code, set: { chain: sql`coalesce(${stores.chain}, excluded.chain)`, address: sql`coalesce(${stores.address}, excluded.address)`, updatedAt: new Date() } })
      .returning({ id: stores.id });
    return s!.id;
  }
  const [s] = await db
    .insert(stores)
    .values({ code: `manual-${crypto.randomUUID()}`, name: choice.name.slice(0, 120), chain, address: header.address, postalCode: header.postalCode })
    .returning({ id: stores.id });
  return s!.id;
}

export interface ConfirmReceiptInput {
  receiptId: string;
  groupId: string;
  store: StoreChoice;
  date: string;
  total: number | null;
  lines: (Omit<ReceiptLine, "isFood" | "matchConfidence"> & { matchConfidence?: number | null })[];
  toPantry: boolean;
  /** Upload key of the cropped image the user approved for Open Prices (null = do not share). */
  shareKey: string | null;
}

/**
 * Save the reviewed receipt: lines, one price per linked line (source "receipt", private to the
 * household), learned aliases and, if asked, pantry stock. Re-confirming replaces its prices.
 */
export async function confirmReceipt(db: Database, input: ConfirmReceiptInput) {
  const [r] = await db.select().from(receipts).where(and(eq(receipts.id, input.receiptId), eq(receipts.groupId, input.groupId))).limit(1);
  if (!r) throw new Error("Ticket no encontrado");
  const header = ((r.reading as unknown as ReceiptReadingMeta).store ?? {}) as ReceiptHeader;
  const storeId = await ensureStore(db, input.store, header);
  const [store] = storeId ? await db.select({ chain: stores.chain, name: stores.name }).from(stores).where(eq(stores.id, storeId)).limit(1) : [];
  const chain = store?.chain ?? chainKey(header.chain ?? header.name);
  const foodIds = [...new Set(input.lines.map((l) => l.foodId).filter((x): x is string => !!x))];
  const foodRows = foodIds.length
    ? await db
        .select({ id: foods.id, barcode: foods.barcode, quantityLabel: foods.quantityLabel, name: foods.name, nameEs: foods.nameEs })
        .from(foods)
        .where(and(inArray(foods.id, foodIds), sql`(${foods.groupId} is null or ${foods.groupId} = ${input.groupId})`))
    : [];
  const byId = new Map(foodRows.map((f) => [f.id, f]));
  await db.transaction(async (tx) => {
    await tx.delete(prices).where(eq(prices.receiptId, r.id));
    await tx.delete(receiptItems).where(eq(receiptItems.receiptId, r.id));
    const rows = [];
    for (const [i, l] of input.lines.entries()) {
      const food = l.foodId ? byId.get(l.foodId) : undefined;
      const lp = food ? receiptLinePrice(l, food.quantityLabel) : null;
      let priceId: string | null = null;
      if (food && lp) {
        const [p] = await tx
          .insert(prices)
          .values({ foodId: food.id, barcode: food.barcode, storeId, groupId: input.groupId, price: lp.price.toFixed(2), pricePerKg: lp.pricePerKg != null ? lp.pricePerKg.toFixed(2) : null, packGrams: lp.packGrams, source: "receipt", observedOn: input.date, receiptId: r.id })
          .returning({ id: prices.id });
        priceId = p!.id;
      }
      rows.push(itemRow(r.id, i, { ...l, foodId: food ? food.id : null, matchConfidence: l.matchConfidence ?? null }, priceId));
    }
    if (rows.length) await tx.insert(receiptItems).values(rows);
    const learn = input.lines.filter((l) => l.foodId && byId.has(l.foodId));
    if (learn.length) {
      const uniq = new Map(learn.map((l) => [normReceiptText(l.rawText), l.foodId!]));
      await tx
        .insert(receiptAliases)
        .values([...uniq].filter(([n]) => n).map(([normText, foodId]) => ({ groupId: input.groupId, chain, normText, foodId })))
        .onConflictDoUpdate({ target: [receiptAliases.groupId, receiptAliases.chain, receiptAliases.normText], set: { foodId: sql`excluded.food_id`, uses: sql`${receiptAliases.uses} + 1`, updatedAt: new Date() } });
    }
    if (input.toPantry) {
      // Only lines linked to a food: bags, cleaning products and unknown lines stay out of the pantry.
      const food = input.lines.filter((l) => l.foodId && byId.has(l.foodId));
      if (food.length)
        await tx.insert(pantryItems).values(
          food.map((l) => {
            const f = l.foodId ? byId.get(l.foodId) : undefined;
            const name = (f ? (f.nameEs ?? f.name) : l.name).slice(0, 120);
            const q = l.unit === "ud" ? l.quantity : Math.round(l.quantity * 1000);
            return { groupId: input.groupId, foodId: f?.id ?? null, name, quantity: q > 0 ? q : 1, unit: l.unit === "kg" ? "g" : l.unit === "l" ? "ml" : "ud", location: locationFor(guessCategory(name)) };
          }),
        );
    }
    await tx
      .update(receipts)
      .set({ status: "confirmed", storeId, purchasedOn: input.date, total: input.total != null ? input.total.toFixed(2) : null, shareKey: input.shareKey, openPrices: input.shareKey ? { status: "pending" } : r.openPrices, updatedAt: new Date() })
      .where(eq(receipts.id, r.id));
  });
  return { receiptId: r.id, share: !!input.shareKey };
}
