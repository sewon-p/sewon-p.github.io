# Project Page Style Reference

Use this file when building individual project pages (LLM project, ML project, etc.) to maintain visual consistency with the main portfolio.

## Color Palette (strict — 3 colors only)

```css
:root {
    --dark: #2B2D42;         /* Text, headings */
    --muted: #8D99AE;        /* Secondary text, borders, dividers */
    --surface: #EDF2F4;      /* Backgrounds */
    --accent: #EF233C;       /* Buttons, active states, highlights — SPARINGLY */
    --surface-border: rgba(141, 153, 174, 0.25);  /* Card borders */
    --ink-soft: rgba(43, 45, 66, 0.72);            /* Body text */
}
```

**Red accent rules:**
- YES: buttons, active indicators, inline code highlights, badge backgrounds
- NO: large backgrounds, large text blocks, decorative borders

## Font System

### CDN Link (add to `<head>`)
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
```

### Font Families
```css
/* Readable content — headings, descriptions, body */
font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

/* Metadata, labels, code, technical info */
font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Consolas', monospace;
```

### When to Use Which

| Monospace | Pretendard |
|---|---|
| Section labels / kickers | Page titles |
| Stat labels & values | Section headings |
| Code snippets | Descriptions / paragraphs |
| Tag badges | Bullet point text |
| Navigation buttons | Card titles |
| Metadata (dates, versions) | Body copy |
| File paths, tech names | Explanatory text |

**Rule:** If it's a label, tag, number, or technical identifier → Monospace. If it's meant to be read as prose → Pretendard.

## Typography Scale

```css
/* Page title */
font-size: 2.4rem; font-weight: 900; letter-spacing: -0.04em;

/* Section heading */
font-size: clamp(1.8rem, 3vw, 2.4rem); font-weight: 800; letter-spacing: -0.03em;

/* Card title */
font-size: clamp(1.5rem, 2vw, 1.85rem); font-weight: 800;

/* Body text */
font-size: 1.06rem; line-height: 1.68; font-weight: 500;

/* Small labels (monospace) */
font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;

/* Stat values (monospace) */
font-size: 1.15rem; font-weight: 800;

/* Tag badges (monospace) */
font-size: 0.82rem; font-weight: 600;
```

## Card / Container Style (adapt to context)

These are **tone guidelines**, not fixed sizes. Adjust padding, radius, and shadow to fit the page layout. The key is visual consistency: white-ish surface, subtle border, soft shadow.

```css
/* Base tone — adjust sizes as needed */
.container {
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid var(--surface-border);
    border-radius: 16px ~ 24px;       /* smaller for compact elements, larger for hero cards */
    padding: 20px ~ 36px;             /* scale with content density */
    box-shadow: 0 8px 24px rgba(43, 45, 66, 0.06);
}

/* Hover effect (optional — use on interactive elements only) */
.container:hover {
    border-color: rgba(239, 35, 60, 0.38);
    box-shadow: 0 24px 44px rgba(43, 45, 66, 0.09);
    transform: translateY(-3px);
    transition: all 0.25s ease;
}
```

**Key principles:**
- Background: always white or near-white with slight transparency
- Border: always `var(--surface-border)`, never solid dark lines
- Shadow: always soft and diffused, never hard drop shadows
- Radius: keep consistent within the same page (don't mix 8px and 24px)

## Button Style

```css
.button {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 1.04rem;
    font-weight: 700;
    padding: 16px 28px;
    border-radius: 14px;
    background: var(--accent);
    color: white;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: -0.01em;
}

/* Outline variant (for secondary actions) */
.button-outline {
    background: transparent;
    border: 2px solid var(--accent);
    color: var(--accent);
}
```

## Tag / Badge Style

```css
.tag {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.82rem;
    font-weight: 600;
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid var(--surface-border);
    color: var(--dark);
    background: white;
}
```

## Kicker / Label Style

```css
.kicker {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
}
```

## Background

```css
body {
    background: var(--surface);  /* #EDF2F4 */
    color: var(--dark);
    font-family: 'Pretendard', -apple-system, sans-serif;
}
```

## Spacing Guidelines (ranges, not fixed)

Spacing should feel **generous but not wasteful**. These are ranges — pick what fits your layout:

- Section vertical padding: `60px ~ 100px`
- Container internal padding: `20px ~ 36px`
- Gap between containers: `16px ~ 24px`
- Heading → content gap: `12px ~ 28px`
- Internal element gap: `8px ~ 16px`

The portfolio uses the upper end of these ranges for hero/landing sections and the lower end for dense content areas. Match accordingly.

## Responsive Breakpoints

```css
@media (max-width: 980px) { /* Tablet */ }
@media (max-width: 640px) { /* Mobile */ }
```

## General Principles

1. **Calm, clean, readable.** No harsh contrast, no visual noise.
2. **Red is accent only.** If you're using red on more than 3 elements per viewport, it's too much.
3. **Monospace for data, Pretendard for prose.** No exceptions.
4. **Cards should breathe.** Generous padding, subtle borders, light shadows.
5. **Match the portfolio tone.** The project page should feel like it belongs to the same person/brand as the main portfolio.
