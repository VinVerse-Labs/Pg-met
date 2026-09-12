import { normalizeEmail, normalizePhone } from './users.normalization';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Rahul@Example.COM  ')).toBe('rahul@example.com');
  });
});

describe('normalizePhone', () => {
  it('strips spaces, dashes and parentheses', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('(987) 654-3210')).toBe('9876543210');
  });

  it('preserves a leading + for international numbers', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
  });
});
