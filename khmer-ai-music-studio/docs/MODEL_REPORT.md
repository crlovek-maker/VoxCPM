# របាយការណ៍ជ្រើសរើសម៉ូដែលតន្ត្រី + សំឡេងច្រៀង

> កាលបរិច្ឆេទស្រាវជ្រាវ៖ **២៣ វិច្ឆិកា ២០២៦**។ ព័ត៌មានទាំងអស់ខាងក្រោមត្រូវបានអាននៅថ្ងៃនោះពីឯកសារផ្លូវការ (README, model card, កូដក្នុង repo) —
> ម៉ូដែលទាំងនេះប្រែប្រួលញឹកញាប់ សូមពិនិត្យតំណផ្លូវការម្ដងទៀតមុនសម្រេចចិត្តចេញផ្សាយបទ។
> **នេះមិនមែនយោបល់ផ្លូវច្បាប់ទេ។**

មានបីប្រភេទព័ត៌មានក្នុងឯកសារនេះ ហើយខ្ញុំបំបែកវាដាច់ពីគ្នាជានិច្ច៖

| និមិត្តសញ្ញា | អត្ថន័យ |
|---|---|
| 📄 **មានក្នុងឯកសារ** | ខ្ញុំអានឃើញក្នុងឯកសារ/កូដផ្លូវការ (អ្នកនិពន្ធម៉ូដែលជាអ្នកអះអាង) |
| ✅ **បានដំណើរការពិត** | ខ្ញុំបានរត់វាក្នុង sandbox ហើយឃើញលទ្ធផល |
| ❓ **មិនទាន់ផ្ទៀងផ្ទាត់** | ខ្ញុំមិនអាចផ្ទៀងផ្ទាត់បាន (ឧ. ត្រូវស្ដាប់ដោយត្រចៀក ឬត្រូវការ GPU) |

---

## ១. សេចក្ដីសង្ខេប

| ចំណុច | ACE-Step 1.5 (ម៉ូដែលដែលបានជ្រើស) |
|---|---|
| **ឈ្មោះ** | ACE-Step 1.5 — DiT `acestep-v15-turbo` (+ LM 5Hz ជាជម្រើស) |
| **តំណផ្លូវការ** | កូដ៖ <https://github.com/ace-step/ACE-Step-1.5> · ទម្ងន់៖ <https://huggingface.co/ACE-Step/Ace-Step1.5> · ទំព័រគម្រោង៖ <https://ace-step.github.io/ace-step-v1.5.github.io/> |
| **ទម្ងន់ទាញយកបាន** | 📄 បាន (Hugging Face / ModelScope) · ✅ បានទាញយកពិត ~៩.៤ GB |
| **ឯកសារដំឡើង** | 📄 `pyproject.toml`, `uv sync`, `uv run acestep-api` (REST), `uv run acestep` (Gradio), កញ្ចប់ Windows/macOS ស្រាប់ |
| **ទទួលទំនុកដែលអ្នកប្រើសរសេរ** | 📄 បាន (`lyrics` ≤ 4096 តួអក្សរ, ស្លាក `[Verse]` `[Chorus]` `[Bridge]`, `[Instrumental]`) · ✅ បានផ្ញើទំនុកខ្មែរពិត ហើយម៉ូដែលបង្កើតសំឡេងចេញមក |
| **អាជ្ញាបណ្ណ** | 📄 **MIT** (កូដ + ទម្ងន់ តាម `LICENSE` និង model card) |
| **ការចេញផ្សាយបទ** | 📄 model card ចែងថា «អាចប្រើបទដែលបង្កើតសម្រាប់ពាណិជ្ជកម្មបាន» (មើលផ្នែក ៣) |
| **GPU / VRAM** | 📄 DiT-only ≥ 4 GB · មាន LM ≥ 6 GB · ថាស ~10 GB · RTX 3090 <10 វិនាទី/បទ (ការអះអាង) · ✅ **មិនបានសាកល្បងលើ GPU** (sandbox គ្មាន GPU) |
| **ភាសាខ្មែរ** | 📄 **ឯកសារមិនបញ្ជាក់ថាគាំទ្រខ្មែរ** → ❓ **ត្រូវសាកល្បងបន្ថែមលើម៉ាស៊ីនរបស់អ្នក** (មើលផ្នែក ៤) |

