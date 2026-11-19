"use client";
import { useEffect, useState } from "react";
import type { Job, Lang } from "@/lib/types";
import type { Key } from "@/lib/i18n";
import { Badge, type TFn } from "./ui";

const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const inflight = (j: Job) => j.status === "queued" || j.status === "running";

function useElapsed(job: Job) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!inflight(job)) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [job]);
  return Math.max(0, Math.round((now - new Date(job.createdAt).getTime()) / 1000));
}

export function ErrorBox({ code, message, t }: { code: string; message?: string; t: TFn }) {
  const key = `err.${code}` as Key;
  return (
    <div className="errbox" role="alert">
      {t(key) !== key ? t(key) : message}
      {message && <code>{t("providerMessage")}: {message}</code>}
    </div>
  );
}

export function JobCard({ job, t, lang, busy, onRetry, onCancel, onEdit }: { job: Job; t: TFn; lang: Lang; busy: boolean; onRetry: () => void; onCancel: () => void; onEdit: () => void }) {
  const elapsed = useElapsed(job);
  const demo = job.provider.mode === "demo";
  const r = job.result;
  return (
    <article className="card job" aria-live="polite" data-testid="job-card" data-status={job.status}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Badge kind={`status-${job.status}`}>{t(`status_${job.status}` as Key)}</Badge>
        {demo ? <Badge kind="demo">{t("demoSample")}</Badge> : <span className="sub">{t("liveResult", { provider: job.provider.label })}</span>}
      </div>
      <h3 lang="km">{job.input.title}</h3>

      {inflight(job) && (
        <>
          <div className="sub">{t(`stage_${job.stage}` as Key) !== `stage_${job.stage}` ? t(`stage_${job.stage}` as Key) : job.stage}</div>
          <div className={`bar ${job.progress === null || !demo ? "indet" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={demo && job.progress !== null ? Math.round(job.progress * 100) : undefined}>
            <i style={demo && job.progress !== null ? { width: `${Math.round(job.progress * 100)}%` } : undefined} />
          </div>
          {!demo && <div className="sub">{t("noPercent", { s: elapsed })}</div>}
          <div className="row"><button className="btn danger" onClick={onCancel}>{t("cancel")}</button></div>
        </>
      )}

      {job.status === "failed" && job.error && (
        <>
          <ErrorBox code={job.error.code} message={job.error.message} t={t} />
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={onRetry}>{t("retry")}</button>
            <button className="btn" onClick={onEdit}>{t("loadIntoEditor")}</button>
          </div>
        </>
      )}

      {job.status === "succeeded" && r && (
        <>
          <audio controls preload="metadata" src={`/api/jobs/${job.id}/audio`} data-testid="player" />
          <div className="row">
            <a className="btn primary" href={`/api/jobs/${job.id}/audio?download=1`} download>{t("download", { fmt: `${r.audio.format.toUpperCase()} · ${fmtBytes(r.audio.bytes)}` })}</a>
            <button className="btn" onClick={onEdit}>{t("loadIntoEditor")}</button>
          </div>
          {r.stems && r.stems.length > 0 && (
            <div>
              <span className="lbl">{t("stems")}</span>
              <div className="row">
                {r.stems.map((s) => <a key={s.name} className="btn" href={`/api/jobs/${job.id}/audio?stem=${encodeURIComponent(s.name)}&download=1`} download>{s.name} · {s.format.toUpperCase()}</a>)}
              </div>
            </div>
          )}
        </>
      )}

      <details>
        <summary>{t("whatWasSent")}</summary>
        <div>
          {job.controls.map((c) => (
            <div className="ctl" key={c.id}>
              <span>{t(`ctl_${c.id}` as Key)}</span>
              <Badge kind={c.status}>{t(`ctl_${c.status}` as Key)}</Badge>
              <span className="d">{c.detail}</span>
            </div>
          ))}
        </div>
      </details>
      <span className="sub">{t("created", { when: new Date(job.createdAt).toLocaleString(lang === "km" ? "km-KH" : "en-US") })} · {job.provider.label}{job.provider.model ? ` · ${job.provider.model}` : ""}</span>
    </article>
  );
}

export function Library({ jobs, activeId, t, lang, onSelect, onDelete }: { jobs: Job[]; activeId: string | null; t: TFn; lang: Lang; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
  if (jobs.length === 0) return <p className="help">{t("libraryEmpty")}</p>;
  return (
    <div className="list">
      {jobs.map((j) => (
        <div key={j.id} className={`item ${j.id === activeId ? "sel" : ""}`} data-testid="history-item">
          <button className="t" onClick={() => onSelect(j.id)} lang="km">{j.input.title}</button>
          <div className="row">
            <Badge kind={`status-${j.status}`}>{t(`status_${j.status}` as Key)}</Badge>
            {j.provider.mode === "demo" && <Badge kind="demo">DEMO</Badge>}
            <span className="sub">{new Date(j.createdAt).toLocaleString(lang === "km" ? "km-KH" : "en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
            <span style={{ flex: 1 }} />
            <button className="btn danger" onClick={() => confirm(t("confirmDelete")) && onDelete(j.id)}>{t("delete")}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
