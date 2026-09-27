import { MyFoodService } from './my-food.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

// "Today" on the tenant food dashboard is the property's local calendar
// date. Between 00:00 and 05:30 IST the UTC date is still yesterday - the
// bug this guards against.
describe('MyFoodService - property-local "today"', () => {
  const user = { id: 'user-1', platformRole: 'USER' } as AuthenticatedUser;

  function build(timezone: string) {
    const menus = { findOneForDate: jest.fn().mockResolvedValue(null) };
    const service = new MyFoodService(
      { getOrCreate: jest.fn().mockResolvedValue({ enabled: true }) } as any,
      {
        getEntitlementForCaller: jest.fn().mockResolvedValue({
          context: {
            organizationId: 'org-1',
            residency: { id: 'res-1' },
            property: { id: 'prop-1', timezone },
          },
          entitlement: { includedMeals: [], subscriptionMeals: [] },
        }),
      } as any,
      menus as any,
      { findActiveIdForResidency: jest.fn().mockResolvedValue(null) } as any,
    );
    return { service, menus };
  }

  afterEach(() => jest.useRealTimers());

  it('uses the IST date just after midnight IST (UTC is still the previous day)', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-26T19:00:00Z') }); // 00:30 IST on 27th
    const { service, menus } = build('Asia/Kolkata');
    const dto = await service.getDashboard(user);
    expect(menus.findOneForDate).toHaveBeenCalledWith(
      'prop-1',
      '2026-09-27',
      true,
    );
    expect(dto.todayDate).toBe('2026-09-27');
    expect(dto.timezone).toBe('Asia/Kolkata');
  });

  it('follows each property’s own timezone rather than a hard-coded one', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-26T19:00:00Z') });
    const { service, menus } = build('Europe/London'); // 20:00 BST on 26th
    await service.getDashboard(user);
    expect(menus.findOneForDate).toHaveBeenCalledWith(
      'prop-1',
      '2026-09-26',
      true,
    );
  });
});
