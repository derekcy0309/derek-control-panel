# Navigation simplification

## Product rule

The sidebar should answer one question first: what does the user need to open every day? Less frequent views remain available, but are collapsed until needed. No route or user data is deleted by this change.

## Primary daily loop

The always-open `每日使用` group contains:

- 今日: choose what to do now.
- 任務: review and act on the full task queue.
- 收集箱: process captured input.

Quick Capture remains the `+` button in the top bar. It creates Inbox input, while Inbox processes it, so they are sequential actions rather than duplicate stores.

## Consolidated overlaps

- `/sharing` previously appeared twice as `交辦中心` and `分享中心`. It now has one entry, `交辦及分享`.
- 今日、任務、死線 and 日曆 are views over related planning data, not four primary workflows. 今日 and 任務 remain primary; 死線 and 日曆 move into the collapsed `計劃與跟進` group.
- Request Duty remains a shortcut because it has a distinct completion rule, but it is grouped with planning and follow-up instead of appearing as a general task store.
- Body Double and Weekly Review remain available under `協作與檢視`; they are supporting modes, not daily navigation priorities.
- SOP and personal Documents no longer appear in navigation. Their existing routes and records are preserved, so this is reversible and non-destructive.
- Personal Finance remains an independent data area but now appears inside `個人`.
- `系統設定` is the final group and contains Global Search, Settings and, for administrators only, Account Activity.

## Sidebar groups

1. 每日使用 — open by default.
2. 計劃與跟進 — open automatically when one of its routes is active.
3. 協作與檢視 — open automatically when active.
4. 家庭 — collapsed until needed.
5. 個人 — collapsed until needed.
6. 系統設定 — collapsed until needed.

The current active route always reopens its group, so simplification does not hide the user's current location.
