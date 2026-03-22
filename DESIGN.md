# Design System Document: The Animated Sketchpad

## 1. Overview & Creative North Star
**Creative North Star: "The Living Doodle"**
This design system rejects the clinical sterility of modern SaaS. It is an homage to the physical sketchpad—messy, tactile, and bursting with human energy. By blending "Jackbox-style" high-energy motion with the warmth of analog paper, we create a space where players feel safe to be "bad" at drawing. 

We break the "template" look through **Intentional Imperfection**. Layouts should avoid rigid symmetry; use the Spacing Scale to create "skewed" arrangements where elements feel like they’ve been tossed onto a desk. We lean into organic shapes and overlapping surfaces to suggest a physical stack of drawings.

---

## 2. Colors
Our palette is rooted in the warmth of a premium cream paper stock, punctuated by high-vibrancy "ink" accents.

- **The Palette:**
    - **Base:** `surface` (#fcf6ed) acts as our paper.
    - **Primary Ink:** `primary` (#ab2d00) is our energetic "Sketching Orange."
    - **Secondary Ink:** `secondary` (#005e9f) is a "Blueprint Blue" for secondary actions and contrast.
    - **Tertiary:** `tertiary` (#6d5a00) provides a "Highlighter Yellow" for timers and alerts.

- **The "No-Line" Rule:** 1px solid structural borders are strictly prohibited. Boundaries must be defined by shifts in paper weight. To separate the header from the canvas, use `surface-container-low` against the `surface` background.
- **Surface Hierarchy:** Treat the UI as a desk. The `surface-container-highest` (#e2dcd1) represents the "bottom" of the stack, while `surface-container-lowest` (#ffffff) represents the active, topmost sheet of paper.
- **Glass & Gradient:** For floating "Tool Palettes" or "Drawing Overlays," use a Glassmorphism effect: `surface` color at 80% opacity with a 12px `backdrop-blur`. 
- **Signature Textures:** Apply a subtle linear gradient from `primary` to `primary-container` on all large CTA buttons to give them a "gel pen" depth.

---

## 3. Typography
Typography is the voice of the game. It should feel like a mix of a professional comic book and a handwritten note.

- **Display (plusJakartaSans):** Our "Chunky" hero. Use `display-lg` for room codes and `headline-lg` for game states. The rounded terminals of Plus Jakarta Sans mimic the flow of a felt-tip marker.
- **Body (beVietnamPro):** For instructions and chat. It provides the "clean" counter-balance to the expressive headlines. `body-lg` is the standard for player prompts.
- **Labels (spaceGrotesk):** Our "Monospaced" utility. Used for technical data, room codes (all-caps), and the "Ghost Border" fallback text. It adds a "digital-meets-analog" quirky flair.

---

## 4. Elevation & Depth
We eschew the "Material" shadow in favor of **Tonal Layering** and **Sketchy Depths**.

- **The Layering Principle:** Instead of shadows, use `surface-container` tiers. A "Card" should be `surface-container-lowest` sitting on a `surface-container-high` background. This creates a "cut paper" look.
- **Ambient Shadows:** When a sheet must "float" (e.g., a modal), use a high-spread, low-opacity shadow. 
    - *Value:* `0px 20px 40px rgba(49, 46, 41, 0.08)`. The shadow color is a tint of `on-surface`, never pure black.
- **The "Ghost Border":** For drawing tools or input fields, use `outline-variant` at 15% opacity. This suggests a faint pencil guideline rather than a hard digital edge.

---

## 5. Components

### Buttons (The "Squeezable" Button)
- **Primary:** `primary` background, `on-primary` text. Border-radius: `xl` (3rem). 
- **Style:** Add a `2px` offset "Sketch Shadow" using `primary-dim` to give the button a 3D, tactile feel.
- **State:** On press, remove the offset shadow and scale the button to `98%` to simulate physical compression.

### Room Codes
- **Style:** Use `display-md` in `spaceGrotesk`, All-Caps. 
- **Container:** `secondary-container` background with a `DEFAULT` (1rem) roundedness. Use `letter-spacing: 0.1em`.

### Timers (The "Heat-Up" Element)
- **Normal:** `tertiary` (Yellow).
- **Warning (<10s):** Transitions to `error_container` (Coral).
- **Critical (<3s):** Flashes `error` (Red) with a slight scale-up animation on every second.

### Cards & Drawing Canvas
- **Forbid:** No divider lines between player names in lists.
- **Solution:** Use `surface-container-low` for even rows and `surface-container-high` for odd rows, or simply use `spacing-4` (1.4rem) of vertical white space to let the "paper" breathe.

### Inputs (The "Doodle Box")
- **Style:** Background `surface-container-lowest`. 
- **Focus:** Instead of a blue glow, increase the `outline-variant` opacity to 40% and add a subtle `2deg` rotation to the entire container to make it look "hand-placed."

---

## 6. Do’s and Don’ts

### Do:
- **Use "Wonky" Alignment:** Aligning a headline slightly off-center (`spacing-1`) can make the UI feel more "sketched."
- **Embrace White Space:** High-energy games need "breathing room" so the players provide the energy, not the clutter.
- **Layer Surfaces:** Always ask, "Can I define this area with a background color shift instead of a line?"

### Don’t:
- **No 90-degree Corners:** Everything must have at least a `sm` (0.5rem) radius. Sharp corners feel "corporate" and "stiff."
- **No Pure Greys:** Never use `#808080`. Use `on-surface-variant` which is a "warm charcoal" to maintain the parchment vibe.
- **No Heavy Shadows:** If the shadow is the first thing you see, it’s too dark. It should be felt, not seen.
