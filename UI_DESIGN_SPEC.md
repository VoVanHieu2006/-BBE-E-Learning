# BBE Lead Chapter design specification — checkpoint 3

Status: the user approved the design direction, then requested final desktop/mobile before/after and actual motion evidence before global rollout. Review [the image/video comparison](docs/ui-cache-checkpoints/review.html) and [interactive specimen](docs/ui-cache-checkpoints/pilot.html). The specimen is a standalone mock with clearly labelled illustrative data; the comparison captures the actual Next Pilot with API/YouTube fixtures. Global rollout is not approved by direction approval alone.

## Product and direction

Lead Chapter needs to answer “Chapter đang học đến đâu?” and reach members, course progress or term transfer in one step. Preserve existing Vietnamese labels, logo, navigation order, Be Vietnam Pro headings, Inter body text, navy `#172554`, blue `#2563eb`, orange `#f97316` and light ground `#f8f9ff`. One Lead manages one Chapter; specimen has no multi-Chapter picker.

Impeccable context was loaded against current Dashboard. This is a scoped refinement of the incumbent system, not a replacement product or brand. Taste app run selected `accent-ladder` from two dealt candidates: blue on data/actions, pale blue areas, flat panels. Brand/spec wins over generic library choices: retain orange Star semantics and 36px desktop / 44px mobile controls. No new fonts, icon library, state library or Motion dependency changes.

BBE-specific inventory: Chapter scope; five incumbent dashboard metrics; published courses; 70% threshold; accumulated Star; member progress; course content/video/Quiz; seven-Ban roster; effective term/date; sheet parsing; current/history views; private owner draft. These determine the content. No new trend claims, charts, rankings or formulas invented for decoration.

## Opt-in tokens

All specimen styles live under `.bbe-pilot`; rollout introduces an equivalent explicit opt-in wrapper only after approval. Do not modify root tokens, Card/Button defaults or global table styling first.

| Token | Value / application |
| --- | --- |
| Text | navy headings, `#434655` body, `#596174` secondary; text contrast at least 4.5:1 |
| Font | heading 24/32px 700; section 16/24px 600; body 14/22–16/24px; caption 13/20px |
| Figures | 24–28px, tabular numbers; units explicit; no fabricated deltas |
| Space | multiples of 4px; desktop page 32px, mobile 16px; section 24px; group 8–12px |
| Surfaces | white on incumbent light ground; 1px quiet border; 12px panels, 8px controls |
| Elevation | soft offset shadow only on floating drawer/modal; flat normal panels |
| Controls | desktop minimum height 36px; mobile minimum hit area 44×44px; visible focus ring |
| Motion | CSS 180ms color/opacity; no shell transforms/filter/layout animation; reduced-motion disables nonessential animation |

1440px arithmetic: sidebar 256 + main horizontal gutters 64 + content 1120 = 1440. Five-metric strip uses equal cells with rules; no tinted icon tiles. At 390px: content 358 + two 16px gutters; title/action wrap, metrics use labelled rows, tables scroll only inside their labelled region. At 768/1024px adapt column count without truncating figures. At 360/430px and landscape preserve touch size and navigation access.

## Surface specifications

Dashboard: heading “Dashboard Lead Chapter” with separate scope line, incumbent description, outlined refresh and last successful sync. Show all five existing metrics with exact current API values. Preserve existing formulas and metric meanings. Two flat destination panels retain members/courses actions. Do not add roster or course-list GETs to populate decoration.

Courses: preserve existing course fields/actions/permissions. Share only exact dashboard-courses resource. Keep modal data lazy, and lazy-load modal code only when verified safe for video continuity. Stable row IDs and player identity; no animation-driven iframe key changes. Search/filter text, pagination and scroll remain on refresh/navigation. Specimen shows two illustrative course rows and a presentation-only content dialog.

Term Transition: retain Current, History and import flow. Current shows roster and scheduled batch state; History loads once per valid session resource; refresh targets the visible view only. Draft keeps sheet URL, parsed assignments, effective time, term and position edits. Date fields have persistent labels and local timezone context; use current backend contract for conversion. Show storage success/failure explicitly. Only confirmed applied status may announce transfer application or invalidate learning reset resources. Cancel/schedule must not claim a reset.

## Shared behavior

| Component/state | Required presentation and interaction |
| --- | --- |
| Tables | semantic caption/headers, text left and numbers right, tabular figures, quiet row rules; long names wrap; mobile labelled horizontal scroll region or equivalent stacked list |
| Tabs | labelled buttons or accessible tab pattern with roving focus/arrows; selected state visible without color alone; scoped view state survives route return |
| Forms | visible labels, correct input types, no placeholder-only instructions; inline field errors and first-invalid focus; no paste blocking |
| Initial loading | stable skeleton dimensions and busy state; do not display zero for unknown data; announce loading once |
| Refresh loading | keep previous data and layout, disable same-view button while request is pending; no page replacement or scroll reset |
| Failure | actionable message with retry; same-account stale data stays visible; update no success timestamp; authorization failure withholds private content |
| Partial failure | failed panel names its resource; successful panel may update independently; whole-view timestamp cannot imply full success |
| Empty / zero | zero only when verified response says zero; empty list says why and an appropriate next action; unknown uses dash |
| Sync time | `Intl.DateTimeFormat('vi-VN', …)`; label scope and last successful synchronization, never a render-time “just now” |
| Drawer / modal | semantic dialog, accessible name, focus containment and return, Escape, background inert/scroll lock; no player ancestor containing-block effects |
| Navigation | preserve current order and role menu; keep route/code prefetch; eliminate only Lead Chapter business prefetch in runtime Pilot |
| Keyboard | skip link, semantic anchors/buttons, focus-visible, no hover-only essential actions |

The specimen implements presentation states and accessible preview controls only. It deliberately does not persist or parse a real roster, perform a transfer, verify accounts or simulate successful application. Those require the runtime/security gates.

## Approval and rollout

Review screenshots at 1440px and 390px plus the interactive specimen (Dashboard, Courses, Current/History and form). Approve hierarchy, density, brand and mobile behavior before UI rollout across roles. Runtime Pilot must then pass all direct cache/security/video/business checks. Rollout order remains Admin → Lead DNA → Member → Guest, one patch at a time. FAIL or NOT VERIFIED on critical security/video/business blocks rollout.

Web Interface Guidelines reference: [upstream rules](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), retrieved 2026-10-27. Apply only relevant rules within scope; Vietnamese sentence case and incumbent menu take precedence over generic English copy conventions.

Checkpoint evidence and limitations: [status report](UI_UX_PERFORMANCE_FINAL_REPORT.md).
