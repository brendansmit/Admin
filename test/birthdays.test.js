import test from "node:test";
import assert from "node:assert/strict";
import {
  dueBirthdayReminders,
  normalizeBirthday,
  parseBirthdayImport,
  upcomingBirthdays
} from "../src/birthdays.js";

function csvBase64(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

test("imports CSV birthdays with batch and relationship tags", () => {
  const result = parseBirthdayImport({
    filename: "birthdays.csv",
    contentBase64: csvBase64("Student Name,DOB\nAlex Chen,14/05/2012\nSam Lee,2026-07-02\n"),
    relationship: "students",
    batchTag: "'27",
    notify_days_before: 2
  });

  assert.equal(result.birthdays.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.birthdays[0].name, "Alex Chen");
  assert.equal(result.birthdays[0].birthdate, "2012-05-14");
  assert.equal(result.birthdays[0].relationship, "students");
  assert.deepEqual(result.birthdays[0].tags, ["'27"]);
  assert.equal(result.birthdays[0].notify_days_before, 2);
});

test("sorts upcoming birthdays by next occurrence", () => {
  const birthdays = [
    normalizeBirthday({ name: "Later", birthdate: "2010-07-10", relationship: "friends" }),
    normalizeBirthday({ name: "Soon", birthdate: "2010-07-02", relationship: "family" })
  ];

  const upcoming = upcomingBirthdays(birthdays, new Date("2026-07-01T00:00:00.000Z"));

  assert.deepEqual(
    upcoming.map((birthday) => birthday.name),
    ["Soon", "Later"]
  );
  assert.equal(upcoming[0].next_date, "2026-07-02");
  assert.equal(upcoming[0].days_until, 1);
});

test("selects due birthday reminders once per day", () => {
  const birthday = normalizeBirthday({
    name: "Due",
    birthdate: "2010-07-03",
    relationship: "colleagues",
    notify_days_before: 2
  });

  const due = dueBirthdayReminders([birthday], [], new Date("2026-07-01T00:00:00.000Z"));
  const repeated = dueBirthdayReminders(
    [birthday],
    [{ birthday_id: birthday.id, reminder_for: "2026-07-03", sent_on: "2026-07-01" }],
    new Date("2026-07-01T00:00:00.000Z")
  );

  assert.equal(due.length, 1);
  assert.equal(repeated.length, 0);
});

