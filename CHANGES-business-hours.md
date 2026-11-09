# Business hours & calendar targets (Settings)

New card in **School Settings** (below school details/logo, above Theme): timezone, daily start/end,
response target (hours), breach warning %, working days, holidays/exempt dates.

- Defaults come from your data: hours = timetable school day (08:00–17:00), days = timetable days (Mon–Fri),
  holidays = every Calendar & Events entry of type "Holiday" (kept in sync, not copied).
- Saved in `DB.settings.businessHours` (no schema change).
- Approvals inbox has a new "Open (working time)" column: pending requests show time open counting only
  business hours, turning amber at the warning % and red once past the target.
- Files: `js/views/business-hours.js`, `css/business-hours.css`; edited `settings-approvals.js`, `index.html`.
