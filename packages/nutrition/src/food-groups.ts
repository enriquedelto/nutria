/**
 * Food groups for browsing ("Explorar"): one Spanish group per food, derived from Open Food Facts
 * category tags, CIQUAL groups (refined by name) or Mercadona's "Section › Subsection" categories,
 * with a name-based fallback. Stored in foods.food_group (filled on import and by a nightly job).
 */

export interface FoodGroup {
  key: string;
  name: string;
  /** lucide icon name used by the web app */
  icon: string;
}

export const FOOD_GROUPS: FoodGroup[] = [
  { key: "carne", name: "Carne", icon: "Beef" },
  { key: "embutidos", name: "Embutidos y fiambres", icon: "Ham" },
  { key: "pescado", name: "Pescado y marisco", icon: "Fish" },
  { key: "huevos", name: "Huevos", icon: "Egg" },
  { key: "lacteos", name: "Leche y yogures", icon: "Milk" },
  { key: "quesos", name: "Quesos", icon: "Pizza" },
  { key: "vegetal_proteina", name: "Tofu, soja y alternativas", icon: "Sprout" },
  { key: "legumbres", name: "Legumbres", icon: "Bean" },
  { key: "cereales", name: "Pan y cereales", icon: "Wheat" },
  { key: "pasta_arroz", name: "Pasta y arroz", icon: "Soup" },
  { key: "patatas", name: "Patatas y tubérculos", icon: "Carrot" },
  { key: "frutas", name: "Frutas", icon: "Apple" },
  { key: "verduras", name: "Verduras y hortalizas", icon: "Salad" },
  { key: "frutos_secos", name: "Frutos secos y semillas", icon: "Nut" },
  { key: "grasas", name: "Aceites y grasas", icon: "Droplet" },
  { key: "dulces", name: "Dulces, bollería y postres", icon: "Cookie" },
  { key: "snacks", name: "Snacks salados", icon: "Popcorn" },
  { key: "platos", name: "Platos preparados", icon: "CookingPot" },
  { key: "salsas", name: "Salsas, especias y condimentos", icon: "FlaskRound" },
  { key: "bebidas", name: "Bebidas", icon: "CupSoda" },
  { key: "alcohol", name: "Bebidas alcohólicas", icon: "Wine" },
  { key: "suplementos", name: "Suplementos y deporte", icon: "Dumbbell" },
  { key: "infantil", name: "Alimentación infantil", icon: "Baby" },
  { key: "otros", name: "Otros", icon: "Package" },
];

/** Not food (perfume, pet food, cleaning…): hidden from Explorar. */
export const NON_FOOD = "no_alimento";

export const FOOD_GROUP_BY_KEY = Object.fromEntries(FOOD_GROUPS.map((g) => [g.key, g])) as Record<string, FoodGroup>;

