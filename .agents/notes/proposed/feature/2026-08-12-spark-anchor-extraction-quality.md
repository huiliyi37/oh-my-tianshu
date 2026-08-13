# Agent Note: spark anchor extraction quality — measured defects and open questions

Status: proposed

English | [中文](2026-08-12-spark-anchor-extraction-quality.zh.md)

## Problem

The spark reasoning truncation (`truncateReasoningTail`) in `dsh-llm-deepseek` and the anchor compensation (`extractExcludedClaims`) in `dsh-spark-anchors` are a paired design: truncation drops the reasoning head, anchors extract "paths already ruled out" from that head and re-inject them to stop the model re-deriving excluded paths. **Anchor extraction quality is the current weak spot** — pure-function measurement (data below) found three defect classes: over-extraction, truncated fragments, and leading-boundary noise. The EN exclusion regex crossing CJK sentence boundaries is fixed (commit `339fbba`); anchors still carry leading boundary-char noise, fragments get cut mid-sentence, duplicate sentences in the same reasoning are not internally deduplicated, and the false-positive rate has no quantified corpus evaluation.

## Proposal

Handle the three quality classes by impact: ① sentence-boundary over-extraction (fixed); ② leading noise and truncated fragments (candidate fixes: strip leading `[.;。！？\s]+` after extraction, extend to full sentence boundaries); ③ quantify the false-positive rate and wording-level false positives (needs a representative corpus before deciding whether to upgrade the extraction strategy). This note records the problem and measured data for later analysis.

## Acceptance criteria

- [ ] Anchor extraction does not cross sentence boundaries on mixed-language reasoning text (partly done: `339fbba`)
- [ ] Anchors are self-contained (no leading boundary-char noise, not cut mid-sentence)
- [ ] False-positive rate (non-excluded analysis treated as excluded) is quantifiable on a representative corpus
- [ ] Impact of anchor quality on model behavior (preventing re-derivation vs misleading) has an analysis conclusion

## Risks

- False positives re-inject "non-excluded analysis" as "ruled-out paths" — the model skips valid paths; worse than missed extraction (the implementation comment says "rather miss than over-extract")
- Anchor injection widens the prefix-cache perturbation surface: injected text changes with the anchor set (mitigated by the enabled same-source gate and the lastInjectedText skip)

---

## Measured data (2026-08-12, pure-function probe, not a real model)

**Input**: typical mixed-language tool-turn reasoning (Chinese analysis + English exclusion sentences, repeat ×3), 1158 tokens (fallback tokenizer).

| Metric | Measured |
|---|---|
| Original | 2334 chars / 1158 tokens |
| After truncation (flash N=300) | 576 chars / 300 tokens |
| Saved | 1758 chars / **858 tokens (74.1%)** |
| Complementarity (lost ∪ kept tail = original) | true ✓ |
| Anchors all inside the lost domain | true ✓ |
| Anchor count | 9 |

**Anchor samples** (before fix):
- `"的方案被排除了"` — truncated fragment (should be "尝试用 mock provider 的方案被排除了"), repeated ×3
- `".\n再检查一下 session 的事件流，确认 token 刷新发生在正确的时机。\nThe token refresh "` — **over-extraction**: EN regex `[^.;]` lacks the CJK full stop「。」, swallowed the preceding Chinese analysis as a ruled-out path
- `".\nThe mock provider approach is not feasible because it bypa…"` — leading boundary-char noise (`"。"` / `".\n"`)

**Minimal reproduction** (fixed):
```
输入: '再检查一下 session 的事件流，确认 token 刷新发生在正确的时机。\nThe token refresh is not the root cause — the test asserts early.'
修复前: ["再检查一下 session 的事件流，确认 token 刷新发生在正确的时机。\nThe token refresh is not the root cause — the test asserts early"]
修复后: ["。\nThe token refresh is not the root cause — the test asserts early"]
```

**Fix** (`339fbba`): EN char class `[^.;]` → `[^.;。！？]` + boundary `[.;。！？]`. Regression test: mixed-language input yields only the English exclusion sentence, not the preceding Chinese text. spark.spec 26 tests green; llm-deepseek + spark-anchors 210 tests green; tsc exit 0.

## Open questions

1. **Leading boundary-char noise**: fixed anchors still carry `"。\n"` prefixes (the regex boundary char is part of match[0]) — `trim()` cannot strip CJK punctuation. Cosmetic but ugly. Candidate: strip leading `[.;。！？\s]+` after extraction.
2. **Truncated fragments**: `"的方案被排除了"` is cut (non-greedy `{0,40}?` + lookbehind boundary). Ideal anchor is the full sentence. Candidate: extend to full sentence boundaries after extraction.
3. **EN regex vs CJK comma/semicolon**: `[^.;。！？]` lacks Chinese comma「，」/semicolon「；」 — mixed text with Chinese enumeration may swallow segments too (theoretical, untested).
4. **Duplicate anchors**: repeated corpus yields the same exclusion sentence 3× (`collectAnchors` dedups across events; `extractExcludedClaims` has no internal dedup — wasted maxAnchors quota for same-reasoning duplicates).
5. **No quantified false-positive rate**: no representative corpus evaluating "non-excluded treated as excluded" — the fix covers sentence boundaries only; wording-level false positives (e.g. "is not the best option") uncovered.
6. **Anchor quality → model behavior unverified**: anti-re-derivation benefit and misleading side-effects not measured with a real model (needs DEEPSEEK_API_KEY + a real spark session).

## Alternatives considered

Regex extension (chosen, minimal change) vs sentence splitting first (more accurate, adds a dependency) vs LLM extraction (most accurate but costly and non-deterministic). Current: regex + boundary patch; revisit the splitter option if the measured false-positive rate stays high.

<!-- Related implementations: packages/llm/llm-deepseek/src/spark.ts (extractExcludedClaims); packages/context/spark-anchors/src/index.ts (collectAnchors/renderAnchors) -->
