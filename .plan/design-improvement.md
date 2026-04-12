# Design Improvement Plan

Derived from `design_inspiration/` — two coherent design systems:
- **Nocturnal Curator** (dark, cinematic) — primary target theme
- **Indigo Gallery** (light, editorial) — secondary/light mode reference

Both share the same philosophy: no structural borders, Manrope/Inter typography, indigo-purple gradient as brand signature, glassmorphism for modals, breathing layouts with no dividers.

---

## Current State

- Default shadcn light/dark theme — generic white background, explicit 1px borders everywhere, flat cards, no custom typography, standard blue primary
- No visual hierarchy beyond borders and basic shadows
- Generic SaaS dashboard feel with no editorial character

---

## Changes (Priority Order)

### 1. Color System Overhaul
**File:** `apps/web/app/styles/globals.css`

Replace generic shadcn CSS vars with Nocturnal Curator dark-mode tokens as the primary theme:

| Token | Value | Usage |
|---|---|---|
| `surface` | `#060e20` | App background |
| `surface_container_low` | `#091328` | Sidebar background |
| `surface_container` | `#0f1e38` | Section backgrounds |
| `surface_container_high` | `#152340` | Card hover states |
| `surface_container_highest` | `#192540` | Cards, active states |
| `surface_bright` | `#1f2b49` | Active nav item bg |
| `primary` | `#a3a6ff` | Primary action color |
| `secondary` | `#c180ff` | Accent / highlight |
| `tertiary` | `#ff6daf` | Alerts, active states |
| `on_surface` | `#e2e8f8` | Primary text |
| `on_surface_variant` | `#a3aac4` | Secondary metadata text |
| `outline_variant` | `#40485d` | Ghost borders (20% opacity only) |

**Gradient signature:** `linear-gradient(135deg, #a3a6ff, #c180ff)` — used for primary CTAs and hero accents.

**Rule:** Remove all `border` color usage from layout containers. Hierarchy via background shifts only.

---

### 2. Typography
**Files:** `apps/web/app/root.tsx`, `apps/web/app/styles/globals.css`

- Import **Manrope** (headlines) + **Inter** (body/metadata) from Google Fonts via `<link>` in `root.tsx`
- Set `font-family: 'Inter', sans-serif` as base body font
- Set `font-family: 'Manrope', sans-serif` for all `h1`–`h3` elements
- Editorial headline style: `letter-spacing: -0.02em`, `font-weight: 700`
- Metadata label style: uppercase, `letter-spacing: 0.05em`, `font-size: 0.75rem` (label-md)
- Never use more than two font weights per view — rely on size + color for hierarchy

---

### 3. Login Page
**File:** `apps/web/app/routes/login.tsx`

Current: Plain centered form on a flat background.

Redesign:
- Full-viewport dark gradient background (`#060e20` → `#091328`)
- Centered glassmorphic card: `backdrop-blur-2xl`, `surface_bright` at 70% opacity, `xl` border-radius
- App logo/icon above the form
- "Welcome Back" Manrope headline + subtitle
- Input labels: "IDENTIFIER" / "PASSPHRASE" — uppercase, tracked, `on_surface_variant`
- Input fields: `surface_container_lowest` background, ghost border at 20% opacity → 100% `primary` on focus
- CTA: gradient button (`#a3a6ff` → `#c180ff`, 135°), "AUTHENTICATE" label
- "Request Access" link for new users
- "System Operational" status dot + version string pinned to the bottom of the card

---

### 4. Sidebar Navigation
**File:** `apps/web/app/routes/dashboard.tsx`

Current: Basic list with `border-right` separator.

Redesign:
- Background: `surface_container_low` (`#091328`), no right border — background shift separates it from content
- Nav items: icon + label, generous padding
- Active state: 3px left accent bar in `secondary` (`#c180ff`) + `surface_bright` item background
- Hover state: `surface_container_high` background, no border
- Bottom section (pinned):
  - "Upload Media" button with gradient background
  - User avatar + name + role label in `on_surface_variant`
- Nav items: Library, Collections, Shared, Analytics, Settings

---

### 5. Dashboard Hero + Layout
**File:** `apps/web/app/routes/dashboard.tsx`

Current: Flat header with basic title.

Redesign:
- Large Manrope `headline-lg` editorial title: "Your Collection"
- Subtitle in `on_surface_variant`: "Organized precision for your creative assets and digital artifacts."
- Top-right: Storage capacity stat — "72% USED", progress bar, "X TB of Y TB", "Upgrade Plan" link
- "Active Folders" section header with "View All →" link
- Folder cards: icon + name + item count + size, `surface_container_highest` background, no border, `md` radius
- Section spacing: `spacing-10` (`3.5rem`) between logical sections — let it breathe