/** Open Food Facts tags, checked in this order (specific before generic). */
const OFF_RULES: [string, string[]][] = [
  ["suplementos", ["en:dietary-supplements", "en:bodybuilding-supplements", "en:protein-powders", "en:sports-nutrition", "en:protein-bars"]],
  ["infantil", ["en:baby-foods", "en:baby-milks", "en:infant-formulas"]],
  ["alcohol", ["en:alcoholic-beverages", "en:wines", "en:beers", "en:spirits", "en:ciders"]],
  ["vegetal_proteina", ["en:meat-analogues", "en:meat-alternatives", "en:tofu", "en:tempeh", "en:seitan", "en:plant-based-milk-alternatives", "en:dairy-substitutes", "en:soy-milks", "en:oat-milks", "en:almond-milks"]],
  ["platos", ["en:meals", "en:prepared-meals", "en:pizzas", "en:pizzas-pies-and-quiches", "en:soups", "en:sandwiches", "en:prepared-salads", "en:lasagnas", "en:ready-meals", "en:frozen-ready-meals"]],
  ["quesos", ["en:cheeses"]],
  ["embutidos", ["en:prepared-meats", "en:hams", "en:sausages", "en:dry-sausages", "en:cured-meats", "en:chorizos", "en:salamis", "en:pates", "en:bacon"]],
  ["huevos", ["en:eggs", "en:chicken-eggs"]],
  ["pescado", ["en:seafood", "en:fishes", "en:fish-and-seafood", "en:canned-fishes", "en:tunas", "en:crustaceans", "en:mollusc", "en:molluscs"]],
  ["carne", ["en:meats", "en:poultries", "en:chickens", "en:beef", "en:pork", "en:turkeys", "en:lamb", "en:meats-and-their-products"]],
  ["lacteos", ["en:milks", "en:yogurts", "en:fermented-milk-products", "en:skyrs", "en:kefirs", "en:creams", "en:dairy-desserts", "en:dairies"]],
  ["legumbres", ["en:legumes", "en:pulses", "en:legumes-and-their-products", "en:chickpeas", "en:lentils", "en:beans", "en:hummus"]],
  ["frutos_secos", ["en:nuts", "en:seeds", "en:nuts-and-their-products", "en:peanuts", "en:almonds", "en:walnuts", "en:nut-butters", "en:peanut-butters"]],
  ["grasas", ["en:fats", "en:vegetable-oils", "en:olive-oils", "en:butters", "en:margarines", "en:animal-fats"]],
  ["salsas", ["en:condiments", "en:sauces", "en:spices", "en:salts", "en:vinegars", "en:mayonnaises", "en:ketchup", "en:mustards", "en:broths", "en:stocks"]],
  ["dulces", ["en:sweet-snacks", "en:biscuits-and-cakes", "en:biscuits", "en:cakes", "en:pastries", "en:viennoiseries", "en:confectioneries", "en:chocolates", "en:candies", "en:desserts", "en:ice-creams", "en:sweet-spreads", "en:jams", "en:honeys", "en:sugars"]],
  ["snacks", ["en:salty-snacks", "en:chips-and-fries", "en:crisps", "en:appetizers", "en:crackers", "en:popcorn"]],
  ["bebidas", ["en:beverages", "en:waters", "en:sodas", "en:coffees", "en:teas", "en:juices", "en:fruit-juices", "en:plant-based-beverages"]],
  ["pasta_arroz", ["en:pastas", "en:rices", "en:noodles", "en:couscous", "en:semolinas"]],
  ["patatas", ["en:potatoes", "en:potato-products", "en:sweet-potatoes"]],
  ["cereales", ["en:breads", "en:breakfast-cereals", "en:flours", "en:cereals-and-their-products", "en:cereal-grains", "en:oat-flakes", "en:rusks", "en:tortillas"]],
  ["frutas", ["en:fruits", "en:fresh-fruits", "en:dried-fruits", "en:fruits-based-foods", "en:compotes"]],
  ["verduras", ["en:vegetables", "en:fresh-vegetables", "en:vegetables-based-foods", "en:canned-vegetables", "en:frozen-vegetables", "en:mushrooms", "en:salads"]],
  ["cereales", ["en:cereals-and-potatoes"]],
];

const FRUIT = /(pomme(?! de terre)|poire|banane|orange|mandarine|clémentine|citron|pamplemousse|fraise|framboise|myrtille|cerise|abricot|pêche|nectarine|prune|raisin|kiwi|ananas|mangue|papaye|melon|pastèque|figue|datte|grenade|litchi|goyave|fruit|manzana|pera|plátano|naranja|fresa|uva|melocotón|sandía|cereza)/;
const NUT = /(amande|noix|noisette|pistache|cajou|graine|sésame|cacahuète|arachide|pignon|almendra|nuez|avellana|pipa|semilla|cacahuete|anacardo)/;
const LEGUME = /(lentille|pois chiche|haricot (sec|blanc|rouge|noir)|fève|flageolet|soja, graine|lupin|lenteja|garbanzo|alubia|judía (blanca|pinta)|haba)/;
const POTATO = /(pomme de terre|patate|topinambour|manioc|igname|patata|boniato|yuca)/;
const EGG = /(œuf|oeuf|huevo)/;
const FISH = /(poisson|saumon|thon|cabillaud|merlu|sardine|maquereau|truite|sole|colin|lieu|bar |dorade|anchois|hareng|crevette|moule|huître|calmar|seiche|poulpe|crabe|homard|langoustine|coquille|surimi|pescado|salmón|atún|merluza|bacalao|gamba|mejillón|calamar|pulpo|sardina)/;
const COLD_CUT = /(jambon|saucisse|saucisson|chorizo|pâté|rillettes|lardon|bacon|salami|mortadelle|boudin|andouille|jamón|salchicha|salchichón|fuet|lomo embuchado|mortadela|morcilla|fiambre)/;
const CHEESE = /(fromage|camembert|emmental|comté|mozzarella|parmesan|feta|roquefort|chèvre|brie|gouda|edam|cheddar|ricotta|mascarpone|raclette|reblochon|queso)/;
const PASTA_RICE = /(pâtes|riz|spaghetti|nouille|semoule|couscous|vermicelle|lasagne|macaroni|tagliatelle|arroz|pasta|fideo|macarrón|espagueti|cuscús)/;
const ALCOHOL = /(vin |vin,|vins|bière|whisky|alcool|liqueur|rhum|vodka|cidre|champagne|apéritif|pastis|cognac|gin |vino|cerveza|ron |licor|sidra|cava)/;

