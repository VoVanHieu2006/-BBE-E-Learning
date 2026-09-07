---
name: BBE Learning Hub
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434655'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#9d4300'
  on-secondary: '#ffffff'
  secondary-container: '#fd761a'
  on-secondary-container: '#5c2400'
  tertiary: '#465384'
  on-tertiary: '#ffffff'
  tertiary-container: '#5e6b9e'
  on-tertiary-container: '#efefff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#ffdbca'
  secondary-fixed-dim: '#ffb690'
  on-secondary-fixed: '#341100'
  on-secondary-fixed-variant: '#783200'
  tertiary-fixed: '#dce1ff'
  tertiary-fixed-dim: '#b7c4fd'
  on-tertiary-fixed: '#071747'
  on-tertiary-fixed-variant: '#374475'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 60px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Be Vietnam Pro
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Be Vietnam Pro
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  button:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0.01em
  caption:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  gutter: 24px
  margin: 64px
  container-max: 1440px
---

## Brand & Style
The design system is engineered to foster an environment of high-energy academic growth and dependable educational support for Vietnamese university students. It balances **Modern Corporate** structure with **Expressive Digital** accents to ensure the platform feels authoritative yet deeply relatable to a Gen-Z demographic.

The visual narrative centers on "Guided Momentum"—using vibrant color pops and geometric clarity to direct student focus. The aesthetic avoids the sterility of traditional enterprise software by introducing playful abstract accents and a warm secondary palette, ensuring the learning experience feels like a rewarding journey rather than a chore.

## Colors
This design system utilizes a high-contrast pairing of **Vibrant Royal Blue** and **Warm Orange** to stimulate engagement. 

- **Primary Blue (#2563EB):** Used for structural integrity, navigation, and primary branding. It represents the "Trust" pillar of the platform.
- **Secondary Orange (#F97316):** Reserved strictly for action-oriented elements (CTAs) and "Momentum" moments like achievement badges and progress highlights.
- **Navy (#172554):** Provides grounding for high-level headings and footer sections.
- **Functional Palettes:** Success Green is used for completed modules and correct answers. Neutral Gray is used for secondary metadata and borders to maintain a clean, uncluttered interface.

## Typography
The typography system leverages **Be Vietnam Pro** for headlines to provide a localized, friendly, and contemporary feel that resonates with the Vietnamese student body. **Inter** is used for all functional and body text to ensure maximum legibility during long study sessions.

- **Scale:** Maintain a clear hierarchy by using Navy (#172554) for headlines and Neutral Gray (#64748B) for secondary body text.
- **Line Height:** Generous line heights are applied to body text (1.5x+) to reduce cognitive load during reading.
- **Alignment:** Use left-alignment for educational content to assist with reading flow; center-alignment is reserved for marketing hero sections and empty states.

## Layout & Spacing
The layout follows a **12-column fluid grid** for desktop (1440px) with a 24px gutter. The spacing rhythm is strictly based on a 4px/8px baseline shift to maintain mathematical harmony.

- **Desktop:** 12 columns, 64px side margins.
- **Tablet:** 8 columns, 32px side margins.
- **Mobile:** 4 columns, 16px side margins.

Content blocks should use the `xl` (32px) or `xxl` (48px) spacing for vertical separation to maintain the "breathable" and "joyful" quality of the brand. Use `md` (16px) for internal padding within cards and components.

## Elevation & Depth
This design system employs a **Flat-Plus** approach, utilizing subtle tonal layering and soft shadows to indicate interactability without overwhelming the user.

- **Elevation-1 (Low):** `0px 4px 12px rgba(23, 37, 84, 0.08)`. Used for course cards and input fields. This depth suggests "tappability" while remaining grounded.
- **Elevation-2 (Medium):** `0px 8px 24px rgba(23, 37, 84, 0.12)`. Used for dropdown menus, popovers, and active hover states.
- **Tonal Layers:** Use Pale Blue (#EFF6FF) for background sections (like sidebar or dashboard widgets) to differentiate from the main white workspace without using heavy borders.

## Shapes
The shape language is defined by **Soft Geometric** forms. The high radius on containers evokes a friendly and safe environment for learning.

- **Course Cards & Containers:** Use a 16px (`rounded-xl` equivalent) radius to create a soft, inviting frame for content.
- **Interactive Elements:** Buttons and form inputs use an 8px (`rounded-lg` equivalent) radius to maintain a professional, sturdy feel that contrasts slightly with the softer cards.
- **Iconography:** Icons should feature rounded caps and corners to match the typography's friendly nature.

## Components

### Buttons
- **Primary Action:** Solid Orange (#F97316) with white text. High contrast for CTAs like "Đăng ký ngay" (Register Now).
- **Secondary Action:** Ghost style with Royal Blue (#2563EB) borders and text. Used for "Xem thêm" (See more).
- **Size:** Minimum touch target of 48px height for mobile accessibility.

### Cards (Course/Module)
- **Background:** White (#FFFFFF).
- **Border:** 1px solid #EFF6FF (Pale Blue) to define edges.
- **Shadow:** Elevation-1.
- **Content:** 16px padding, headline in Navy, and a progress bar in Primary Blue.

### Input Fields
- **Default State:** 8px radius, 1px border (#64748B), white background.
- **Active State:** 2px border in Primary Blue (#2563EB) with a soft blue outer glow.

### Achievement Chips
- Use the Pale Orange (#FFF7ED) background with bold Orange text for tags like "Mới" (New) or "Hoàn thành" (Completed).

### Abstract Accents
- Use geometric shapes (circles and triangles) in low-opacity Primary Blue or Orange as background watermarks to break up white space and add "energy" to the layout.