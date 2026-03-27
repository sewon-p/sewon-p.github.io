# PM Modal Content Rules

This file defines the structure, tone, and constraints for PM case modal content in `index.html`.

## Modal HTML Location

Modal content is stored in hidden `<div>` blocks near the bottom of `index.html`:
```html
<div id="project{N}-content" style="display:none;">
    <!-- content here -->
</div>
```

Where `{N}` = project number (1~4). Opened via `openModal(N)`.

**Note:** Modal is disabled on mobile. Only visible on desktop.

## Modal Structure Template

```html
<div id="project{N}-content" style="display:none;">
    <!-- HEADER -->
    <div class="p-header">
        <span class="p-badge">{EMOJI} PROJECT {NN}</span>
        <h1 class="p-title">{Project Title}</h1>
        <div class="p-meta">{Date} · {Role} · {Team Size}</div>
        <!-- Optional: awards -->
        <div class="award-tag-container" style="margin-top:15px;">
            <span class="award-tag award-gold">{Award}</span>
        </div>
        <p class="p-subtitle">{One-line summary}</p>
    </div>

    <!-- SECTIONS (typically 4~6) -->
    <div class="p-grid-2">  <!-- 2-column grid for first 2 sections -->
        <div class="p-section">
            <div class="p-sec-title">{Emoji} 01. {Section Title}</div>
            <!-- section content -->
        </div>
        <div class="p-section">
            <div class="p-sec-title">{Emoji} 02. {Section Title}</div>
            <!-- section content -->
        </div>
    </div>

    <!-- Full-width sections -->
    <div class="p-section">
        <div class="p-sec-title">{Emoji} 03. {Section Title}</div>
        <!-- section content -->
    </div>

    <!-- KPT REFLECTION (always last) -->
    <div class="kpt-section">
        <h3 class="kpt-title">KPT Retrospective</h3>
        <div class="kpt-item kpt-keep">
            <span class="kpt-label"><i data-lucide="check-circle" size="20"></i> Keep</span>
            <p class="kpt-desc">{What went well}</p>
        </div>
        <div class="kpt-item kpt-problem">
            <span class="kpt-label"><i data-lucide="alert-triangle" size="20"></i> Problem</span>
            <p class="kpt-desc">{What went wrong}</p>
        </div>
        <div class="kpt-item kpt-try">
            <span class="kpt-label"><i data-lucide="rocket" size="20"></i> Try</span>
            <p class="kpt-desc">{What to do differently}</p>
        </div>
    </div>
</div>
```

## Section Types (reusable patterns)

### Problem/Insight Box
```html
<div class="prob-box">
    <h3>"Quote or framing statement"</h3>
    <h3>{Emoji} Context</h3>
    <p>{Description}</p>
    <div class="gray-box">
        <ul>
            <li><strong>{Point}</strong><span>{Detail}</span></li>
        </ul>
    </div>
    <div class="insight-box">
        <h3>💡 Insight</h3>
        <p class="insight-text">"Key insight quote"</p>
    </div>
</div>
```

### Solution Grid (3 cards)
```html
<div class="sol-grid">
    <div class="sol-card">
        <div class="emoji-icon">{Emoji}</div>
        <h4>{Title}</h4>
        <p>{Description}</p>
    </div>
    <!-- repeat 3x -->
</div>
```

### Roadmap Stack
```html
<div class="roadmap-stack">
    <div class="roadmap-card">
        <div class="rm-header">
            <span class="rm-step">PHASE 1</span>
            <span class="rm-icon">{Emoji}</span>
            <h3 class="rm-title">{Title}</h3>
            <p class="rm-desc">{Subtitle}</p>
        </div>
        <div class="rm-details">
            <div class="rm-item">
                <span class="rm-label">{Label}</span>
                <span class="rm-text">{Detail}</span>
            </div>
        </div>
    </div>
</div>
```

### Chart (Vertical Bar)
```html
<div class="v-chart-container">
    <div class="v-chart-group">
        <div class="v-chart-title">{Label}</div>
        <div class="v-chart-gap">Gap {N}%</div>
        <div class="v-bars">
            <div class="v-bar-col">
                <div class="v-bar v-bar-kr" style="height: {N}%;"></div>
                <div class="v-bar-label">KR</div>
            </div>
            <div class="v-bar-col">
                <div class="v-bar v-bar-jp" style="height: {N}%;"></div>
                <div class="v-bar-label">JP</div>
            </div>
        </div>
    </div>
</div>
```

## Content Constraints

| Element | Constraint |
|---|---|
| p-badge | Fixed: `{Emoji} PROJECT {NN}` |
| p-title | Max 8 words, ~50 chars |
| p-meta | Format: `{Date Range} · {Role} · {Team info}` |
| p-subtitle | 1 sentence, max 80 chars |
| p-sec-title | Format: `{Emoji} {NN}. {Title}`, max 4 words |
| Section count | 4~6 sections per modal |
| KPT | Always present, always last. Each item 1~3 sentences. |

## Tone

- **Analytical, not storytelling.** Focus on method, logic, and structure.
- **Show the thinking process**, not just results.
- **Bold key terms** with `<strong>` — hiring managers skim.
- **Accent color** (`var(--accent)`) only for key insights or important labels.
- **English only.**

## Font Rules (same as main portfolio)

- Section titles, headings → Pretendard
- Labels (rm-label, rm-step, kpt-label) → Monospace
- Body text → Pretendard
- Badge, meta → Monospace

## Existing Modals Reference

| ID | Project | Sections |
|---|---|---|
| project1-content | Cross-border Commerce | Problem → Market Validation → Solution → Growth → Outcome → KPT |
| project2-content | Campus P2P Delivery | Problem → Route Optimization → Incentive → UX → Outcome → KPT |
| project3-content | Digital Asset Trading UX | Problem → Analysis → Redesign → Testing → KPT |
| project4-content | Drive-to-Earn Reward | Problem → Algorithm → Business Model → Strategy → KPT |
