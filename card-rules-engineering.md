# Engineering Card Content Rules

This file defines the format, tone, and length constraints for engineering project cards in the portfolio (index.html).

## Card Structure

```html
<article class="landing-feature-card">
    <span class="feature-kicker">{KICKER}</span>
    <h2 class="feature-title">{TITLE}</h2>
    <p class="feature-copy">{COPY}</p>
    <ul class="feature-points">
        <li>{POINT 1}</li>
        <li>{POINT 2}</li>
        <li>{POINT 3}</li>
    </ul>
    <div class="feature-tags">
        <span class="feature-tag">{TAG}</span>
        <!-- 3~5 tags -->
    </div>
    <div class="feature-stats">
        <div class="feature-stat">
            <span class="feature-stat-label">{STAT LABEL}</span>
            <span class="feature-stat-value">{STAT VALUE}</span>
        </div>
        <!-- exactly 3 stats -->
    </div>
    <div class="feature-actions">
        <button class="feature-button">{BUTTON TEXT}</button>
        <div class="feature-link-note">{LINK NOTE}</div>
    </div>
</article>
```

## Field Constraints

| Field | Max Length | Font | Example |
|---|---|---|---|
| Kicker | 2 words, ~15 chars | Monospace | `LLM Workflow`, `ML System` |
| Title | 5~8 words, ~50 chars | Pretendard | `Synthetic Driving Scenario Generation` |
| Copy | 1~2 sentences, 120~180 chars | Pretendard | See below |
| Points | 3 items, each 6~10 words | Pretendard | `Natural language to structured traffic parameters` |
| Tags | 3~5 tags, each 1~2 words | Monospace | `LLM`, `SUMO`, `Prompt Design` |
| Stat Label | 1~2 words, ~15 chars | Monospace, uppercase | `CORE SHAPE`, `SAMPLES` |
| Stat Value | 1~3 words, ~25 chars | Monospace | `176,845`, `Correction Logging` |
| Button | 2~3 words | Monospace | `Open Project`, `Preview Pending` |
| Link Note | 1 short sentence, ~50 chars | Monospace | `Live portfolio available now.` |

## Tone

- **Factual, not promotional.** State what the system does, not why it's great.
- **Technical but readable.** A hiring manager should understand it at a glance.
- **No buzzwords.** Don't say "cutting-edge" or "innovative". Just describe the architecture.
- **English only.**
- **No first person.** Don't say "I built". Just describe the system.

## Copy Examples (Good)

> A workflow that turns natural-language traffic requests into structured SUMO scenarios through fine-tuned extraction, base-model reasoning, validation, and correction logging.

> A full mobility ML system that combines simulation-based labeling, feature engineering, model comparison, online inference, GIS matching, dashboards, and cloud deployment.

## Copy Examples (Bad — too long, too vague, too self-promotional)

> ❌ "I designed and built an innovative end-to-end machine learning pipeline that leverages state-of-the-art techniques to solve complex real-world transportation problems."

## Stats Guidance

Stats should be **concrete and verifiable**:
- Numbers: `176,845` samples, `32` engineered signals
- Architecture shape: `NL → Params → XML`
- System capability: `Realtime Inference Stack`, `Correction Logging`
- NOT vague claims: ❌ `High Performance`, ❌ `Best in Class`

## Mobile Behavior

On mobile (≤640px), the following are **hidden**:
- `feature-points` (bullet list)
- `feature-tags` (tech badges)
- `feature-stats` (stat boxes)

Only kicker, title, copy, and button are visible. **The copy must stand alone without the bullets.**

## Card Height

All cards in the same carousel must have roughly equal visual height. Keep copy length and point count consistent across cards. If one card has significantly more text, it will push the card taller and break alignment.
