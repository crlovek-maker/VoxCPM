"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CapabilitiesResponse, FieldError, Job, Lang, SongInput } from "@/lib/types";
import { coerceInput, validateInput } from "@/lib/validate";
import { defaultVoiceFor, presetById } from "@/lib/presets";
import Editor from "./Editor";
import { ErrorBox, JobCard, Library, inflight } from "./JobViews";
import { Badge, makeT } from "./ui";
import type { Key } from "@/lib/i18n";

const STORE = "samnieng.studio.v1";
const emptyInput = (): SongInput => ({
  title: "",
  lyrics: "[Verse]\n\n[Chorus]\n",
  presetId: "khmer-sad-ballad",
  stylePrompt: presetById("khmer-sad-ballad")!.style,
  vocalMode: "female",
  voiceDirection: defaultVoiceFor("female"),
  voiceCustom: "",
  sectionVoices: {},
  outputMode: "full",
  targetSeconds: null,
  hints: {},
  sendHints: false,
  naturalSinging: true,
});

const safe = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, init);
  let data = {} as T;
  try { data = await res.json(); } catch { /* empty */ }
  return { ok: res.ok, status: res.status, data };
}

export default function Studio() {
  const [lang, setLang] = useState<Lang>("km");
  const [input, setInput] = useState<SongInput>(emptyInput);
  const [capsRes, setCapsRes] = useState<CapabilitiesResponse | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<"create" | "library">("create");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [apiError, setApiError] = useState<{ code: string; message?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const submitLock = useRef(false);
  const t = useMemo(() => makeT(lang), [lang]);

  // restore draft + language (per-browser convenience only; songs live on the server)
  useEffect(() => {
    try {
      const saved = JSON.parse(safe.get(STORE) ?? "null");
      if (saved?.lang === "km" || saved?.lang === "en") setLang(saved.lang);
      if (saved?.input) setInput(coerceInput(saved.input));
      if (typeof saved?.activeId === "string") setActiveId(saved.activeId);
      if (saved?.tab === "create" || saved?.tab === "library") setTab(saved.tab);
    } catch { /* ignore corrupt draft */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const h = setTimeout(() => safe.set(STORE, JSON.stringify({ lang, input, activeId, tab })), 300);
    return () => clearTimeout(h);
  }, [lang, input, activeId, tab, loaded]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const refresh = useCallback(async () => {
    try {
      const [c, j] = await Promise.all([api<CapabilitiesResponse>("/api/capabilities"), api<{ jobs: Job[] }>("/api/jobs")]);
      if (c.ok) setCapsRes(c.data);
      if (j.ok) setJobs(j.data.jobs);
    } catch { setApiError({ code: "CLIENT" }); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // after (re)load: resume tracking of any in-flight job
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || jobs.length === 0) return;
    resumed.current = true;
    const flying = jobs.find(inflight);
    setActiveId((cur) => (cur && jobs.some((j) => j.id === cur) ? cur : flying?.id ?? jobs[0].id));
    if (flying) setTab("library");
  }, [jobs]);

  // poll in-flight jobs
  const flyingIds = jobs.filter(inflight).map((j) => j.id).join(",");
  useEffect(() => {
    if (!flyingIds) return;
    const iv = setInterval(async () => {
      for (const id of flyingIds.split(",")) {
        try {
          const r = await api<{ job: Job }>(`/api/jobs/${id}`);
          if (r.ok) setJobs((js) => js.map((j) => (j.id === id ? r.data.job : j)));
        } catch { /* transient network error: keep polling */ }
      }
    }, 1200);
    return () => clearInterval(iv);
  }, [flyingIds]);

  const caps = capsRes?.capabilities;
  const patch = useCallback((p: Partial<SongInput>) => { setInput((i) => ({ ...i, ...p })); setErrors([]); }, []);
  const active = jobs.find((j) => j.id === activeId) ?? null;
  const sameInFlight = jobs.some((j) => inflight(j) && JSON.stringify(j.input) === JSON.stringify(coerceInput(input)));

  const upsert = (job: Job) => setJobs((js) => [job, ...js.filter((j) => j.id !== job.id)]);
  const show = (job: Job) => { upsert(job); setActiveId(job.id); setTab("library"); };

  const submit = async () => {
    if (!caps || submitLock.current) return;
    const clean = coerceInput(input);
    const errs = validateInput(clean, caps);
    setErrors(errs);
    setApiError(null);
    setNotice(null);
    if (errs.length) { setTab("create"); return; }
    submitLock.current = true;
    setSubmitting(true);
    try {
      const r = await api<{ job?: Job; duplicate?: boolean; error?: { code: string; message: string; fields?: FieldError[] } }>("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(clean) });
      if (r.ok && r.data.job) {
        show(r.data.job);
        if (r.data.duplicate) setNotice(t("duplicateNote"));
      } else if (r.data.error) {
        setApiError(r.data.error);
        if (r.data.error.fields) setErrors(r.data.error.fields);
        setTab("create");
      } else setApiError({ code: "INTERNAL" });
    } catch { setApiError({ code: "CLIENT" }); setTab("create"); }
    finally { submitLock.current = false; setSubmitting(false); }
  };

  const retry = async (id: string) => {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const r = await api<{ job?: Job; error?: { code: string; message: string } }>(`/api/jobs/${id}/retry`, { method: "POST" });
      if (r.ok && r.data.job) show(r.data.job);
      else setApiError(r.data.error ?? { code: "INTERNAL" });
    } catch { setApiError({ code: "CLIENT" }); }
    finally { submitLock.current = false; setSubmitting(false); }
  };

  const remove = async (id: string) => {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    setJobs((js) => js.filter((j) => j.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const editAsNew = (j: Job) => { setInput(coerceInput(j.input)); setErrors([]); setTab("create"); window.scrollTo({ top: 0 }); };

  if (!caps || !capsRes) {
    return <div className="app"><div className="wrap"><p className="help" role="status">{t("loading")}</p></div></div>;
  }

  const inFlightCount = jobs.filter(inflight).length;
  const banner =
    capsRes.configIssue === "missing_credentials_required" ? <div className="banner warn" role="alert"><b>⚠</b>{t("missingCreds")}</div>
    : capsRes.configIssue === "forced_demo" ? <div className="banner demo" data-testid="demo-banner"><b>DEMO</b>{t("demoForced")}</div>
    : !capsRes.live ? <div className="banner demo" data-testid="demo-banner"><b>DEMO</b>{t("demoBanner")}</div>
    : <div className="banner live" data-testid="live-banner">{t("liveBanner", { provider: `${caps.label}${caps.model ? ` (${caps.model})` : ""}` })}</div>;

  const generateDisabled = submitting || sameInFlight || capsRes.configIssue === "missing_credentials_required";

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="logo" aria-hidden>ស</div>
          <div style={{ minWidth: 0 }}>
            <h1>{t("appName")}</h1>
            <small>{t("tagline")}</small>
          </div>
        </div>
        <button className="langbtn" onClick={() => setLang(lang === "km" ? "en" : "km")} aria-label="Switch language / ប្តូរភាសា" data-testid="lang-toggle">{t("langToggle")}</button>
      </header>

      <main className="wrap">
        <div style={{ gridColumn: "1 / -1", display: "grid", gap: 10 }}>
          {banner}
          {!caps.khmerVerified && <div className="banner warn" data-testid="khmer-warning">{t("khmerUnverified")}</div>}
        </div>

        <div className={`pane-create ${tab === "create" ? "on" : ""}`}>
          {apiError && <ErrorBox code={apiError.code} message={apiError.message} t={t} />}
          <Editor input={input} patch={patch} setAll={(i) => { setInput(coerceInput(i)); setErrors([]); }} caps={caps} errors={errors} t={t} />
          <details>
            <summary>{t("capTitle")} — {caps.label}</summary>
            <div className="caps" style={{ marginTop: 8 }}>
              {([["ctl_voiceDirection", caps.voiceDirection], ["ctl_sectionVoice", caps.sectionVoice], ["ctl_hints", caps.pronunciationHints], ["ctl_style", caps.tempoControl]] as [Key, string][]).map(([k, v]) => (
                <div key={k}><span>{t(k)}</span><Badge kind={v}>{t(`cap_${v}` as Key)}</Badge></div>
              ))}
              <div><span>{t("ctl_vocalsOnly")}</span><Badge kind={caps.vocalsOnly ? "native" : "none"}>{caps.vocalsOnly ? t("cap_native") : t("cap_none")}</Badge></div>
              <div><span>{t("stems")}</span><Badge kind={caps.stems ? "native" : "none"}>{caps.stems ? t("cap_native") : t("cap_none")}</Badge></div>
              <div><span>{t("ctl_customVoice")}</span><Badge kind={caps.customVoices ? "native" : "none"}>{caps.customVoices ? t("cap_native") : t("cap_none")}</Badge></div>
            </div>
            {caps.notes.map((n) => <p className="help" key={n}>{n}</p>)}
          </details>
        </div>

        <div className={`pane-library ${tab === "library" ? "on" : ""}`}>
          {notice && <div className="banner live">{notice}</div>}
          {apiError && tab === "library" && <ErrorBox code={apiError.code} message={apiError.message} t={t} />}
          {active && <JobCard job={active} t={t} lang={lang} busy={submitting} onRetry={() => retry(active.id)} onCancel={() => remove(active.id)} onEdit={() => editAsNew(active)} />}
          <h2 style={{ margin: "4px 0", fontSize: 16, color: "var(--gold)" }}>{t("tabLibrary")}</h2>
          <Library jobs={jobs} activeId={activeId} t={t} lang={lang} onSelect={setActiveId} onDelete={remove} />
        </div>
      </main>

      {(
        <div className={`genbar ${tab === "create" ? "" : "hide-mobile"}`}>
          {errors.length > 0 && <span className="note" role="alert">{t("fixErrors")}</span>}
          <button className="btn primary" onClick={submit} disabled={generateDisabled} data-testid="generate">
            {submitting || sameInFlight ? t("generating") : t("generate")}
          </button>
        </div>
      )}
      <nav className="tabbar" aria-label="Main">
        <button className={tab === "create" ? "on" : ""} onClick={() => setTab("create")} aria-current={tab === "create"}>{t("tabCreate")}</button>
        <button className={tab === "library" ? "on" : ""} onClick={() => setTab("library")} aria-current={tab === "library"} data-testid="tab-library">
          {t("tabLibrary")}{inFlightCount > 0 && <span className="count">{inFlightCount}</span>}
        </button>
      </nav>
    </div>
  );
}