function ciqualGroup(top: string, name: string): string {
  const n = name.toLowerCase();
  if (top.startsWith("viandes")) return EGG.test(n) ? "huevos" : FISH.test(n) ? "pescado" : COLD_CUT.test(n) ? "embutidos" : "carne";
  if (top.startsWith("fruits, légumes")) return LEGUME.test(n) ? "legumbres" : NUT.test(n) ? "frutos_secos" : POTATO.test(n) ? "patatas" : FRUIT.test(n) ? "frutas" : "verduras";
  if (top.startsWith("produits céréaliers")) return PASTA_RICE.test(n) ? "pasta_arroz" : POTATO.test(n) ? "patatas" : "cereales";
  if (top.startsWith("produits laitiers")) return CHEESE.test(n) ? "quesos" : "lacteos";
  if (top.startsWith("produits sucrés") || top.startsWith("glaces")) return "dulces";
  if (top.startsWith("eaux")) return ALCOHOL.test(n) ? "alcohol" : "bebidas";
  if (top.startsWith("entrées")) return "platos";
  if (top.startsWith("aides culinaires")) return "salsas";
  if (top.startsWith("matières grasses")) return "grasas";
  if (top.startsWith("aliments infantiles")) return "infantil";
  return "platos";
}

/** Mercadona "Sección › Subsección": section default plus subsection overrides (first match wins). */
const STORE_SECTIONS: Record<string, [string, [RegExp, string][]]> = {
  "Aceite, especias y salsas": ["salsas", [[/aceite/i, "grasas"]]],
  "Agua y refrescos": ["bebidas", []],
  Aperitivos: ["snacks", [[/frutos secos/i, "frutos_secos"], [/fruta/i, "frutas"]]],
  "Arroz, legumbres y pasta": ["pasta_arroz", [[/(alubia|garbanzo|lenteja)/i, "legumbres"]]],
  "Azúcar, caramelos y chocolate": ["dulces", []],
  Bebé: [NON_FOOD, [[/(leche|papilla|tarrito|yogur)/i, "infantil"]]],
  Bodega: ["alcohol", [[/sin alcohol/i, "bebidas"]]],
  "Cacao, café e infusiones": ["bebidas", []],
  Carne: ["carne", [[/embutido/i, "embutidos"]]],
  "Cereales y galletas": ["cereales", [[/galleta|chocolate/i, "dulces"]]],
  "Charcutería y quesos": ["embutidos", [[/queso/i, "quesos"]]],
  Congelados: ["platos", [
    [/(helado|bombon|bombón|churro|cucurucho|granizado|tarrina|tarta)/i, "dulces"],
    [/(pescado|marisco)/i, "pescado"], [/carne/i, "carne"], [/fruta/i, "frutas"], [/patata/i, "patatas"],
    [/verdura/i, "verduras"], [/hielo/i, "bebidas"],
  ]],
  "Conservas, caldos y cremas": ["platos", [
    [/(atún|berberecho|bonito|caballa|mejill|pescado|sardina)/i, "pescado"], [/pastilla/i, "salsas"],
    [/fruta/i, "frutas"], [/(verdura|tomate)/i, "verduras"],
  ]],
  "Fruta y verdura": ["verduras", [[/(cítrico|fruta|manzana|melón|plátano)/i, "frutas"], [/patata/i, "patatas"]]],
  "Huevos, leche y mantequilla": ["lacteos", [
    [/huevo/i, "huevos"], [/vegetal/i, "vegetal_proteina"], [/(mantequilla|margarina)/i, "grasas"], [/infantil/i, "infantil"],
  ]],
  "Marisco y pescado": ["pescado", []],
  "Panadería y pastelería": ["cereales", [[/(bollería dulce|bollería envasada|pastel|polvor|tarta|decoración)/i, "dulces"], [/vela/i, NON_FOOD]]],
  "Pizzas y platos preparados": ["platos", [[/hummus/i, "legumbres"]]],
  "Postres y yogures": ["lacteos", [[/soja/i, "vegetal_proteina"], [/(flan|gelatina|natilla|otros postres)/i, "dulces"]]],
  Zumos: ["bebidas", []],
};

