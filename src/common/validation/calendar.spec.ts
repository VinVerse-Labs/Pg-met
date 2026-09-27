import {
  calendarDateInTimeZone,
  isCalendarDate,
  isIanaTimeZone,
} from './calendar';

describe('calendar helpers', () => {
  it('accepts only real YYYY-MM-DD calendar dates', () => {
    expect(isCalendarDate('2026-09-27')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false); // not a leap year
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-9-27')).toBe(false);
    expect(isCalendarDate('2026-09-27T00:00:00Z')).toBe(false);
    expect(isCalendarDate('not-a-date')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
    expect(isCalendarDate(undefined)).toBe(false);
    expect(isCalendarDate(20260927)).toBe(false);
  });

  it('validates IANA timezones', () => {
    expect(isIanaTimeZone('Asia/Kolkata')).toBe(true);
    expect(isIanaTimeZone('Asia/Dubai')).toBe(true);
    expect(isIanaTimeZone('UTC')).toBe(true);
    expect(isIanaTimeZone('Mars/Olympus')).toBe(false);
    expect(isIanaTimeZone('')).toBe(false);
    expect(isIanaTimeZone(42)).toBe(false);
  });

  it('derives the property-local date, not the UTC date', () => {
    // 2026-09-27 00:30 IST == 2026-09-26 19:00 UTC.
    const justAfterMidnightIst = new Date('2026-09-26T19:00:00Z');
    expect(calendarDateInTimeZone(justAfterMidnightIst, 'Asia/Kolkata')).toBe(
      '2026-09-27',
    );
    expect(calendarDateInTimeZone(justAfterMidnightIst, 'UTC')).toBe(
      '2026-09-26',
    );
    // 05:29 IST is still the same IST day; 18:29 UTC the day before.
    expect(
      calendarDateInTimeZone(new Date('2026-09-26T23:59:00Z'), 'Asia/Kolkata'),
    ).toBe('2026-09-27');
    // A timezone west of UTC goes the other way.
    expect(
      calendarDateInTimeZone(
        new Date('2026-09-27T02:00:00Z'),
        'America/New_York',
      ),
    ).toBe('2026-09-26');
  });
});
