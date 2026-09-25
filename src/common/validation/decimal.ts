// Money fields travel as decimal *strings* (never JS numbers) so no precision is lost before
// Prisma's Decimal. Same rule as CreateRentPlanDto: up to 10 integer digits, at most 2 decimals.
export const DECIMAL_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