**សន្និដ្ឋានត្រង់ៗ៖** ACE-Step 1.5 ជាម៉ូដែលតែមួយគត់ដែលខ្ញុំរកឃើញ ដែល (ក) ទាញយកទម្ងន់បាន (ខ) មានអាជ្ញាបណ្ណ MIT ដែលបញ្ជាក់ពីការប្រើពាណិជ្ជកម្ម
(គ) ត្រូវការ VRAM តិច (ឃ) មាន REST API ផ្លូវការដែលងាយភ្ជាប់ពី web app ដោយមិនពឹង Suno។ ប៉ុន្តែ **គ្មានឯកសារណាបញ្ជាក់ថាវាច្រៀងភាសាខ្មែរច្បាស់ទេ**។
ខ្ញុំបានរត់វាពិតហើយបង្កើតបទចេញមក (✅) តែ **ខ្ញុំមិនអាចស្ដាប់ និងវិនិច្ឆ័យថាពាក្យខ្មែរច្បាស់ឬអត់បានទេ (❓)** — អ្នកត្រូវស្ដាប់ខ្លួនឯង។

---

## ២. អ្វីដែលបានដំណើរការពិតក្នុង sandbox (✅)

ម៉ាស៊ីន sandbox៖ **គ្មាន GPU**, CPU 4 core (Intel Xeon មាន AMX), RAM 15 GB។ ខ្ញុំដំឡើង ACE-Step 1.5 ពិត (clone ពី GitHub, torch 2.10.0 ពី PyPI,
ទម្ងន់ពី Hugging Face) ដោយដំឡើង dependency តាម `pyproject.toml` ដោយដៃ (`uv pip install`) ហើយរត់ server ដូចគ្នា `python -m acestep.api_server` លើ **CPU**
(`acestep-api` ចង្អុលទៅ `acestep.api_server:main` តាម `pyproject.toml`)។ **ខ្ញុំមិនបានរត់ `uv sync` / `uv run acestep-api` ដោយខ្លួនឯងទេ** — ពាក្យបញ្ជាទាំងនោះមកពី README ផ្លូវការរបស់ ACE-Step (📄)។

| ការពិនិត្យ | លទ្ធផល |
|---|---|
| ដំឡើង + ទាញយកម៉ូដែល (DiT turbo 4.79 GB + VAE 0.34 GB + Qwen3-Embedding 1.19 GB + LM 1.7B 3.71 GB) | ✅ |
| ចាប់ផ្ដើម `acestep.api_server` លើ CPU, `/health` ឆ្លើយ | ✅ |
| បង្កើតបទពីទំនុកខ្មែរ ៤ បន្ទាត់ តាម adapter របស់ studio (REST: `/release_task` → `/query_result` → `/v1/audio`) | ✅ WAV 28 វិនាទី · 48 kHz · stereo |
| progress ពិតពី server (`stage`, `progress` 0→1) បង្ហាញក្នុង UI | ✅ (ផ្ទុកម៉ូដែល → បង្កើត 53→78% → decode 80% → ពិនិត្យ → ជោគជ័យ) |
| ពេលវេលាលើ CPU | ~២ នាទី ១៥ វិនាទី សម្រាប់បទ 28 វិនាទី (ផ្ទុកម៉ូដែល ~17 វិ · diffusion ~45 វិ · VAE decode ~70 វិ) — **លើ GPU នឹងលឿនជាងនេះច្រើន (ការអះអាងឯកសារ៖ វិនាទី) តែខ្ញុំមិនបានវាស់** |
| លក្ខណៈឯកសារសំឡេងដែលបាន (ការរត់ ៣ ដង, seed ចៃដន្យ) | កម្រិតមធ្យម −17.6 / −17.1 / −19.0 dB · កំពូល −1.0 dBFS · ស្ងាត់ដើម 0.77 / 0.5 / 0.99 វិ · ស្ងាត់ចុង **5.11 / 0.45 / 3.37 វិនាទី** (ទោះស្នើ 28 វិនាទីដូចគ្នា) → **លទ្ធផលប្រែប្រួលតាម seed**៖ ម៉ូដែលមិនតែងបំពេញរយៈពេលដែលស្នើទេ (កម្មវិធីព្រមាន និងកាត់ MV ឱ្យស្វ័យប្រវត្តិ) |
| spectrogram | ✅ មានរចនាសម្ព័ន្ធតន្ត្រី/ឃ្លាច្បាស់ លើសពីសំឡេងរំខាន (`docs/sample_output/real_chorus_spectrogram.png`) |