function storeGroup(cat: string): string {
  const [section = "", sub = ""] = cat.split(" › ");
  const rule = STORE_SECTIONS[section];
  if (!rule) return NON_FOOD; // personal care, cleaning, pets, parapharmacy…
  for (const [re, g] of rule[1]) if (re.test(sub)) return g;
  return rule[0];
}

/** Last resort: Spanish/French/English keywords in the name. */
const NAME_RULES: [RegExp, string][] = [
  [/(whey|proteína en polvo|protein powder|creatina|creatine|barrita proteica|protein bar)/i, "suplementos"],
  [ALCOHOL, "alcohol"],
  [/(tofu|tempeh|seitán|bebida de (soja|avena|almendra|arroz)|heura)/i, "vegetal_proteina"],
  [/(pizza|lasaña|croqueta|empanada|tortilla de patata|paella|sopa|crema de|ensaladilla|sándwich|sandwich|burrito)/i, "platos"],
  [CHEESE, "quesos"],
  [COLD_CUT, "embutidos"],
  [EGG, "huevos"],
  [FISH, "pescado"],
  [/(pollo|ternera|cerdo|pavo|cordero|conejo|carne|filete|hamburguesa|chicken|beef|pork)/i, "carne"],
  [/(leche|yogur|kéfir|skyr|nata|cuajada|milk|yogurt)/i, "lacteos"],
  [LEGUME, "legumbres"],
  [/(galleta|chocolate|bizcocho|magdalena|croissant|donut|caramelo|golosina|helado|mermelada|miel|cookie|cake)/i, "dulces"],
  [/(patatas fritas|chips|nachos|palomitas|cortezas|crackers)/i, "snacks"],
  [NUT, "frutos_secos"],
  [/(aceite|mantequilla|margarina|manteca|oil|butter)/i, "grasas"],
  [/(salsa|ketchup|mayonesa|mostaza|vinagre|especia|pimienta|orégano|caldo|sauce)/i, "salsas"],
  [PASTA_RICE, "pasta_arroz"],
  [POTATO, "patatas"],
  [/(pan |pan$|cereales|avena|harina|tostada|muesli|granola|bread|cereal)/i, "cereales"],
  [FRUIT, "frutas"],
  [/(lechuga|tomate|zanahoria|cebolla|pimiento|brócoli|espinaca|calabac|berenjena|pepino|judía verde|champiñón|verdura|vegetable)/i, "verduras"],
  [/(agua|refresco|zumo|café|té |infusión|bebida|juice|soda|water)/i, "bebidas"],
];

export interface GroupableFood {
  name: string;
  nameEs?: string | null;
  categories?: string[] | null;
  kind?: string | null;
}

/** Group key for a food, or null when nothing matches. NON_FOOD for store non-food items. */
export function groupOf(f: GroupableFood): string | null {
  if (f.kind === "supplement") return "suplementos";
  if (f.kind === "alcohol") return "alcohol";
  const cats = f.categories ?? [];
  const names = `${f.nameEs ?? ""} ${f.name}`.toLowerCase();
  const ciqual = cats.find((c) => c.startsWith("ciqual:"));
  if (ciqual) return ciqualGroup(ciqual.slice(7), `${f.name} ${f.nameEs ?? ""}`);
  const store = cats.find((c) => c.includes("›"));
  if (store) return storeGroup(store);
  if (cats.length) {
    const set = new Set(cats);
    for (const [g, tags] of OFF_RULES) if (tags.some((t) => set.has(t))) return g;
  }
  for (const [re, g] of NAME_RULES) if (re.test(names)) return g;
  return null;
}
