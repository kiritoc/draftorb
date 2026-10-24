# TESTING

## Layers

1. **Unit** (vitest): rank weighting, shrinkage, level mapping, role inference, threat score.
2. **Golden scenarios** (engine): fixed input data + draft -> expected ordering/reasons. Stored in `packages/engine/test/golden/*.json`.
3. **ETL**: fixtures of real Riot JSON (`packages/etl/test/fixtures`), mocked HTTP for the client.
4. **Web**: smoke tests (render, select champions, see recommendations).
5. **Vision (E7)**: evaluation harness on a screenshot dataset (accuracy per resolution/UI scale/language).

## Golden scenario ideas (engine)

- Blind pick, nothing known -> safe supports first.
- Only ally ADC known -> synergy dominates.
- Enemy support hard-counters candidate X -> X penalized with reason.
- Roles unknown for all champions -> inference gives sensible assignment, lower confidence reduces weights.
- Flex champion (e.g. plays mid/support) in enemy team -> confidence split.
- Low data pair -> `lowData` flag, delta 0.
- Pool filter -> only pool champions.
- Rank switch Emerald vs Diamond changes ordering only through data weights.
- Same input twice -> identical output (determinism).

## Property checks

- Score never NaN; recommendations sorted desc; reasons reference only known slots; no crash with empty input.

## Rules

- Every bug fix adds a regression test.
- Never loosen a golden test to make it pass without a DECISIONS.md entry.