**ការកែតម្រូវដែលត្រូវធ្វើតែលើ CPU 15 GB RAM** (មិនពាក់ព័ន្ធ GPU)៖ ត្រូវកំណត់ `ACESTEP_VAE_DECODE_CHUNK_SIZE=32`
បើមិនដូច្នោះទេ server ត្រូវបាន OOM-kill ពេល decode VAE លើ CPU ហើយ RAM ប្រើ ~13 GB។

**អ្វីដែលខ្ញុំមិនអាចផ្ទៀងផ្ទាត់ (❓)៖**
- ថាតើសំឡេងច្រៀង **ច្រៀងពាក្យខ្មែរត្រូវនឹងទំនុកដែរឬទេ** — ខ្ញុំមិនអាចស្ដាប់បាន។
- ប្រតិបត្តិការលើ GPU (CUDA), `vllm` backend, LM planner (`thinking`) — មិនបានរត់។
- ការពិនិត្យដោយ ASR៖ ខ្ញុំសាកល្បង Whisper (small, large-v3) លើបទពិត ហើយសាកល្បង **ការត្រួតពិនិត្យ** ដោយឱ្យវាស្ដាប់សំឡេងនិយាយខ្មែរស្អាត
  (MMS-TTS ខ្មែរ) នៃទំនុកដដែល។ លទ្ធផល៖ បទ → ខុស 86% និង 130% (ពីរបទ) · សំឡេងនិយាយស្អាត → **ក៏ខុស 80%** ដែរ។ ដូច្នេះ **ASR មិនអាចប្រើជាភស្តុតាងសម្រាប់ភាសាខ្មែរបានទេ**
  (មើល `docs/TEST_REPORT.md`)។

---

## ៣. អាជ្ញាបណ្ណ និងលក្ខខណ្ឌសម្រាប់ការចេញផ្សាយបទ (📄)

**អ្វីដែលឯកសារផ្លូវការចែង** (ដកស្រង់ពី model card `ACE-Step/Ace-Step1.5` និង README)៖

> *License: MIT* — "This project is licensed under MIT" (README)
>
> *Commercial-Ready:* "Unlike many models trained on ambiguous datasets, ACE-Step v1.5 is designed for creators. You can strictly use the generated music for **commercial purposes**." (model card)
>
> *Safe & Robust Training Data:* "The model is trained on a massive, legally compliant dataset consisting of: Licensed Data … Royalty-Free / No-Copyright Data … Synthetic Data" (model card)
>
> *Disclaimer:* "…we encourage users to verify the originality of generated works, clearly disclose AI involvement, and obtain appropriate permissions when adapting protected styles or materials." (README)

**អត្ថន័យជាភាសាខ្មែរ៖** អ្នកអាចចេញផ្សាយបទដែលបង្កើតដោយម៉ូដែលនេះ (រួមទាំងពាណិជ្ជកម្ម) តាមអ្វីដែលអ្នកនិពន្ធម៉ូដែលចែង។

