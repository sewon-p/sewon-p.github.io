# PM / Strategy Card Content Rules

This file defines the format, tone, and length constraints for PM/Strategy case cards in the portfolio (index.html).

## Card Structure

```html
<article class="landing-pm-card" onclick="openModal({PROJECT_ID})">
    <span class="pm-index">{YYYY.MM}</span>
    <span class="pm-card-meta">{CATEGORY}</span>
    <div class="pm-card-emoji">{EMOJI}</div>
    <h3 class="pm-card-title">{TITLE}</h3>
    <p class="pm-card-copy">{DESCRIPTION}</p>
    <span class="pm-card-link">View Detailed Case ↗</span>
</article>
```

## Field Constraints

| Field | Max Length | Font | Example |
|---|---|---|---|
| Date Index | `YYYY.MM` format | Monospace | `2024.12`, `2024.08`, `2021.06` |
| Category | 1~3 words, ~25 chars | Monospace, uppercase | `CROSS-BORDER STRATEGY`, `LOGISTICS CONCEPT` |
| Emoji | 1 emoji, representative | — | ✈️, 🚚, 💹, 🔋 |
| Title | 3~6 words, ~40 chars | Pretendard, bold | `Cross-border Commerce & Fintech Ecosystem` |
| Description | 1~2 sentences, 100~150 chars | Pretendard | See below |
| Link | Fixed | Monospace | `View Detailed Case ↗` or `Coming Soon` |

## Card Order

Cards are ordered **newest first (left) → oldest last (right)**:
- Leftmost = most recent date
- Rightmost = oldest date

When adding a new case, use the project start date as `YYYY.MM` and place it as the **first card** in the HTML.

## Tone

- **One-line summary of what the case is about.** Not a story, not a pitch.
- **Focus on the method/approach**, not the result.
- **Use domain-specific terms** where appropriate (e.g., "pricing-gap analysis", "OR-Tools routing", "misclick risk reduction").
- **English only.**
- **No first person.**

## Description Examples (Good)

> Cross-border pricing gap analysis and a B2B pivot strategy built from market validation and operating-flow design.

> A route-based campus delivery concept using OR-Tools, last-mile logic, and incentive design to reduce cost and distance.

> An internship case focused on trading UX, misclick risk reduction, and interface clarity for high-stakes financial actions.

## Description Examples (Bad)

> ❌ "I led a team of 5 to create an amazing cross-border commerce platform that revolutionized the way people shop internationally." (too long, first person, promotional)

> ❌ "E-commerce project." (too short, no method)

## Emoji Selection

Pick **one emoji** that represents the domain/industry:
- ✈️ Cross-border / International
- 🚚 Logistics / Delivery
- 💹 Finance / Trading
- 🔋 EV / Energy
- 🧪 Placeholder / TBD
- Keep it simple, 1 emoji only, no combinations

## PM Modal (Detailed View)

Each PM card opens a modal with detailed case content. The modal content is stored in a hidden `<div id="project{N}-content">` block. Refer to existing modal templates (Project 1~4) for structure. Modal content includes:
- Header with badge + title + one-line summary
- Multiple sections with detailed analysis
- KPT (Keep / Problem / Try) reflection at the end

**Modal is NOT shown on mobile.** `View Detailed Case` link is hidden on mobile devices.

## Card Height Consistency

All PM cards should have roughly the same visual height. The emoji + title + description must stay within similar line counts:
- Title: max 2 lines (at card width ~25% of viewport)
- Description: max 3 lines
- If a title is longer, shorten the description to compensate

## Mobile Behavior

On mobile (≤640px):
- Cards show at 70% width, centered, with peek on both sides
- `View Detailed Case ↗` link is **hidden**
- Dot indicators show current card position
- Swipe to navigate between cards
