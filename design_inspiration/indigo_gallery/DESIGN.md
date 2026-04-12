# Design System: The Curated Gallery

## 1. Overview & Creative North Star: "The Digital Curator"
The objective of this design system is to transform media management from a utility into an editorial experience. We are moving away from the "cluttered dashboard" trope and toward a **"Gallery Aesthetic."** 

Our Creative North Star is **The Digital Curator**. This means the UI must act as a sophisticated, invisible frame that recedes to let the media content lead. We achieve this through "Breathable Precision"—using expansive white space, intentional asymmetry, and tonal layering rather than rigid borders. The layout should feel like a high-end physical portfolio where every element is placed with purpose, not just snapped to a generic grid.

---

## 2. Colors: Tonal Depth over Structural Lines
We are abandoning the "boxed-in" look. Hierarchy is established through the light and shadow of our Slate neutrals, punctuated by the high-energy Indigo.

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to define sections. Boundaries must be created via background shifts.
*   **Background (`#f8f9ff`)**: The canvas.
*   **Surface-Container-Low (`#eff4ff`)**: Used for secondary sidebars or grouping related content.
*   **Surface-Container-Lowest (`#ffffff`)**: Used for high-priority floating cards to create natural "lift."

### The Glass & Gradient Rule
To add "soul" to the interface, use **Glassmorphism** for persistent elements like Navigation Bars or floating Action Buttons.
*   **Implementation:** Use `surface` or `surface_container_low` at 70% opacity with a `20px` backdrop-blur. 
*   **Signature Gradients:** For primary CTAs or Hero sections, transition from `primary_container` (`#4f46e5`) to `primary` (`#3525cd`) at a 135-degree angle. This prevents the "flat" look of standard SaaS products.

---

## 3. Typography: Crisp Functionalism
We use **Manrope** exclusively. It is a modern geometric sans-serif that maintains high legibility even at the smallest label sizes.

*   **Editorial Headlines:** Use `display-lg` and `headline-lg` with a slightly tighter letter-spacing (-0.02em) to create an authoritative, "magazine" feel.
*   **The Power of Labels:** Use `label-md` (`0.75rem`) in all-caps with increased letter-spacing (+0.05em) for metadata and categories. This creates a professional, "archival" aesthetic.
*   **Hierarchical Contrast:** Pair a `headline-sm` title with a `body-md` description. The jump in scale ensures the user’s eye knows exactly where to land first.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are often too heavy for a "Gallery" feel. We use **Ambient Layering**.

*   **The Layering Principle:** Instead of a shadow, place a `surface_container_lowest` (#ffffff) card on top of a `surface_container_low` (#eff4ff) background. The subtle 2% shift in brightness provides a cleaner, more premium sense of depth.
*   **Ambient Shadows:** If an element must float (e.g., a context menu), use a "tinted shadow." 
    *   *Recipe:* Offset: 0, 12px; Blur: 32px; Color: `on_surface` (`#0d1c2e`) at 6% opacity.
*   **The Ghost Border Fallback:** If accessibility requires a border, use `outline_variant` (`#c7c4d8`) at 20% opacity. If you can see the border clearly, it’s too dark.

---

## 5. Components: Refined Utility

### Buttons & Chips
*   **Primary Button:** Uses the signature indigo gradient. Roundedness set to `md` (`0.375rem`) for a professional, sharp look.
*   **Chips (Filters):** Use `surface_container_high` (`#dce9ff`) as the default state. Upon selection, transition to `primary` (`#3525cd`) with `on_primary` (`#ffffff`) text.

### Media Cards & Lists
*   **The "No-Divider" Rule:** Forbid the use of line dividers between list items. Use spacing scale `4` (`1.4rem`) to create separation, or subtle background zebra-striping using `surface_container_low`.
*   **Media Aspect Ratios:** For a gallery feel, use unconventional aspect ratios (e.g., 4:5 or 2:3) for thumbnails to break the "YouTube-style" 16:9 monotony.

### Inputs & Fields
*   **Stateful Transitions:** Active input fields should not just change border color; they should gain a subtle `surface_bright` inner glow to signify "focus" and "readiness."

---

## 6. Do’s and Don’ts

### Do:
*   **Use Asymmetry:** Offset your hero text from your media grid to create a sophisticated, editorial rhythm.
*   **Embrace Negative Space:** If a section feels crowded, use spacing scale `10` (`3.5rem`) or `12` (`4rem`) to let it breathe.
*   **Layer Neutrals:** Use the full spectrum of Slate (from `lowest` to `highest` containers) to guide the user's eye through the app hierarchy.

### Don’t:
*   **Don't use 100% Black:** Always use `on_surface` (`#0d1c2e`) for text. Pure black is too harsh for the "Slate & Indigo" palette.
*   **Don't use Rounded-Full for everything:** Reserve `full` roundedness for interactive elements like tags or buttons. For structural containers, stick to `md` (`0.375rem`) or `lg` (`0.5rem`) to maintain the "Gallery" professional edge.
*   **Don't use standard Dividers:** If you feel the need to draw a line, try using a background color shift first.