**ប៉ុន្តែសូមកត់សម្គាល់៖**
1. ទាំងនេះជា **ការអះអាងរបស់អ្នកនិពន្ធម៉ូដែល** — ខ្ញុំមិនបានត្រួតពិនិត្យទិន្នន័យបង្ហាត់របស់គេទេ។
2. អ្នកនិពន្ធណែនាំឱ្យ ពិនិត្យថាបទមិនស្រដៀងបទដែលមានស្រាប់ · ប្រាប់សាធារណៈថាប្រើ AI · សុំការអនុញ្ញាតបើយកស្ទីលរបស់អ្នកដទៃ។
3. **YouTube / Facebook / TikTok មានច្បាប់ផ្ទាល់ខ្លួន** អំពីខ្លឹមសារ AI និងកម្មសិទ្ធិបញ្ញា (ឧ. ស្លាក «ខ្លឹមសារ AI», Content ID) — ពិនិត្យលក្ខខណ្ឌបច្ចុប្បន្នរបស់ពួកគេ។
4. សមាសភាគក្នុងកញ្ចប់៖ `Qwen3-Embedding-0.6B` និង `Qwen3-1.7B` (ជាមូលដ្ឋាននៃ LM) មានអាជ្ញាបណ្ណ **Apache-2.0** តាម Hugging Face API (✅ ខ្ញុំបានពិនិត្យ);
   repo `acestep-v15-turbo` / `acestep-5Hz-lm-1.7B` មិនបានបញ្ជាក់អាជ្ញាបណ្ណក្នុង metadata របស់ Hugging Face (ឯកសារមេ `Ace-Step1.5` ចែង MIT)។
5. អ្នកនិពន្ធទំនុក (អ្នក) នៅតែមានកាតព្វកិច្ចចំពោះទំនុកខ្លួនឯង — ទំនុកគំរូ ៤ បន្ទាត់ក្នុង repo នេះត្រូវបានព្រាងដោយ AI ហើយ **ត្រូវឱ្យអ្នកចេះភាសាខ្មែរពិនិត្យ**។

---

## ៤. ភាសាខ្មែរ — មានឯកសារគាំទ្រ ឬត្រូវសាកល្បងបន្ថែម?

### សេចក្ដីសន្និដ្ឋាន៖ ❓ **ឯកសារមិនបញ្ជាក់ — ត្រូវសាកល្បងបន្ថែម**

| ភស្តុតាង | លទ្ធផល |
|---|---|
| README + model card | អះអាង «Multi-Language Lyrics — Supports **50+ languages**» ប៉ុន្តែ **មិនរាយឈ្មោះភាសា** ហើយមិនលើកឡើង Khmer ទាល់តែសោះ (📄 ស្វែងរក `khmer`/`km` ក្នុងឯកសារ docs/en ទាំងអស់ → គ្មាន) |
| កូដ `acestep/constants.py` → `VALID_LANGUAGES` | មាន **៥០ កូដ** (`ar az bg bn ca cs da de el en es fa fi fr he hi hr ht hu id is it ja ko la lt ms ne nl no pa pl pt ro ru sa sk sr sv sw ta te th tl tr uk ur vi yue zh` + `unknown`) — **គ្មាន `km`** (📄 មាន ថៃ `th` វៀតណាម `vi` ឥណ្ឌូនេស៊ី `id` ម៉ាឡេ `ms` តាហ្គាឡុក `tl` តែគ្មានខ្មែរ/ឡាវ/មីយ៉ាន់ម៉ា) |
| `acestep/genres_vocab.txt` (បញ្ជីពាក្យគន្លឹះស្ទីលដែល LM ស្គាល់) | មាន **«Khmer pop», «Khmer rock», «Khmer rap», «Khmer hip-hop», «Khmer folk», «Khmer trap», «traditional Khmer folk»** (46 បន្ទាត់) — បញ្ជាក់ថា **ស្ទីល** ខ្មែរមានក្នុងទិន្នន័យ caption ប៉ុន្តែ **មិនមែនភស្តុតាងថាច្រៀងទំនុកខ្មែរបានច្បាស់ទេ** |
| ការរត់ពិត (✅) | ម៉ូដែលទទួលអក្សរខ្មែរ (Unicode) ហើយបង្កើតសំឡេងមានរចនាសម្ព័ន្ធតន្ត្រី — **តែខ្ញុំមិនអាចស្ដាប់ថាពាក្យត្រឹមត្រូវ** |

