# DECISIONS (ADR log)
Status: PROPOSED (made by AI, awaiting owner) / ACCEPTED / SUPERSEDED. Newest at bottom.

### D-001 — TypeScript everywhere — ACCEPTED
Single language for ETL, engine, web, desktop, vision (opencv.js/tesseract.js/onnxruntime). Best fit for vibe coding and Windows setup (Node only). Java rejected despite owner expertise (would need 2 languages).

### D-002 — Static site + precomputed JSON, no backend — ACCEPTED
Free hosting, no maintenance. Engine runs client-side.

### D-003 — SQLite for ETL — ACCEPTED
No server to install. `better-sqlite3`.

### D-004 — Two rank logics — ACCEPTED
Draft probabilities from games near user's rank; runes/items from user's rank and above (experts), with experience filters. See SPECS §3.

### D-005 — Phase 1 scope = Support/Diamond/one region — ACCEPTED

### D-006 — No paid services, no runtime LLM — ACCEPTED
Scoring is deterministic stats + manual tags.

### D-007 — Auto-detection order: LCU/Live Client API, then vision — ACCEPTED
Vision is a fallback. Policy check required before shipping.

### D-008 — Rank at collection time approximates rank at game time — PROPOSED
Documented limitation.

### D-009 — English only in the repo — ACCEPTED
Code, docs, commits, tickets, bugs, logs and UI text are English. Chat language with AI assistants is free; anything written to files is English.

### Template
```
### D-xxx — Title — STATUS
Context / Decision / Alternatives / Consequences
```
