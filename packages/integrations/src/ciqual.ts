/**
 * CIQUAL (ANSES) XML import. Files: alim_*.xml (foods), const_*.xml (constituents), compo_*.xml (values),
 * alim_grp_*.xml (groups). Encoding is windows-1252. Parsed with lightweight regexes (flat XML).
 */
import type { CiqualRow } from "@nutria/nutrition";

export const CIQUAL_ZIP_URL = "https://ciqual.anses.fr/cms/sites/default/files/inline-files/XML_2020_07_07.zip";
/** Same official file archived by the Wayback Machine, for when ANSES is down (it goes into maintenance). */
export const CIQUAL_ZIP_FALLBACK_URL = "https://web.archive.org/web/2024id_/https://ciqual.anses.fr/cms/sites/default/files/inline-files/XML_2020_07_07.zip";

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`));
  return m ? m[1]!.trim() : "";
};

function records(xml: string, recordTag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${recordTag}>([\\s\\S]*?)</${recordTag}>`, "g"))].map((m) => m[1]!);
}

export function decodeLatin1(buf: Uint8Array): string {
  return new TextDecoder("windows-1252").decode(buf);
}

export function parseCiqual(xml: { alim: string; constituents: string; compo: string; groups?: string }): CiqualRow[] {
  const constNames = new Map<string, string>();
  for (const r of records(xml.constituents, "CONST")) constNames.set(tag(r, "const_code"), tag(r, "const_nom_fr"));
  const groupNames = new Map<string, string>();
  if (xml.groups) for (const r of records(xml.groups, "ALIM_GRP")) groupNames.set(tag(r, "alim_grp_code"), tag(r, "alim_grp_nom_fr"));
  const values = new Map<string, Record<string, string>>();
  for (const r of records(xml.compo, "COMPO")) {
    const code = tag(r, "alim_code");
    const cname = constNames.get(tag(r, "const_code"));
    if (!cname) continue;
    let v = values.get(code);
    if (!v) values.set(code, (v = {}));
    v[cname] = tag(r, "teneur");
  }
  return records(xml.alim, "ALIM").map((r) => {
    const code = tag(r, "alim_code");
    return {
      code,
      nameFr: tag(r, "alim_nom_fr"),
      nameEn: tag(r, "alim_nom_eng") || undefined,
      group: groupNames.get(tag(r, "alim_grp_code")) ?? undefined,
      values: values.get(code) ?? {},
    };
  });
}