**វិធីដែល studio ដោះស្រាយ (មិនបំពានភាពពិត)៖**
- `vocal_language` លំនាំដើម = `unknown` (ឱ្យម៉ូដែលជ្រើសរើស) · អាចសាកល្បង `km` ដែលមិនមានក្នុងបញ្ជីផ្លូវការ (UI ព្រមានច្បាស់)។
- ប៊ូតុង **«សាកល្បង Chorus ខ្លី»** — ស្ដាប់ការបញ្ចេញពាក្យមុនចំណាយពេលបង្កើតបទពេញ។
- **ផែនការបម្រុង ក)** លាយ «ភ្លេងសុទ្ធ» ដែលម៉ូដែលបង្កើត ជាមួយ **សំឡេងច្រៀងផ្ទាល់ខ្លួន** (ថត/upload) — កែកម្រិតសំឡេងទាំងពីរ (មានក្នុង studio)។
- **ផែនការបម្រុង ខ)** ម៉ូដែលទីពីរ HeartMuLa (អះអាងគាំទ្រស្ទើរគ្រប់ភាសា) — មាន adapter តែ **ខ្ញុំមិនទាន់បានរត់** (ផ្នែក ៦)។

---

## ៥. ការកំណត់ណាម៉ូដែលគាំទ្រផ្ទាល់ ទល់នឹងការពិពណ៌នាសំឡេង

studio បង្ហាញពីរក្រុមនេះដាច់ពីគ្នាក្នុងផ្ទាំង «តន្ត្រី» (ស្លាកពណ៌បៃតង/លឿង)។

### 🟢 ប៉ារ៉ាម៉ែត្រដែលម៉ូដែលគាំទ្រផ្ទាល់ (ផ្ញើជាតម្លៃ មិនមែនអត្ថបទ)

| ការកំណត់ | ប៉ារ៉ាម៉ែត្រ ACE-Step | ដែនតម្លៃ (📄 តាម docs/INFERENCE.md, API.md) |
|---|---|---|
| រយៈពេល | `audio_duration` | 10–600 វិនាទី |
| ល្បឿន | `bpm` | 30–300 |
| សំឡេងគន្លឹះ | `key_scale` | ឧ. `C major`, `A minor`, `F# minor` |
| ចង្វាក់ក្នុងរង្វាស់ | `time_signature` | 2, 3, 4, 6 |
| ភាសាសំឡេងច្រៀង | `vocal_language` | កូដ ISO ក្នុង `VALID_LANGUAGES` ឬ `unknown` (**ខ្មែរ `km` មិនមាន**) |
| ភ្លេងសុទ្ធ | `lyrics = "[Instrumental]"` | — |
| Seed | `seed` + `use_random_seed` | — |
| ចំនួន step | `inference_steps` | turbo ១–២០ (ណែនាំ ៨) |
| Guidance | `guidance_scale` | **មានតែម៉ូដែល base/sft** — turbo មិនប្រើ (server កែជា 1.0) |
| LM planner | `thinking` | ត្រូវបើកតែបាន ប្រសិនបើ server ផ្ទុក LM (GPU មាន VRAM គ្រប់គ្រាន់) |

ស្លាកក្នុងទំនុក `[Verse 1]`, `[Chorus]`, `[Bridge]` ជា **វាក្យសម្ព័ន្ធដែលម៉ូដែលត្រូវបានបង្ហាត់** (📄 Tutorial) — ឥទ្ធិពលជាការរៀនសូត្រ មិនមែនការធានាទេ។

### 🟠 ការពិពណ៌នាសំឡេងដែលចង់បាន (អត្ថបទក្នុង `prompt`/caption ≤ 512 តួអក្សរ — ម៉ូដែលអាចមិនធ្វើតាម)

