import { registerDecorator, ValidationOptions } from 'class-validator';

// Calendar dates vs instants: a menu day, a billing day or a visit day is a
// *calendar date* (YYYY-MM-DD, no time, no zone) - "today" for such a date is
// only meaningful relative to a place. These helpers derive a property's
// local calendar date from an instant using the property's IANA timezone,
// so "today" never silently means "today in UTC" (which, for an Indian
// property, is yesterday between 00:00 and 05:30 IST).

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A real, round-trippable calendar date: well-formed AND not impossible
// (2026-02-30 is rejected, unlike `new Date()`, which silently rolls it over).
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// The calendar date (YYYY-MM-DD) that `instant` falls on in `timeZone`.
export function calendarDateInTimeZone(
  instant: Date,
  timeZone: string,
): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function IsCalendarDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a valid calendar date (YYYY-MM-DD)`,
        ...options,
      },
      validator: { validate: (value: unknown) => isCalendarDate(value) },
    });
}

export function IsIanaTimeZone(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isIanaTimeZone',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be an IANA timezone such as Asia/Kolkata`,
        ...options,
      },
      validator: { validate: (value: unknown) => isIanaTimeZone(value) },
    });
}
