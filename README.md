# Kindling

> **Split heavy, overwhelming mental loads into calm, backwards-scheduled daily sparks.**

**Kindling** is an AI executive-function planner and workload decomposer built with **React + Vite**, **Node.js + Express**, **SQLite (`sql.js`)**, and the **Google Gemini API (with Google Search grounding)**.

Instead of giving you another blank, guilt-inducing to-do list—or acting like an affiliate shopping bot—Kindling takes messy brain-dumps (*registering a child for a class, preparing for a family trip, handling medical/admin backlogs*), asks **1–3 calm clarifying questions**, verifies real-world deadlines and promotional windows online, and works **backward** from hard cutoffs into realistic 10–25 minute steps.

---

## Core Capabilities

- **Voice & Freeform Brain-Dump + Guided Question Cards:** Speak or type messy thoughts, then tap quick-choice chips (or skip straight to smart defaults whenever you're tired).
- **Universal Real-World Timing Verification (Gemini + Google Search):**
  - **Registrations & Deadlines:** Checks program/school registration opening windows, resident early-bird cutoffs, and hidden prerequisites (portal accounts, waivers, forms), pinning exact opening times (e.g., `08:00 AM`) when spots fill fast.
  - **Trip & Event Prep:** Aligns category-level shopping blocks with store promotional windows while subtracting carrier shipping transit + try-on/packing buffers—and offering a 1-click **In-Store Pickup** pivot when a late sale overlaps shipping safety margins.
  - **Admin, Calls & Projects:** Places phone calls and office errands strictly inside **Daytime Business Slots** (`Mon–Fri`) and models real waiting gaps between dependent steps.
- **Three-Layer "Zero Product Recommendation" Guardrail:** Enforced across system prompts, Zod schemas, and server sanitizers—Kindling plans *when* and *how* to tackle your tasks, never pushing product names, SKUs, prices, or shopping URLs.
- **Transparent Preference Memory Vault:** Remembers reusable context (household details, local rec providers, go-to stores, pre-trip buffers) with an **Applied Defaults** pill bar that supports temporary per-project overrides.
- **Global Daily Capacity & Smart Auto-Rebalance:** Caps daily focus minutes across *all* projects and 1-line quick tasks; missed steps gently slide into your next open window (warning only if a real cutoff gets tight).
- **Distraction-Free Focus Mode:** Single-task countdown timer, 1-click **Break into 5-min steps** splitter, and a **Follow-Up Jot** box that auto-schedules leftover items.
- **Calendar & PDF Export:** 1-click **Google Calendar** links, standards-compliant **`.ics`** files (Apple Calendar, Outlook, Google Calendar), and clean printable **PDF** gameplans.

---

## Quickstart

### 1. Install Dependencies
```bash
npm run install:all
```

### 2. Configure Your Gemini API Key
Copy `.env.example` to `.env` and add your key (or paste it directly inside the app's **Settings** modal):
```bash
cp .env.example .env
# Edit .env -> GEMINI_API_KEY=your_key_here
```

### 3. Start Kindling
```bash
npm run dev
```
Open **http://localhost:5173** (Vite frontend on `:5173`, Express + SQLite API on `:3001`).

---

## Bonus: Gemini Managed Agent Remote Sandbox Demo
[`inspect_budoux_pr.mjs`](./inspect_budoux_pr.mjs) demonstrates spinning up a **Gemini Managed Agent** (`antigravity-preview-09-2026` on `gemini-4-carbon`) inside an isolated `remote` Linux sandbox via the `@google/genai` Interactions API, streaming live reasoning and bash execution steps to the terminal while inspecting the latest open PR on `google/budoux`:

```bash
node inspect_budoux_pr.mjs
```
