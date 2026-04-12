# Design System Document

## 1. Overview & Creative North Star: "The Digital Obsidian"

This design system is engineered for **The Curator**, a high-end media management application. The Creative North Star is **"The Digital Obsidian"**—a concept that treats the interface as a precision-cut, dark gemstone. We move away from the "flat web" by embracing depth through tonal layering, light-refracting gradients, and an editorial typographic approach.

The experience must feel like a premium physical archive. We avoid traditional grids in favor of intentional asymmetry and "breathing layouts" where media assets are the primary focus. By utilizing deep navy surfaces and vibrant indigo accents, we create a high-contrast environment that feels both professional and cinematic.

---

## 2. Colors

The palette is rooted in a deep slate and navy foundation to ensure media content "pops" without visual competition from the UI.

### Surface Hierarchy & The "No-Line" Rule
**Explicit Instruction:** Traditional 1px solid borders for sectioning are strictly prohibited. Boundaries must be defined solely through background color shifts or tonal transitions.
- **Base Layer:** `surface` (#060e20) for the main application background.
- **Secondary Sectioning:** Use `surface_container_low` (#091328) for sidebar or navigation backgrounds.
- **Interactive Elements:** Use `surface_container_highest` (#192540) for cards or hovered states.

### The Glass & Gradient Rule
To achieve a signature feel, main CTAs and floating panels should utilize the following:
- **Signature Gradient:** Linear gradient from `primary` (#a3a6ff) to `secondary` (#c180ff) at a 135-degree angle. This is the visual "soul" of the brand.
- **Glassmorphism:** For overlays (like media modals), use `surface_bright` (#1f2b49) at 70% opacity with a `24px` backdrop-blur.

### Token Summary
- **Primary (Action):** `primary` (#a3a6ff) — Used for high-emphasis actions.
- **Secondary (Accent):** `secondary` (#c180ff) — Used for highlights and branding elements.
- **Tertiary (Alerts/Active):** `tertiary` (#ff6daf) — Used for critical status or vibrant selection states.
- **Neutral Surface:** `surface` (#060e20).

---

## 3. Typography

The typography strategy uses a "Dual-Type" system: **Manrope** for authoritative, modern headlines and **Inter** for high-legibility functional data.

- **Display & Headline (Manrope):** High-contrast sizing. Use `display-lg` (3.5rem) for hero moments and `headline-sm` (1.5rem) for section titles like "Media Library." The geometry of Manrope conveys a tech-forward, curated feel.
- **Body & Label (Inter):** Reserved for metadata and system feedback. `body-md` (0.875rem) is the workhorse for file names and folder descriptions.
- **The Hierarchy Rule:** Boldness is used sparingly to denote importance, while `on_surface_variant` (#a3aac4) is used for secondary metadata to create a clear visual "depth of field."

---

## 4. Elevation & Depth

We achieve hierarchy through **Tonal Layering** rather than structural lines.

- **The Layering Principle:** Stack containers logically. A `surface_container_highest` card should sit atop a `surface_container` section. This creates a soft, natural lift.
- **Ambient Shadows:** For "floating" elements like modals, use a custom shadow: `0px 20px 40px rgba(0, 0, 0, 0.4)`. The shadow color must never be pure black; it should be a deep tint of the `background` color to mimic natural light.
- **The "Ghost Border" Fallback:** If a container needs more definition (e.g., in high-density grids), use a "Ghost Border": `outline_variant` (#40485d) at 20% opacity.
- **Interactivity:** On hover, cards should transition from `surface_container` to `surface_container_high`, creating a subtle "glow" effect rather than a hard movement.

---

## 5. Components

### Media Cards
*   **Structure:** No dividers. Use `1.5rem` (spacing-6) of internal padding.
*   **Styling:** Background set to `surface_container_low`. On hover, the image should scale slightly (1.05x) with a transition to `surface_container_highest`.
*   **Metadata:** File names in `title-sm`, file size in `label-sm` using `on_surface_variant`.

### Buttons
*   **Primary:** Uses the **Signature Gradient** with `on_primary_fixed` (Black) text for maximum punch. `xl` (0.75rem) corner radius.
*   **Secondary/Ghost:** `outline_variant` Ghost Border with `primary` text.
*   **Tertiary:** No background; only `primary` text. Used for "Cancel" or "Back" actions.

### Folder Navigation
*   **Layout:** Clean, vertical structure using `surface_container_low`. 
*   **Active State:** Use a vertical bar (3px width) of `secondary` on the left edge of the active item, with the item background shifting to `surface_bright`.

### Input Fields
*   **Surface:** `surface_container_lowest` (#000000) for the field background to create a "recessed" look.
*   **Border:** Ghost Border (20% opacity) that transitions to 100% `primary` on focus.

### Chips & Tags
*   **Style:** Low-profile. Use `surface_container_highest` with `label-md` typography. No borders.

---

## 6. Do's and Don'ts

### Do
*   **Do** use vertical white space (Spacing 8 or 10) to separate logical sections.
*   **Do** apply subtle gradients to large icons (like folder icons) to give them weight and dimension.
*   **Do** use `9999px` (full) roundedness for selection chips to contrast with the `xl` (0.75rem) roundedness of containers.
*   **Do** ensure text on primary buttons uses the dark `on_primary_fixed` token for accessibility against light gradients.

### Don't
*   **Don't** use 1px solid white or grey borders to separate the sidebar from the main content. Use a background color shift instead.
*   **Don't** use standard "Drop Shadows." Only use the Ambient Shadow spec for floating components.
*   **Don't** use more than two font weights per view. Let the size and color (on-surface vs variant) do the heavy lifting.
*   **Don't** clutter the media grid. Allow the assets to "breathe" with generous spacing-6 gutters.