| ជម្រើសក្នុង UI | អ្វីដែលយើងបន្ថែមក្នុង caption |
|---|---|
| ស្ទីល៖ កន្ទ្រឹម | `Khmer folk, traditional Khmer folk, lively dance rhythm, hand percussion, Southeast Asian, festive` |
| ស្ទីល៖ បាឡាដ | `Khmer pop ballad, slow tempo, emotional, tender, soft piano and acoustic guitar` |
| ស្ទីល៖ រ៉េប | `Khmer rap, Khmer hip-hop, rhythmic rap flow, trap beat, deep bass` |
| ស្ទីល៖ រ៉ុក | `Khmer rock, electric guitar, driving drums, energetic, powerful vocal` |
| ឧបករណ៍៖ ខ្លុយ | `bamboo flute (khloy), flute` |
| ឧបករណ៍៖ ទ្រសោ | `tro sau Khmer two-string fiddle, erhu` |
| ឧបករណ៍៖ ហ្គីតា | `acoustic guitar` |
| អារម្មណ៍ / សំឡេង | `sad, melancholic` · `female vocal` … |

**ហេតុអ្វីចាត់ទុកជា «ពិពណ៌នា» មិនមែន «ការបញ្ជា»?** ខ្ញុំបានពិនិត្យវាក្យសព្ទស្ទីលរបស់ម៉ូដែល (`genres_vocab.txt`)៖

| ពាក្យ | ចំនួនបន្ទាត់ក្នុងវាក្យសព្ទ |
|---|---|
| `kantrum`, `khloy`, `tro sau`, `roneat`, `chapei`, `skor`, `pinpeat`, `ramvong` | **0** — ម៉ូដែលមិនស្គាល់ជាឈ្មោះពិសេសទេ |
| `Khmer pop/rock/rap/folk` | មាន ✓ |
| `flute` 150 · `erhu` 24 · `marimba` 10 · `percussion` 207 · `Southeast Asian` 376 · `traditional` 1353 | មាន ✓ (ពាក្យជិតស្និទ្ធដែលយើងប្រើជំនួស) |

ដូច្នេះ «ខ្លុយ» ក្លាយជា `bamboo flute (khloy), flute` — ម៉ូដែលអាចដាក់ខ្លុយអឺរ៉ុប ឬមិនដាក់សោះ។ **នេះជាអ្វីដែលអ្នកត្រូវស្ដាប់ និងសាកល្បងផ្ទាល់។**

---

## ៦. ម៉ូដែលផ្សេងដែលបានពិនិត្យ

