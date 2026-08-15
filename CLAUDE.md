# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**theDAW — the Operating Table.** A fork of gantasmo/theDAW (itself a fork of
Stability AI's stable-audio-3 repo), stripped to one job: a timeline you lay
audio out on, where AI tools sit alongside ordinary editing as peers, and where
pointing a tool at a *region* of a clip and having it repainted — with the
audio outside the region untouched and the seam inaudible — is the central
gesture. Region repaint is backed by Stable Audio 3 audio inpainting with
composite-and-feather applied server-side (`backend/lib/inpaint_composite.py`).

Deliberately **not** a studio: the DJ / VJ / XR / plugin-foundry / notation /
distribution surfaces of upstream were removed on the `operating-table` branch.
`main` tracks upstream `gantasmo/theDAW` as a clean mirror. Do not reintroduce
live-performance features; the sibling "Modular Glitch Lab" project owns those.

The five workspaces: **MAKE** (generation), **EDIT** (the timeline — the
operating table), **MIX** (effect chain + mastering), **UNDERFIT** (LoRA
training), **LEARN** (library lineage graph). The library bin (side panel) is
the accumulation surface: SQLite entries + analysis + stems + MIDI + lineage.

### Architecture in one paragraph

The live audio engine is **browser Web Audio** (`frontend/src/state/liveMixer.ts`)
— nothing outside the browser can be in the live signal path; offline render
and track freeze is the sanctioned answer for server-side processing. The
backend is FastAPI on **:8600** (`backend/server.py`) with a plugin module
system (`backend/modules/loader.py` discovers `modules/*/module.json`; a module
that fails to import is logged and skipped). The generation model is Stable
Audio 3 loaded in-process from `stable_audio_3/` — the live serving class is
`StableAudioModel` in `stable_audio_3/model.py`. The frontend is React + Vite;
when `frontend/dist` exists the backend serves it at `/`, so one process on
:8600 is the whole app.

### The inpaint path (the core of this fork)

- Frontend region select: `InpaintSelection` in `frontend/src/state/editorStore.ts`;
  submit crops the clip and posts to `/api/generate-jobs` (`WaveformEditor.tsx`).
- Backend: `/api/generate-jobs` → `_generate_to_bytes` in `backend/server.py` —
  the single choke point for all generation. Inpaint requests composite the
  model output back into the original audio with an equal-power feather
  (`backend/lib/inpaint_composite.py`) and return float32 WAV.
- Everything outside the selected region must stay **bit-identical** to the
  input. `tests/test_inpaint_composite.py` asserts this; do not weaken it.

## 🚨 HARD RULES — read before touching anything 🚨

These are non-negotiable. Violating them has burned the user before.

### 1. NEVER downgrade external models, APIs, libraries, or capabilities
Your training cutoff is older than the user's reality. If a model name, API
endpoint, library version, or product feature looks unfamiliar or "doesn't
exist," **assume YOUR knowledge is stale, not theirs**.

Concrete rules:
- **Do NOT remove model entries** from catalogs (e.g. the caps maps in
  `backend/assistant_routes.py`) because you don't recognize them.
- **Do NOT pin libraries down** to versions you "know" exist when a newer one
  is in the lockfile.
- **Do NOT replace a "preview" / "experimental" / "-latest" model id** with a
  stable one you remember from training.
- **If you genuinely need to update a model list**, fetch the source of truth
  FIRST — never write from memory. If you're proposing a downgrade, ASK first.

### 2. NEVER allow ruff version drift
Exactly ONE ruff version exists in this repo's tooling chain at all times.
It's pinned in `pyproject.toml` (`dependency-groups.dev`) AND
`.github/workflows/lint.yml` (the `RUFF_VERSION` env var) AND used via
`uv run ruff …` so the project venv's ruff is what runs.

Concrete rules:
- **Never `pip install ruff` or `pipx install ruff`** globally without matching
  the pinned version exactly.
- **Never edit only one of the two pin sites** — always update both in the
  same commit, then run `uv sync --group dev` + `uv run ruff format .` in that
  same commit.
- **Before committing**, run `uv run ruff check .` AND
  `uv run ruff format --check .` from the repo root. Both must pass.
- **If `ruff format` drifts** with no semantic edits in between, the FIRST
  suspect is a version mismatch — investigate before you "fix" the drift.

### 3. Form controls MUST have real labels and valid ARIA
Every form/control change must include an accessibility check before it is
considered done.

Concrete rules:
- Native fields (`input`, `select`, `textarea`) must have stable `id` and
  `name` values, plus either `<label htmlFor="that-id">` or a valid wrapping
  `<label>`.
- Custom controls (`div role="slider"`, button-based selects/dropdowns,
  canvas/WebGL pickers, etc.) must **not** be wrapped in `<label>`; use
  `aria-label` or `aria-labelledby`, and expose state/relationship where
  applicable (`aria-expanded`, `aria-haspopup`, `aria-controls`,
  `role="listbox"` / `role="option"`).
