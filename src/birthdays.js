import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";

const validRelationships = new Set(["family", "students", "colleagues", "friends", "other"]);
const nameColumns = ["name", "studentname", "fullname", "student", "pupilname", "englishname"];
const dateColumns = ["birthday", "birthdate", "dob", "dateofbirth", "birth"];

function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeRelationship(value) {
  const relationship = String(value || "students").trim().toLowerCase();
  return validRelationships.has(relationship) ? relationship : "other";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateKeyFromParts(year, month, day) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return "";
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function normalizeBirthdayDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dateKeyFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return dateKeyFromParts(parsed.y, parsed.m, parsed.d);
    }
  }

  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    return dateKeyFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    return dateKeyFromParts(year, Number(dmy[2]), Number(dmy[1]));
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return dateKeyFromParts(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
  }

  return "";
}

function normalizeBirthday(input) {
  const name = String(input.name || "").trim();
  if (!name) {
    const error = new Error("name is required");
    error.statusCode = 400;
    throw error;
  }

  const birthdate = normalizeBirthdayDate(input.birthdate || input.birthday || input.dob);
  if (!birthdate) {
    const error = new Error("birthdate is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    id: input.id || randomUUID(),
    name,
    birthdate,
    relationship: normalizeRelationship(input.relationship),
    tags: normalizeTags(input.tags),
    notes: String(input.notes || "").trim(),
    notify_days_before: Number.isInteger(Number(input.notify_days_before)) ? Number(input.notify_days_before) : 0,
    active: input.active !== false,
    source: String(input.source || "manual").trim(),
    created_at: input.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((cell) => String(cell).trim())) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => String(cell).trim())) {
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header) => String(header).trim());
  return rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
  );
}

function rowsFromUpload({ filename, contentBase64 }) {
  const extension = String(filename || "").toLowerCase().split(".").pop();
  const buffer = Buffer.from(String(contentBase64 || ""), "base64");

  if (extension === "csv") {
    return parseCsv(buffer.toString("utf8"));
  }

  if (["xlsx", "xls"].includes(extension)) {
    const workbook = XLSX.read(buffer, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return [];
    }
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true });
  }

  const error = new Error("file must be CSV or Excel");
  error.statusCode = 400;
  throw error;
}

function columnFor(headers, candidates) {
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  for (const candidate of candidates) {
    if (normalized.has(candidate)) {
      return normalized.get(candidate);
    }
  }
  return "";
}

function parseBirthdayImport(payload) {
  const rows = rowsFromUpload(payload);
  if (!rows.length) {
    return { birthdays: [], skipped: [{ row: 0, reason: "No rows found" }] };
  }

  const headers = Object.keys(rows[0] || {});
  const nameColumn = columnFor(headers, nameColumns);
  const dateColumn = columnFor(headers, dateColumns);

  if (!nameColumn || !dateColumn) {
    const error = new Error("Could not find name and birthdate columns");
    error.statusCode = 400;
    throw error;
  }

  const importedAt = new Date().toISOString();
  const batchTag = String(payload.batchTag || "").trim();
  const extraTags = normalizeTags(payload.tags);
  const tags = [...new Set([batchTag, ...extraTags].filter(Boolean))];
  const relationship = normalizeRelationship(payload.relationship);
  const notifyDays = Number.isInteger(Number(payload.notify_days_before)) ? Number(payload.notify_days_before) : 0;
  const birthdays = [];
  const skipped = [];

  rows.forEach((row, index) => {
    try {
      birthdays.push(
        normalizeBirthday({
          name: row[nameColumn],
          birthdate: row[dateColumn],
          relationship,
          tags,
          notify_days_before: notifyDays,
          source: `import:${payload.filename || "upload"}`,
          created_at: importedAt
        })
      );
    } catch (error) {
      skipped.push({ row: index + 2, reason: error.message });
    }
  });

  return { birthdays, skipped };
}

function nextBirthdayDate(birthday, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const [, month, day] = birthday.birthdate.split("-");
  const currentYear = now.getUTCFullYear();
  let next = `${currentYear}-${month}-${day}`;
  if (next < today) {
    next = `${currentYear + 1}-${month}-${day}`;
  }
  return next;
}

function daysBetween(startKey, endKey) {
  const start = new Date(`${startKey}T00:00:00.000Z`);
  const end = new Date(`${endKey}T00:00:00.000Z`);
  return Math.round((end - start) / 86400000);
}

function upcomingBirthdays(birthdays, now = new Date(), limit = 12) {
  return birthdays
    .filter((birthday) => birthday.active)
    .map((birthday) => ({
      ...birthday,
      next_date: nextBirthdayDate(birthday, now),
      days_until: daysBetween(now.toISOString().slice(0, 10), nextBirthdayDate(birthday, now))
    }))
    .sort((a, b) => a.next_date.localeCompare(b.next_date) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function dueBirthdayReminders(birthdays, notificationLog, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const alreadySent = new Set(
    notificationLog
      .filter((entry) => entry.sent_on === today)
      .map((entry) => `${entry.birthday_id}:${entry.reminder_for}`)
  );

  return upcomingBirthdays(birthdays, now, birthdays.length).filter((birthday) => {
    const reminderDue = birthday.days_until >= 0 && birthday.days_until <= birthday.notify_days_before;
    return reminderDue && !alreadySent.has(`${birthday.id}:${birthday.next_date}`);
  });
}

export {
  dueBirthdayReminders,
  normalizeBirthday,
  parseBirthdayImport,
  upcomingBirthdays,
  validRelationships
};

