import test from "node:test";
import assert from "node:assert/strict";
import { calendarView, notificationBody, shareIncludes } from "../lib/privacy.ts";

const event = { title: "Suki 私人覆診", start: "2026-07-22T10:00", end: "2026-07-22T11:00", location: "診所", participant: "醫生", category: "健康", notes: "私人內容" };
test("busy only hides all event detail", () => assert.deepEqual(calendarView(event, "busy", false), { start: event.start, end: event.end, title: "忙碌" }));
test("private calendar event is invisible", () => assert.equal(calendarView(event, "private", false), null));
test("title and time hides location notes and participants", () => assert.deepEqual(calendarView(event, "title_time", false), { start: event.start, end: event.end, title: event.title }));
test("owner sees full calendar event", () => assert.deepEqual(calendarView(event, "busy", true), event));
test("health notification is generic", () => assert.equal(notificationBody("health", "藥物名稱"), "你今日有一項健康行政事項"));
test("document notification hides reference", () => assert.equal(notificationBody("document"), "一項私人文件即將到期"));
test("assignment notification names actor only", () => assert.equal(notificationBody("assignment", "Suki"), "Suki 指派了一項工作給你"));
test("sensitive share strips attachments and linked documents", () => assert.deepEqual(shareIncludes({ sensitive: true, includeAttachments: true, includeLinkedDocuments: true, includeComments: true, includeSubtasks: true }), { includeAttachments: false, includeLinkedDocuments: false, includeComments: true, includeSubtasks: true }));
test("normal share preserves explicit choices", () => assert.deepEqual(shareIncludes({ sensitive: false, includeAttachments: true, includeLinkedDocuments: false, includeComments: false, includeSubtasks: true }), { includeAttachments: true, includeLinkedDocuments: false, includeComments: false, includeSubtasks: true }));