- Never silence accessibility warnings; fix the DOM relationship instead.

## Commands

```bash
# Install dependencies
uv sync --group dev

# Launch the two dev servers
uv run uvicorn backend.server:app --host 0.0.0.0 --port 8600 --reload   # backend  -> :8600
cd frontend && npm run dev                                              # frontend -> :5173

# Production shape: build once, serve everything from :8600
cd frontend && npm run build      # backend mounts frontend/dist at / when present

# Run tests (model-dependent tests skip without weights/GPU)
uv run pytest

# Type-check the frontend
cd frontend && npx tsc --noEmit

# Lint (runs on CI for PRs; tests run on CI too — .github/workflows/test.yml)
uv run ruff check .
uv run ruff format --check .
```

## Stable Audio 3 internals (`stable_audio_3/`)

- `model.py` — **the live serving file**: `StableAudioModel.from_pretrained` /
  `.generate()`. The backend loads it at `backend/server.py`
  (`_get_or_load_generation_pipeline`). There is no `pipeline.py` — it was a
  dead line-shifted twin and was deleted; do not resurrect it or patch against
  upstream's copy.
- `model_configs.py` — maps model names ("small", "medium", "medium-rf") to
  HuggingFace repo IDs and checkpoint filenames.
- `inference/sampling.py` — samplers (Euler, RK4, DPM++, Ping-Pong);
  `sample_diffusion()` is the unified entry point. Contains no inpaint logic.
- `models/conditioners.py` — T5Gemma text conditioning (the encoder ships
  inside the SA3 HF repo as a subfolder; nothing fetches `google/t5gemma`).
- `models/lora/` — LoRA loading/stacking (the UNDERFIT trainer's runtime half).
- Two-stage pipeline: the SAME autoencoder compresses 44.1kHz stereo to
  256-dim latents at **4096x downsampling** (≈93 ms per latent frame at
  44.1 kHz — this is why the inpaint feather default is 0.10 s), and a DiT
  generates those latents from text + duration + optional inpaint conditioning.
- ARC checkpoints (`small`, `medium`) are the 8-step post-trained primaries
  (`cfg_scale=1`); RF checkpoints are the LoRA-training bases (`cfg_scale=7`).
- Weights are gated on HuggingFace: `medium` requires an accepted licence +
  token (env `HF_TOKEN` wins over the stored token file — see
  `backend/modules/hfauth/`). Never commit a token into this repo.

## Ruff Configuration

Ruff excludes `stable_audio_3/{models,inference,interface,data,training}`,
`sidecars/magenta-rt2-nvidia`, `underfit`, and `integration-package` (vendored
code keeps its own style). **Always run from the repo root, never on a subset
of dirs** — CI runs at the root, so a partial run silently misses drift.

## Testing

Tests run on every PR (`.github/workflows/test.yml`). Model-dependent tests
use session-scoped fixtures and auto-skip without weights/GPU;
`tests/test_inpaint_composite.py` is pure numpy and must always pass. The
bit-identity assertion (outside the repainted region, output == input exactly)
is the contract of this fork — treat a change that breaks it as a defect, not
a tolerance to loosen.

## Tailwind CSS v4 — Mandatory Class Forms

This project uses **Tailwind CSS v4**. The following v3 forms are forbidden.

| FORBIDDEN (v3) | REQUIRED (v4) |
|---|---|
| `!className` (prefix important) | `className!` (suffix important) |
| `flex-shrink-0` | `shrink-0` |
| `flex-grow` | `grow` |
| `bg-gradient-to-*` | `bg-linear-to-*` |
| `bg-opacity-*` | `bg-black/50` style opacity modifier |
| `w-[300px]` when scale token exists | `w-75` (300 ÷ 4) |
| `h-[14px]` when scale token exists | `h-3.5` (14 ÷ 4) |
| `z-[15]`, `z-[25]`, `z-[200]` | `z-15`, `z-25`, `z-200` |
| `min-w-[160px]` when scale token exists | `min-w-40` |
| `min-h-[80px]` when scale token exists | `min-h-20` |
| `bg-white/[0.03]`, `bg-purple-500/[0.04]` | `bg-white/3`, `bg-purple-500/4` |

**Scale token rule:** the v4 spacing scale is `value ÷ 4`. Prefer scale tokens
over arbitrary values at all times.

## RAG Index Maintenance

The in-app assistant answers from a RAG index built over the docs listed in
`backend/rag.py` (`DOC_PATHS`). After any major update, write/revise the
relevant doc AND register it in `DOC_PATHS` if new. Confirm every `DOC_PATHS`
entry resolves (no missing-doc warnings on startup). All doc/RAG changes are
approval-based — propose, don't auto-edit or auto-delete.
