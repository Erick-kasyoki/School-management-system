# Staff Chat (live channels)

**Where:** sidebar → Communication → **Staff Chat** (also the *Internal Chat* tab inside Messaging & Broadcasts).
Staff accounts only — student and parent accounts never see it, and the API refuses them.

## What it does
- **Channels.** A default public **Staff Room** (all staff) is created automatically. Anyone can make a **private** channel and pick the
  colleagues in it; only moderators can make another public one. Everyone in a channel can talk to everyone else in it.
- **Choose the recipient.** The *To:* bar under the message box is **Everyone** by default. Tap **＋ Choose people** to send to one or
  several colleagues instead — that message is **private**: only you and those people can see it. Clicking a colleague's name in the
  chat also sets them as the recipient. The choice sticks until you change it, and the box always says who it is going to.
- **Recipient feedback.** Under a message sent to you: **👍 Got it · ✅ Done · ❓ Need details · 🚫 Can't do** (tap again to withdraw),
  plus **↩ Reply**. The sender sees, live, per person: ✓ Sent → 👁 Seen → their answer. On messages to everyone, feedback is shown
  as totals (hover for who). Feedback buttons on everyone-messages appear after tapping *Give feedback*.
- **End session & clear.** The channel's **host** (or a moderator) can press **⛔ End session & clear**: the session ends for everyone,
  and every message and all feedback is deleted permanently. Members see "Session ended" within a few seconds. The host/moderator can
  then **▶ Start new session** (session number goes up). The Staff Room has no host, so only moderators can end it.
- **Clear my view.** Anyone can hide the history on their own screen; other people keep theirs.
- **Live.** The screen polls every ~2.5 s (10 s if the browser tab is in the background). Shows who is online, unread counts per
  channel, a badge on the sidebar item, and `(n)` in the tab title when messages arrive in a background tab.
- Ending / creating / restarting sessions is written to the **Audit Log** (message text is never logged).

## Files
- new: `api/handlers/chat.php`, `js/views/chat.js`, `css/chat.css`
- edited: `schema.sql` (4 tables), `api/index.php` (10 routes), `api/rbac.php` (new permission `chat.moderate`),
  `js/nav.js`, `js/shell.js`, `js/views/messaging.js`, `index.html`

## To install
1. Re-run `schema.sql` (safe to re-run; adds `chat_channels`, `chat_members`, `chat_messages`, `chat_receipts`).
2. Copy the files over your project. No config changes.
3. **Moderator permission:** new installs give `chat.moderate` to Principal, Deputy Principal and Administrator (Super Administrator
   always has it). On an existing database the roles are already saved, so tick **"Staff chat: end and clear any channel"** under
   Administration → Roles for any role that should moderate. Everybody can chat without it.

## Notes
- Chat is private-by-design between colleagues but is **not end-to-end encrypted**; anyone with database access can read it.
- Polling runs on plain PHP/Apache — no extra service to install. It releases the PHP session lock on each poll so it never slows
  the rest of the app.
