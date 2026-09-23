import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './shared/errors/api-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown properties instead of rejecting them, and coerce query
      // strings into the declared DTO types.
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());

  const corsOrigins = config
    .get<string>('CORS_ORIGIN')
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins?.length) {
    app.enableCors({ origin: corsOrigins });
  }
  
  app.enableShutdownHooks();

  await app.listen(config.get('PORT') ?? 3000);
}
await bootstrap();
