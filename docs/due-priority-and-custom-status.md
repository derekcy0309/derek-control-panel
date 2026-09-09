# Due-date priority and custom status

## One priority rule everywhere

Tasks and operating items use a derived priority band whenever they have a due date:

- overdue through day 7: high;
- day 8 through day 21: medium;
- day 22 onward: low.

The priority is calculated against the current Hong Kong date whenever the item is displayed or planned. It therefore upgrades automatically as time passes without a Cron job rewriting user data. The server also normalizes `requested_priority` whenever a dated task is created or updated.

Undated tasks retain their Urgent, Semi-urgent, or Non-urgent choice. Undated operating items store `manualUrgency` in their existing private metadata.

## Due-date control

The shared date control provides buttons for 7, 14, 21 and 30 days, a native calendar input for any date, and a clear-date action. It is used by the full and compact Task forms, Inbox processing, text/voice handover and generic operating-item forms.

## Workflow status versus display status

The constrained workflow status remains the only value used by automation:

- Task: not started, in progress, waiting, blocked, done or cancelled.
- Operating item: active, waiting, blocked, review, completed or cancelled.

An optional custom display status can be selected from previously used labels or entered as free text. It does not change scheduling or authorization. Task labels are limited to 60 characters by both the API and a database constraint. Operating-item labels are stored in existing RLS-protected metadata.

## School sensitive data

School information is sensitive when it contains information that identifies a child or exposes private details, including:

- name, class, student number, address or contact details;
- health, medication, special educational needs, assessment or results;
- identity documents, login details, or attachments that can identify the child.

Marking an item sensitive keeps notification/share previews generic and prevents attachments or linked documents from being included by default. It does not mean all ordinary school reminders are automatically shared.
