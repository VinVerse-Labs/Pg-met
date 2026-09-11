import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { JsonLoggerService } from './common/logger/json-logger.service';
import { PrismaService } from './database/prisma.service';
import { AppConfig } from './config/configuration';

const BODY_SIZE_LIMIT = '1mb';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new JsonLoggerService(),
  });

  const configService = app.get(ConfigService);
  const { port, nodeEnv, corsOrigins } = configService.get<AppConfig>('app')!;

  app.use(helmet());
  app.use(compression());
  app.use(json({ limit: BODY_SIZE_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('PG Management API')
      .setDescription(
        'Backend API for the PG (Paying Guest) management SaaS platform.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);
}

bootstrap();
