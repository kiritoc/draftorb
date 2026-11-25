# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/GLOSSARY.md`**: the domain glossary — the vocabulary of record for this project.
- **`docs/DECISIONS.md`**: the ADR log (flat file, `D-xxx` entries, PROPOSED/ACCEPTED/SUPERSEDED). Read entries touching the area you're about to work in.
- **`docs/DECISIONS_AMENDMENTS.md`**: amendments to earlier decisions; check alongside `DECISIONS.md`.
- **`CONTEXT.md`** at the repo root and **`docs/adr/`**: do not exist; this repo keeps its domain docs in `docs/GLOSSARY.md` + `docs/DECISIONS.md` instead.

If none of these files exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill creates domain docs lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `docs/GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts an entry in `docs/DECISIONS.md`, surface it explicitly rather than silently overriding:

> _Contradicts D-0xx (...), but worth reopening because…_
