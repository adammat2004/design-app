import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // The Next.js app calls this API from the browser, so it needs an explicit origin.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Garden Studio API listening on http://localhost:${port}`);
}

bootstrap();
