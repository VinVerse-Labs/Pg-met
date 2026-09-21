import {
  NotificationTemplateService,
  renderTemplate,
} from './notification-template.service';
import { NotificationType } from '../enums/notification-type.enum';

describe('NotificationTemplateService', () => {
  let service: NotificationTemplateService;

  beforeEach(() => {
    service = new NotificationTemplateService();
  });

  it('substitutes {{key}} placeholders from the vars map', () => {
    const rendered = service.render(NotificationType.RESIDENCY_CHECKED_IN, {
      propertyName: 'Sunrise PG',
    });
    expect(rendered.title).toBe('Welcome to your PG');
    expect(rendered.body).toBe('You have been checked in to Sunrise PG.');
    expect(rendered.priority).toBe('NORMAL');
  });

  it('defaults priority to NORMAL when the template defines none', () => {
    const rendered = service.render(NotificationType.RESIDENCY_CHECKED_IN, {
      propertyName: 'X',
    });
    expect(rendered.priority).toBe('NORMAL');
  });

  it('honors an explicit template priority (e.g. HIGH for overdue rent)', () => {
    const rendered = service.render(NotificationType.RENT_INVOICE_OVERDUE, {
      invoiceNumber: 'INV-1',
      amount: '5000',
    });
    expect(rendered.priority).toBe('HIGH');
  });

  it('honors URGENT priority for a suspended SaaS subscription', () => {
    const rendered = service.render(
      NotificationType.SAAS_SUBSCRIPTION_SUSPENDED,
    );
    expect(rendered.priority).toBe('URGENT');
  });

  it('leaves an unmatched placeholder untouched rather than throwing', () => {
    const result = renderTemplate('Hello {{name}}, {{missing}}!', {
      name: 'World',
    });
    expect(result).toBe('Hello World, {{missing}}!');
  });

  it('renders with no vars at all when the template needs none', () => {
    const rendered = service.render(
      NotificationType.SAAS_SUBSCRIPTION_SUSPENDED,
      {},
    );
    expect(rendered.title).toBe('Subscription suspended');
  });

  it('substitutes only the {{key}} construct - plain text is never interpreted as a template (no injection surface)', () => {
    const result = renderTemplate('{{value}}', {
      value: '<script>alert(1)</script>',
    });
    expect(result).toBe('<script>alert(1)</script>');
  });
});
