---
name: Mo.Blend Studio
colors:
  surface: '#121317'
  surface-dim: '#121317'
  surface-bright: '#38393d'
  surface-container-lowest: '#0d0e12'
  surface-container-low: '#1a1b1f'
  surface-container: '#1e1f24'
  surface-container-high: '#292a2e'
  surface-container-highest: '#343439'
  on-surface: '#e3e2e7'
  on-surface-variant: '#c8c4d7'
  inverse-surface: '#e3e2e7'
  inverse-on-surface: '#2f3034'
  outline: '#928ea0'
  outline-variant: '#474554'
  surface-tint: '#c6bfff'
  primary: '#c6bfff'
  on-primary: '#2900a0'
  primary-container: '#6c5ce7'
  on-primary-container: '#faf6ff'
  inverse-primary: '#5847d2'
  secondary: '#aec6ff'
  on-secondary: '#002e6a'
  secondary-container: '#0061d1'
  on-secondary-container: '#dbe4ff'
  tertiary: '#c6c6ce'
  on-tertiary: '#2f3036'
  tertiary-container: '#717178'
  on-tertiary-container: '#f8f7ff'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e4dfff'
  primary-fixed-dim: '#c6bfff'
  on-primary-fixed: '#160066'
  on-primary-fixed-variant: '#4029ba'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#aec6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#e3e1ea'
  tertiary-fixed-dim: '#c6c6ce'
  on-tertiary-fixed: '#1a1b21'
  on-tertiary-fixed-variant: '#46464d'
  background: '#121317'
  on-background: '#e3e2e7'
  surface-variant: '#343439'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  title-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '500'
    lineHeight: '1.5'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  mono-label:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  container-margin: 12px
  panel-gutter: 1px
---

## Brand & Style
The brand personality is precise, immersive, and high-performance. As a tool for motion graphics artists, the UI must fade into the background to let the user's creative work take center stage, while remaining confident and accessible.

The design style is **Corporate Modern** with a lean toward **Minimalism**. It utilizes a deep dark-mode architecture to reduce eye strain during long editing sessions. The aesthetic is defined by crisp lines, high-contrast typography, and a "pro-tool" density that prioritizes utility without feeling cluttered. Visual interest is introduced through a sophisticated electric blue-violet accent system that signals interactivity and progress.

## Colors
The palette is engineered for a professional editor environment. 

- **Neutral Foundation:** The interface uses a tiered dark-mode system. `#16171B` is reserved for the primary application background and canvas area. `#1E1F25` is used for sidebar panels and toolbars, providing a subtle lift.
- **Accents:** The primary accent is a vibrant indigo-violet. Use the `#6C5CE7` to `#4C8DFF` gradient sparingly for high-impact areas like "Export" buttons, active keyframes, or progress indicators.
- **Semantic Colors:** Success, Warning, and Error colors are desaturated slightly to maintain harmony with the dark background while remaining clear for status feedback.

## Typography
The system uses **Inter** for its exceptional legibility at small sizes and its neutral, modern character. 

- **Hierarchy:** Use `headline-lg` for primary workspace headers. `label-caps` is utilized for sidebar category headers (e.g., "LAYERS", "EFFECTS") to provide clear structural breaks.
- **Data Entry:** For coordinate values, timestamps, and frame numbers, use a monospaced font (JetBrains Mono) to prevent layout shifting when values increment.
- **Scale:** Keep text generally small (12px-14px) to maximize the "information density" required for complex motion editing, ensuring primary labels are always `#FFFFFF` and supporting text is `#A0A0A5`.

## Layout & Spacing
This design system utilizes a **Fixed Grid** for its workspace panels and a **4px Base Unit** for internal spacing.

- **Workspace Layout:** The interface is divided into functional regions: a central viewport, left-side asset library, right-side properties inspector, and a bottom-docked timeline. Panels are separated by a 1px border (`#2D2E35`) rather than wide gutters to maximize screen real estate.
- **Density:** Use `8px` (sm) for internal element padding within cards and inputs. Use `16px` (md) for padding between major logical groups.
- **Breakpoints:** On smaller screens (Tablets), sidebars should collapse into icons to prioritize the viewport. Desktop is the primary target, assuming a minimum width of 1280px.

## Elevation & Depth
Depth is created through **Tonal Layers** and subtle 1px borders rather than heavy shadows.

- **Level 0 (Base):** `#16171B` — The canvas and global background.
- **Level 1 (Panels):** `#1E1F25` — Sidebars and toolbars. Use a 1px border of `#2D2E35` on all sides.
- **Level 2 (Overlays/Modals):** `#2D2E35` — Dropdown menus, tooltips, and modals. These should feature a soft ambient shadow (Black, 25% opacity, 12px blur) to separate them from the workspace.
- **Active State:** Any "hovered" or "selected" list item should use a subtle tint of the primary color at 10% opacity or a slightly lighter surface color to indicate focus.

## Shapes
The shape language is controlled and modern. 

- **Standard Elements:** Use `8px` (rounded) for buttons, input fields, and panels.
- **Small Elements:** Use `4px` (soft) for small tooltips or tags.
- **Active Indicators:** Focus rings and selection boxes should follow the roundedness of the parent element, offset by 2px to ensure clear visibility.

## Components
- **Buttons:** Primary buttons use the accent gradient with white text. Secondary buttons are "ghost" style with a 1px border of `#2D2E35` and white text. Icon-only buttons in toolbars should have no background until hovered.
- **Inputs:** Text fields and number inputs use the Surface-high background (`#2D2E35`). On focus, they gain a 1px solid border of the Primary Accent (`#6C5CE7`).
- **Timeline Keyframes:** Diamond-shaped, 8x8px. Unselected: `#A0A0A5`. Selected: Accent Gradient.
- **Cards/Panels:** Use `#1E1F25` for the container background with a 1px border of `#2D2E35`. Headers within panels should have a bottom border of the same color.
- **Lists:** Assets and layers should be presented in tight lists (32px row height). The selected layer gets a `#6C5CE7` left-edge accent (2px width) and a subtle `#2D2E35` background highlight.
- **Scrollbars:** Minimalist design. Track is transparent; thumb is `#2D2E35` and rounds off to a pill shape.