| ម៉ូដែល | អាជ្ញាបណ្ណ (📄) | តម្រូវការ | ភាសា | ស្ថានភាពក្នុង studio |
|---|---|---|---|---|
| **HeartMuLa-oss-3B** <https://github.com/HeartMuLa/heartlib> | **Apache-2.0** (README៖ «update the license of this repo and all related model weights to Apache 2.0»; HF API ✅ apache-2.0) | Python 3.10; ល្បឿន RTF≈1.0 (README); **VRAM មិនបានបញ្ជាក់ក្នុង README**; មាន `--lazy_load` | README៖ «multilingual support covering **almost all languages**» — មិនរាយ, មិនបញ្ជាក់ខ្មែរ → ❓ | មាន **adapter ពិសោធន៍** (`HEARTMULA_DIR=…`) — ❓ **មិនទាន់បានរត់** (command line ត្រូវបានផ្ទៀងផ្ទាត់នឹង `examples/run_music_generation.py` ផ្លូវការប៉ុណ្ណោះ); គ្មាន BPM/Key/Seed; គ្មានភ្លេងសុទ្ធ; គ្មាន REST |
| **YuE2** <https://github.com/multimodal-art-projection/YuE> (កញ្ញា ២០២៦) | កូដ Apache-2.0; **ទម្ងន់៖ CC BY-NC 4.0 + «additional creator permission»** — «Personal users, content creators, musicians: free to use and monetize outputs»; «Commercial use by companies: contact us» | «**NVIDIA GPU with BF16 support and 24 GB VRAM**» | មិនរកឃើញការបញ្ជាក់ខ្មែរក្នុងផ្នែកដែលបានអាន | ❌ មិនបានជ្រើស — VRAM ខ្ពស់ + លក្ខខណ្ឌអាជ្ញាបណ្ណស្មុគស្មាញ (សូមអានអាជ្ញាបណ្ណពេញ `MODEL_LICENSE` ដោយខ្លួនឯង) |
| **VoxCPM2** (ម៉ូដែលក្នុង repo នេះ) <https://huggingface.co/openbmb/VoxCPM2> | Apache-2.0 (✅ HF API) | 2B params | README៖ **គាំទ្រ ៣០ ភាសា រួមទាំងខ្មែរ** (CER ខ្មែរ 2.05% ក្នុង benchmark ផ្ទៃក្នុងរបស់ពួកគេ) | ជា **TTS (និយាយ)** មិនមែនម៉ូដែលចម្រៀង/តន្ត្រីទេ → មិនបានភ្ជាប់; អាចជាការពង្រីកអនាគត (សំឡេងនិយាយនាំមុខ/រ៉េប) |
| DiffRhythm, SongGeneration (Tencent) ជាដើម | HF API៖ DiffRhythm-base = Apache-2.0 | — | — | ❓ **មិនបានវាយតម្លៃ** (ខ្ញុំមិនអាចអាន README ពួកគេបានក្នុងបរិស្ថានខ្ញុំ) |

ការគ្រោងម៉ូដែលអត្ថបទ (ជំនួយទំនុក)៖ ណាមួយដែលនិយាយ OpenAI-compatible API (Ollama, llama.cpp, LM Studio) — ឧ. `qwen3:8b`។
គុណភាពភាសាខ្មែរ **ត្រូវសាកល្បង** (ខ្ញុំមិនបានរត់ម៉ូដែលអត្ថបទពិតទេ — សាកល្បងតែជាមួយ server ក្លែងក្លាយ)។

---

## ៧. របៀបសាកល្បងម៉ូដែលលើម៉ាស៊ីនរបស់អ្នក

```bash
# terminal ទី ១ — server ម៉ូដែល (ក្នុងថត ACE-Step-1.5 — ដំណើរការជាប់ជានិច្ច ទុកបើក)
uv run acestep-api

# terminal ទី ២ — កូដ studio (បើមិនទាន់មាន) ហើយសាកល្បង Chorus ខ្មែរ ៤ បន្ទាត់ តាម adapter ពិត
git clone --branch claude/khmer-ai-music-studio-rtm3me https://github.com/crlovek-maker/VoxCPM.git
cd VoxCPM/khmer-ai-music-studio
python scripts/check_engine.py --duration 30
#   → data/check_engine/<ពេល>/chorus.wav  (ស្ដាប់ជាមួយទំនុកដែលបោះពុម្ពនៅលើអេក្រង់)
```

## ប្រភព

- ACE-Step 1.5 README (GitHub) · model card (Hugging Face `ACE-Step/Ace-Step1.5`, `license: mit`) · `docs/en/{API,INFERENCE,INSTALL,GPU_COMPATIBILITY,Tutorial}.md`
  · `acestep/constants.py` · `acestep/genres_vocab.txt` · `acestep/api/**` (ទាំងអស់អាននៅ commit `ca1e85f`, ២០២៦-០៨-២៩)
- របាយការណ៍បច្ចេកទេស៖ <https://arxiv.org/abs/2602.00744> (តភ្ជាប់ពី README — **ខ្ញុំមិនអាចបើកវាក្នុងបរិស្ថានខ្ញុំបានទេ** ដូច្នេះមិនដកស្រង់ពីវា)
- HeartMuLa README + `examples/run_music_generation.py` · YuE README (ផ្នែក License) · VoxCPM2 README (ក្នុង repo នេះ)
