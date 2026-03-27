# Portfolio Style Guide

## Color Palette (3 colors only)

| Name | Hex | Usage |
|---|---|---|
| Lavender Grey | `#8D99AE` | Muted text, borders, dividers, secondary elements |
| Platinum | `#EDF2F4` | Backgrounds, card surfaces |
| Strawberry Red | `#EF233C` | Accent ONLY — buttons, active indicators, kicker text. Use sparingly. |

**Dark text**: `#2B2D42` (near-black, used for headings and body)

## Font System

### Monospace: `'SF Mono', 'Fira Code', 'Fira Mono', monospace`

Used for metadata, labels, and technical identifiers:
- Section kickers (ENGINEERING, STRATEGY)
- Feature kickers (LLM Workflow, ML System)
- PM card indices (PM Case 04)
- PM card meta tags (CROSS-BORDER STRATEGY)
- Stat labels and values
- Tech tag badges
- Navigation buttons (See My Work, Back to Engineering)
- Contact info
- Bio facts (education, skills)
- Hero tagline

### Pretendard: `'Pretendard', -apple-system, sans-serif`

Used for headings, descriptions, and readable content:
- Hero name (Sewon Park)
- Section titles (Featured Engineering Work)
- Card titles
- Card descriptions / copy
- Bullet points
- Body text
- Section notes

### Rule of Thumb

> **If it's a label, tag, or data point → Monospace**
> **If it's a heading, description, or narrative → Pretendard**

## Page Structure (3 snap sections)

1. **Hero** — Name, tagline, contact, education/skills facts, CTA
2. **Engineering** — Featured engineering project cards (carousel with arrows + progress bar)
3. **Strategy** — PM/Strategy case cards (carousel with arrows + progress bar)

Each section = `min-height: 100vh` + `scroll-snap-align: start`

## Hierarchy

- **Engineering = PRIMARY** (shown first, larger cards, more detail)
- **Strategy/PM = SECONDARY** (shown below, supporting evidence, lower visual weight)

## Red Accent Usage

Red (`#EF233C`) should appear ONLY on:
- CTA buttons
- Feature kicker badges
- Active carousel indicators
- Stat highlights (sparingly)

**Never** use red for:
- Backgrounds
- Large text blocks
- Borders (except hover states)
- Decorative elements

## Responsive Behavior

### Desktop (>640px)
- Full card content visible
- Carousel with arrow buttons + progress bar
- PM modals active

### Mobile (≤640px)
- Header hidden
- Engineering cards: bullets, tags, stats hidden
- PM cards: 70% width centered, "View Detailed Case" hidden, modal disabled
- Dot indicators instead of progress bar
- Full-screen overlay on first load ("Touch to continue")
