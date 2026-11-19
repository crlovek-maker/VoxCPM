"use client";
import { useMemo, useRef } from "react";
import type { Capabilities, FieldError as FE, SectionVoice, SongInput, VocalMode } from "@/lib/types";
import { SECTION_TAGS, allLyricLines, defaultSectionVoice, effectiveSectionVoice, insertTagAt, parseLyrics } from "@/lib/lyrics";
import { PRESETS, VOICE_DIRECTIONS, defaultVoiceFor } from "@/lib/presets";
import type { Key } from "@/lib/i18n";
import sample from "../../samples/khmer-sample.json";
import { Badge, FieldError, type TFn } from "./ui";

interface Props {
  input: SongInput;
  patch: (p: Partial<SongInput>) => void;
  setAll: (i: SongInput) => void;
  caps: Capabilities;
  errors: FE[];
  t: TFn;
}

const tagKey = (id: string) => id.replaceAll("-", "_");
const LENGTHS = [null, 60, 120, 180, 240, 300];

export default function Editor({ input, patch, setAll, caps, errors, t }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const sections = useMemo(() => parseLyrics(input.lyrics), [input.lyrics]);
  const lines = useMemo(() => [...new Set(allLyricLines(sections))], [sections]);
  const err = (f: string) => errors.some((e) => e.field === f);
  const instrumental = input.outputMode === "instrumental";

  const addTag = (tag: string) => {
    const el = ta.current;
    const caret = el ? el.selectionStart : input.lyrics.length;
    const r = insertTagAt(input.lyrics, tag, caret);
    patch({ lyrics: r.text });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  };

  const setMode = (vocalMode: VocalMode) => {
    const vd = VOICE_DIRECTIONS.find((v) => v.id === input.voiceDirection);
    patch({ vocalMode, voiceDirection: input.voiceDirection === "custom" || vd?.for === vocalMode ? input.voiceDirection : defaultVoiceFor(vocalMode) });
  };

  const setSectionVoice = (i: number, v: SectionVoice) => patch({ sectionVoices: { ...input.sectionVoices, [String(i)]: v } });
  const autoAssign = () => patch({ sectionVoices: Object.fromEntries(sections.map((_, i) => [String(i), defaultSectionVoice(sections, i)])) });

  return (
    <>
      {/* 1 · SONG */}
      <section className="card" aria-labelledby="s1">
        <h2 id="s1">{t("secSong")}</h2>
        <div>
          <label className="lbl" htmlFor="title">{t("title")}</label>
          <input id="title" type="text" className={err("title") ? "invalid" : ""} value={input.title} maxLength={140} placeholder={t("titlePh")} onChange={(e) => patch({ title: e.target.value })} />
          <FieldError errs={errors} field="title" t={t} />
        </div>
        <div>
          <label className="lbl" htmlFor="lyrics">{t("lyrics")}</label>
          <div className="row" style={{ marginBottom: 8 }}>
            {SECTION_TAGS.map((tag) => (
              <button key={tag} type="button" className="chip tag" onClick={() => addTag(tag)} aria-label={`${t("lyrics")}: [${tag}]`}>[{tag}]</button>
            ))}
          </div>
          <textarea id="lyrics" ref={ta} className={err("lyrics") ? "invalid" : ""} value={input.lyrics} placeholder={t("lyricsPh")} onChange={(e) => patch({ lyrics: e.target.value })} spellCheck={false} lang="km" />
          <FieldError errs={errors} field="lyrics" t={t} />
          <p className="help">{t("lyricsHelp")}</p>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={() => setAll({ ...(sample as unknown as SongInput) })}>{t("loadSample")}</button>
            <button type="button" className="btn" onClick={() => patch({ lyrics: "", hints: {}, sectionVoices: {} })}>{t("clear")}</button>
          </div>
        </div>

        <div>
          <span className="lbl">{t("structure")}</span>
          {sections.length === 0 ? (
            <p className="help">{t("noSections")}</p>
          ) : (
            <div className="sections">
              {sections.map((s) => (
                <div className="sec" key={s.index}>
                  <span className="name">[{s.label}]</span>
                  <span className="meta">{t("lines", { n: s.lines.length })}</span>
                  {s.implicit && <span className="meta">· {t("implicitVerse")}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <details>
          <summary>{t("hints")}</summary>
          <p className="help">{t("hintsHelp")}</p>
          {caps.pronunciationHints === "none" ? (
            <p className="help"><Badge kind="none">{t("cap_none")}</Badge> {t("hintsNone")}</p>
          ) : (
            <>
              <p className="help"><Badge kind={caps.pronunciationHints}>{t(`cap_${caps.pronunciationHints}` as Key)}</Badge> {t("hintsNote")}</p>
              <label className="check" style={{ margin: "8px 0" }}>
                <input type="checkbox" checked={input.sendHints} onChange={(e) => patch({ sendHints: e.target.checked })} />
                <span>{t("sendHints")}</span>
              </label>
            </>
          )}
          {lines.length === 0 && <p className="help">{t("noSections")}</p>}
          {lines.map((l, i) => (
            <div className="hintrow" key={l + i}>
              <span className="ln" lang="km">{l}</span>
              <input type="text" aria-label={`${t("hints")} #${i + 1}`} value={input.hints[l] ?? ""} maxLength={220} placeholder={t("hintPh")} onChange={(e) => {
                const next = { ...input.hints };
                if (e.target.value) next[l] = e.target.value;
                else delete next[l];
                patch({ hints: next });
              }} />
            </div>
          ))}
          <FieldError errs={errors} field="hints" t={t} />
        </details>
      </section>

      {/* 2 · STYLE */}
      <section className="card" aria-labelledby="s2">
        <h2 id="s2">{t("secStyle")}</h2>
        <div>
          <span className="lbl">{t("presets")}</span>
          <div className="row" role="group" aria-label={t("presets")}>
            {PRESETS.map((p) => (
              <button key={p.id} type="button" className={`chip ${input.presetId === p.id ? "on" : ""}`} aria-pressed={input.presetId === p.id} onClick={() => patch({ presetId: p.id, stylePrompt: p.style })}>
                {t(`preset_${tagKey(p.id)}` as Key)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="lbl" htmlFor="style">{t("stylePrompt")} <Badge kind="prompt">{t("cap_prompt")}</Badge></label>
          <textarea id="style" style={{ minHeight: 110 }} className={err("stylePrompt") ? "invalid" : ""} value={input.stylePrompt} placeholder={t("stylePh")} onChange={(e) => patch({ stylePrompt: e.target.value })} />
          <FieldError errs={errors} field="stylePrompt" t={t} />
          <p className="help">{t("styleHelp")}</p>
        </div>
        <div>
          <label className="lbl" htmlFor="len">{t("length")} <Badge kind="prompt">{t("cap_prompt")}</Badge></label>
          <select id="len" value={input.targetSeconds ?? ""} onChange={(e) => patch({ targetSeconds: e.target.value ? Number(e.target.value) : null })}>
            {LENGTHS.map((n) => <option key={n ?? "auto"} value={n ?? ""}>{n ? t("lengthSec", { n }) : t("lengthAuto")}</option>)}
          </select>
          <FieldError errs={errors} field="targetSeconds" t={t} />
          <p className="help">{t("lengthGuidance")}</p>
        </div>
      </section>

      {/* 3 · VOICE */}
      <section className="card" aria-labelledby="s3" style={instrumental ? { opacity: 0.55 } : undefined}>
        <h2 id="s3">{t("secVoice")}</h2>
        <div>
          <span className="lbl">{t("vocalMode")}</span>
          <div className="seg" role="group" aria-label={t("vocalMode")}>
            {(["male", "female", "duet"] as VocalMode[]).map((m) => (
              <button key={m} type="button" className={input.vocalMode === m ? "on" : ""} aria-pressed={input.vocalMode === m} disabled={instrumental} onClick={() => setMode(m)}>
                {t(m === "male" ? "maleSolo" : m === "female" ? "femaleSolo" : "duet")}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="lbl" htmlFor="vd">{t("voiceDirection")} <Badge kind={caps.voiceDirection}>{t(`cap_${caps.voiceDirection}` as Key)}</Badge></label>
          <select id="vd" value={input.voiceDirection} disabled={instrumental} onChange={(e) => patch({ voiceDirection: e.target.value })}>
            {VOICE_DIRECTIONS.filter((v) => v.for === input.vocalMode).map((v) => <option key={v.id} value={v.id}>{t(`vd_${tagKey(v.id)}` as Key)}</option>)}
            <option value="custom">{t("vd_custom")}</option>
          </select>
          {input.voiceDirection === "custom" && (
            <input type="text" style={{ marginTop: 8 }} value={input.voiceCustom} maxLength={220} placeholder={t("voiceCustomPh")} onChange={(e) => patch({ voiceCustom: e.target.value })} aria-label={t("voiceCustomPh")} />
          )}
          <FieldError errs={errors} field="voiceCustom" t={t} />
          <p className="help">{t("voiceNote")}</p>
        </div>

        {input.vocalMode === "duet" && !instrumental && (
          <div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="lbl" style={{ margin: 0 }}>{t("sectionVoices")} <Badge kind={caps.sectionVoice}>{t(`cap_${caps.sectionVoice}` as Key)}</Badge></span>
              <button type="button" className="chip" onClick={autoAssign}>{t("autoAssign")}</button>
            </div>
            <p className="help">{caps.sectionVoice === "none" ? t("sectionVoicesNone") : t("sectionVoicesGuidance")}</p>
            <div className="sections" style={{ marginTop: 8 }}>
              {sections.filter((s) => s.lines.length > 0).map((s) => {
                const v = effectiveSectionVoice(sections, s.index, "duet", input.sectionVoices);
                return (
                  <div className="sec" key={s.index}>
                    <span className="name">[{s.label}]</span>
                    <div className={`seg ${v}`} role="group" aria-label={`[${s.label}]`}>
                      {(["male", "female", "both"] as SectionVoice[]).map((opt) => (
                        <button key={opt} type="button" className={v === opt ? "on" : ""} aria-pressed={v === opt} onClick={() => setSectionVoice(s.index, opt)}>{t(opt)}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={input.naturalSinging} disabled={instrumental} onChange={(e) => patch({ naturalSinging: e.target.checked })} />
          <span><b>{t("natural")}</b> <Badge kind="prompt">{t("cap_prompt")}</Badge><br /><span className="help">{t("naturalHelp")}</span></span>
        </label>
      </section>

      {/* 4 · OUTPUT */}
      <section className="card" aria-labelledby="s4">
        <h2 id="s4">{t("secOutput")}</h2>
        <div className="radio-cards" role="radiogroup" aria-label={t("secOutput")}>
          <button type="button" role="radio" aria-checked={input.outputMode === "full"} className={`rcard ${input.outputMode === "full" ? "on" : ""}`} onClick={() => patch({ outputMode: "full" })}>{t("outFull")}</button>
          <button type="button" role="radio" aria-checked={input.outputMode === "instrumental"} disabled={!caps.instrumental} className={`rcard ${input.outputMode === "instrumental" ? "on" : ""}`} onClick={() => patch({ outputMode: "instrumental" })}>{t("outInstr")}</button>
          <button type="button" role="radio" aria-checked={input.outputMode === "vocals"} disabled={!caps.vocalsOnly} className={`rcard ${input.outputMode === "vocals" ? "on" : ""}`} onClick={() => patch({ outputMode: "vocals" })}>
            {t("outVocals")}
            {!caps.vocalsOnly && <small>{t("vocalsUnavailable", { reason: caps.vocalsOnlyReason })}</small>}
          </button>
        </div>
        <FieldError errs={errors} field="outputMode" t={t} />
      </section>
    </>
  );
}
