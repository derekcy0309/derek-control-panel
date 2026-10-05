# Task Action Queue

## Purpose

The Tasks page reduces scanning and decision load. It shows one category at a time (`Personal`, `Family`, `SEC`, or `Wecare`) and keeps the existing private, household, and explicit-share access rules unchanged.

## Date and urgency

Ordinary tasks do not require a due date. When the due date is empty, the form exposes three simple urgency choices using the existing `requested_priority` field:

- `Urgent` → priority 1
- `Semi-urgent` → priority 3
- `Non-urgent` → priority 5

Request Duty and confirmed schedules retain their own date requirements. A task due date is an internal deadline and is not a confirmed schedule.

## Action groups

The page opens these sections by default and shows up to five tasks in each:

1. overdue;
2. due today through day 7;
3. undated urgent work.

Each group can expand to show all items. Day 8–14, day 15 onward, undated semi-urgent, undated non-urgent, Waiting, Blocked, and completed/cancelled sections start collapsed. Waiting and Blocked tasks are separated before date bucketing so that work outside the user's control never flashes as a runnable overdue task.

All undated work is kept together near the top: Urgent appears in the primary action group, followed immediately by collapsed Semi-urgent and Non-urgent groups. Dated follow-up and status groups come afterwards. The due-task calendar is the final on-screen section, so it does not push actionable lists below the fold.

Colour is functional as well as visual: overdue is rose, imminent work amber, 8–14 day work blue, undated urgency orange/violet/green, Waiting cyan, and Blocked slate. Personal, Family, SEC, and Wecare selectors use separate colour families. Animation remains limited to the overdue attention dot and respects reduced-motion preferences.

## Calendar boundary

The due-task calendar is the final section and is an internal view of unfinished tasks with `due_date`. It does not use AI `planned_date` and never syncs ordinary tasks to Google Calendar. The existing rule remains: only explicitly confirmed schedules can sync to a selected Google Calendar.

## Print

The Tasks page prints the selected category as a compact A4 portrait action list. Navigation, buttons, cards, and the on-screen calendar are excluded. The print sheet contains all unfinished groups rather than only the five-item screen preview.

## Unified entry and Today (2026-10-05)

The global `新增任務` button is the single task-creation entry. It opens the full shared TaskForm; the separate compact quick-add flow and duplicate dashboard/list creation buttons have been removed. `Quick Capture` remains an Inbox capture workflow.

New tasks can explicitly select `今日要做`. The create endpoint saves the user's existing planning metadata and the UI refreshes that related state after success. Existing tasks can be searched and added directly inside `今日全部`; the picker excludes completed, waiting and blocked work and shows at most eight matches. Manual Today inclusion leaves task deadlines unchanged.

The work-date CHECK helper originally lacked EXECUTE for `authenticated`, causing SQL 42501 when a user saved selected work dates. Migration `20261005150500_task_work_schedule_validation_grant.sql` grants only that immutable date validator; no RLS or task data changes. An authenticated transaction verified insert, update and rejection of out-of-range dates, then rolled back all test data. Its rollback file restores the old grant state but would also restore the write failure, so prefer retaining this grant when rolling back only the UI.

Older create-task clients may omit work-schedule fields entirely; omitted fields now normalize to null and retain ordinary task behavior.
