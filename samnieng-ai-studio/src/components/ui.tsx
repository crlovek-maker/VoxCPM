"use client";
import type { Lang } from "@/lib/types";
import { tr, type Key } from "@/lib/i18n";

export type TFn = (key: Key, params?: Record<string, string | number>) => string;
export const makeT = (lang: Lang): TFn => (k, p) => tr(lang, k, p);

export function Badge({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function FieldError({ errs, field, t }: { errs: { field: string; key: string; params?: Record<string, string | number> }[]; field: string; t: TFn }) {
  const e = errs.filter((x) => x.field === field);
  return <>{e.map((x, i) => <p key={i} className="field-err" role="alert">{t(x.key as Key, x.params)}</p>)}</>;
}
