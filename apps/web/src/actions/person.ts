"use server";
import { UserError } from "@/lib/errors";
import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { getPersonAccess } from "@nutria/db";
import { db } from "@/lib/db";
import { getApiUser, PERSON_COOKIE } from "@/lib/session";

/** Switch the active person (only to persons the user can access). */
export async function switchPerson(personId: string) {
  const user = await getApiUser();
  if (!user) throw new UserError("No autenticado");
  if (!(await getPersonAccess(db(), user.id, personId))) throw new UserError("Sin acceso a esa persona");
  (await cookies()).set(PERSON_COOKIE, personId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  refresh();
}
