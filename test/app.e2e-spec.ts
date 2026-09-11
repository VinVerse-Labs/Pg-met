import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { IsEmail, IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// Exercises a real DTO through the globally-registered ValidationPipe. No
// business module exists yet in Phase 0, so a throwaway controller stands
// in purely to prove the global pipe/filter wiring behaves as intended.
class SampleDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  name!: string;
}

@Controller('__test-only')
class SampleController {
  @Post()
  create(@Body() dto: SampleDto) {
    return dto;
  }
}

describe('Application bootstrap (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [SampleController],
    })
      // No real database is required to prove routing, validation and the
      // global error envelope are wired correctly.
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        enableShutdownHooks: jest.fn(),
        $queryRaw: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('applies the global /api/v1 prefix', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });

  it('returns a consistent error envelope for unknown routes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'NOT_FOUND' }),
        requestId: expect.any(String),
      }),
    );
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('rejects invalid input via the global ValidationPipe', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/__test-only')
      .send({ email: 'not-an-email', name: 'a' })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      }),
    );
  });

  it('rejects requests containing fields not declared on the DTO', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/__test-only')
      .send({ email: 'student@example.com', name: 'Asha', extra: 'nope' })
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      }),
    );
  });

  it('wraps a successful response in the envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/__test-only')
      .send({ email: 'student@example.com', name: 'Asha' })
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      data: { email: 'student@example.com', name: 'Asha' },
      requestId: expect.any(String),
    });
  });
});