---

### 6. Media Grid Cards
**File:** `apps/web/app/routes/dashboard.tsx`

Current: Basic thumbnails in a grid with file name below.

Redesign:
- Overlay type badge on thumbnail: `IMAGE` / `VIDEO` pill chip, `surface_container_highest` at 80% opacity
- Download icon overlay: appears on hover, bottom-right corner
- Hover effect: thumbnail scales `1.05x` + card background shifts from `surface_container_low` → `surface_container_highest`
- File name: `title-sm`, white
- File size + date: `label-sm`, `on_surface_variant`
- No dividers between list-view items — use `spacing-6` gaps only
- Consider **4:5 aspect ratio** thumbnails to break 16:9 grid monotony
- "No-Divider" rule: forbid `divide-*` and `border-b`/`border-t` between list items

---

### 7. Media Detail View
**File:** `apps/web/app/components/MediaAssetViewer.tsx`

Current: Standard dialog with media + basic metadata stacked.

Redesign — split-panel layout:
- **Left panel (~65% width):** Full-bleed media preview, dark background, "Asset Status" badge bottom-left (green dot + "Active in Gallery")
- **Right panel (~35% width):**
  - "MASTER ASSET" label (uppercase, tracked, `on_surface_variant`)
  - Filename as `headline-sm` Manrope
  - Captured by / date subtitle
  - Download + Share action buttons (gradient primary + ghost secondary)
  - "TECHNICAL INVENTORY" section: Dimensions, File Size, Resolution, Format — 2-column grid
  - "PALETTE ANALYSIS" section: color swatches extracted from asset
  - "TAXONOMY" section: tag chips with "Edit Tags" action
  - "Edit Meta" + "Delete Asset" footer actions

---

### 8. Admin / Users Page
**File:** `apps/web/app/routes/users.tsx`

Current: Basic table of users.

Redesign:
- "System Overview" Manrope headline with server status indicator (green dot + "Operational")
- Stats row: Storage Utilization (with progress), Active Users count (+ growth %), Health score ring
- "Recent Activity" feed:
  - User avatar + name + action description
  - Timestamp (relative)
  - Colored type badge: MEDIA / AUTH / ACCESS
- "System Logs" panel (right side):
  - Monospaced font for log lines
  - Color-coded levels: INFO (muted), WARN (amber), CRON (purple)
  - Search logs input at the bottom

---

### 9. Logout Confirmation
**File:** New small component, triggered from sidebar

Current: No confirmation — logs out immediately or via basic prompt.

Redesign:
- Light glassmorphic overlay (matches Indigo Gallery light theme)
- Abstract geometric background shapes for visual interest
- "Securely signing out?" Manrope headline
- Explanatory subtitle
- Two buttons: "Return to Dashboard" (ghost) + "Confirm Logout" (gradient primary)
- "The Curated Gallery · Session Security" footer label

---

### 10. Global: Eliminate Structural Borders
**Files:** All route and component files

Audit every `border`, `divide-`, `border-b`, `border-t`, `border-r`, `border-l` class used for layout sectioning and replace with:
- Background color differentiation between adjacent sections
- Spacing scale increases (`gap-6`, `gap-10`) to create visual separation
- Ghost border fallback only when accessibility requires it: `outline_variant` at 20% opacity

---

## Effort Summary

| # | Change | Primary File(s) | Visual Impact |
|---|---|---|---|
| 1 | Color system | `globals.css` | Very High |
| 2 | Typography | `globals.css`, `root.tsx` | High |
| 3 | Login page | `login.tsx` | High |
| 4 | Sidebar navigation | `dashboard.tsx` | High |
| 5 | Dashboard hero | `dashboard.tsx` | Medium |
| 6 | Media grid cards | `dashboard.tsx` | Medium |
| 7 | Media detail view | `MediaAssetViewer.tsx` | Medium |
| 8 | Admin/users page | `users.tsx` | Medium |
| 9 | Logout confirmation | New component | Low |
| 10 | Border elimination | All routes + components | Medium |

## Recommended Implementation Order

Start with **#1 (colors) → #2 (typography)** as every subsequent change builds on the design tokens. Then tackle screens top-down: **#3 login → #4 sidebar → #5–6 dashboard → #7 detail view → #8 admin → #9 logout → #10 border audit**.
