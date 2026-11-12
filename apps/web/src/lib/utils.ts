import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** Current time for server components (a helper keeps React Compiler's purity rule for render bodies happy). */
export const nowMs = () => Date.now();
export const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
