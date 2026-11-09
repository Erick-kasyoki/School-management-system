# Timetable: school-day schedule (time + lesson instead of period)

The timetable now follows the real school day. Rows are shown by **time** and **lesson** (Lesson 1–9);
assembly, break, lunch, games and revision appear as fixed bands across the week.

| Time | Activity |
|---|---|
| 8:00–8:20 | Assembly / Morning Parade |
| 8:20–9:00 / 9:00–9:40 / 9:40–10:20 | Lessons 1–3 |
| 10:20–10:40 | Break |
| 10:40–11:20 / 11:20–12:00 / 12:00–12:40 | Lessons 4–6 |
| 12:40–1:40 | Lunch Break |
| 1:40–2:20 / 2:20–3:00 / 3:00–3:40 | Lessons 7–9 |
| 3:40–4:20 | Games / Creative Activities |
| 4:20–5:00 | Revision / Class Duties / Departure |

Files
- `js/views/timetable.js` — new `TT_SCHEDULE`; grid, list view, CSV, print, slot editor, clash messages and generator say Time/Lesson; generator is 1–9 lessons a day (default 9).
- `api/handlers/profile.php` — `PROFILE_SCHEDULE` (keep in step with `TT_SCHEDULE`); My Profile week grid and "Schedule" text use the same times.
- `js/views/my-profile.js`, `css/profile.css` — week grid shows time/lesson and the fixed bands.
- `js/crud/schemas.js` — "Periods / Week" label is now "Lessons / Week".
- `index.html` — band styles; cache-busting versions bumped.

Data is unchanged: a lesson is still stored with `period` = lesson number (1–9), so existing timetables keep working.
To change the day later, edit `TT_SCHEDULE` (JS) and `PROFILE_SCHEDULE` (PHP).
