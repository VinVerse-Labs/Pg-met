import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { WeekMenuQueryDto } from './week-menu.query.dto';

const errorsFor = (query: Record<string, unknown>) =>
  validateSync(plainToInstance(WeekMenuQueryDto, query));

describe('WeekMenuQueryDto', () => {
  it('accepts a valid calendar date', () => {
    expect(errorsFor({ startDate: '2026-09-28' })).toHaveLength(0);
  });

  it.each([
    ['missing', {}],
    ['empty', { startDate: '' }],
    ['malformed', { startDate: '28-09-2026' }],
    ['not a date', { startDate: 'next-week' }],
    ['impossible', { startDate: '2026-02-30' }],
    ['with a time', { startDate: '2026-09-28T00:00:00Z' }],
  ])('rejects a %s startDate', (_label, query) => {
    const errors = errorsFor(query);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('startDate');
  });
});
