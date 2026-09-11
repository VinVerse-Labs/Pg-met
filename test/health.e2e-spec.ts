import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Health endpoint (e2e)', () => {
  let app: INestApplication;
  let queryRaw: jest.Mock;

  beforeAll(async () => {
    queryRaw = jest.fn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        enableShutdownHooks: jest.fn(),
        $queryRaw: queryRaw,
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports healthy and returns the raw Terminus payload when the database responds', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        info: expect.objectContaining({
          database: { status: 'up' },
        }),
      }),
    );
    // Health responses are intentionally NOT wrapped in the success envelope.
    expect(response.body.data).toBeUndefined();
  });

  it('reports unhealthy with a 503 when the database is unreachable', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection refused'));

    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);

    // A failing check still throws, so - unlike the success path - it goes
    // through the standard error envelope. The full Terminus payload is
    // preserved underneath so nothing useful is lost.
    expect(response.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'SERVICE_UNAVAILABLE',
          details: expect.objectContaining({
            error: expect.objectContaining({
              database: expect.objectContaining({ status: 'down' }),
            }),
          }),
        }),
      }),
    );
  });
});
