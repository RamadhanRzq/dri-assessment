import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AttributeQueryPipe } from './modules/listings/attribute-query.pipe.js';
import { ApiExceptionFilter } from './shared/errors/api-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Registered before ValidationPipe: it turns `attr.*` parameters into the
  // `attributes` object the DTO declares, and `whitelist` would otherwise strip
  // them as unknown properties before validation ever saw them.
  app.useGlobalPipes(
    new AttributeQueryPipe(),
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

  // OpenAPI document and Swagger UI at /docs, JSON at /docs-json.
  // Skipped under test so the e2e suites do not pay for it.
  if (config.get('NODE_ENV') !== 'test') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Automotive Marketplace API')
        .setDescription(
          'Vehicle listings with filtering, sorting, and keyset pagination. ' +
            'Every error uses one envelope: `{ error: { code, message, details? } }`.',
        )
        .setVersion('1.0')
        .build(),
    );
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs-json',
    });
  }

  // Let in-flight requests finish before the database pool is torn down.
  app.enableShutdownHooks();

  await app.listen(config.get('PORT') ?? 3000);
}
await bootstrap();
