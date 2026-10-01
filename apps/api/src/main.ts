import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // The Next.js app calls this API from the browser, so it needs an explicit origin.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });

  /*
   * Big enough for a reference image the model lab uploads as a data URI (a 1024² PNG is ~1.5 MB,
   * base64 adds a third). Express's 100 kB default refused it with a 413 nobody would connect to the
   * picture. Every other body here is a few kilobytes of JSON.
   */
  app.useBodyParser('json', { limit: '15mb' });

  /*
   * Loopback only, unless `HOST` says otherwise. There is no authentication, so bound to every
   * interface — which `listen(port)` with no host does, whatever the log line said — anybody on the
   * same network could read and edit every plan and spend the Anthropic and Meshy keys. The model
   * library's generation endpoints spend real credits, which is what made this the first thing to
   * fix. A phone on the LAN will need an explicit `HOST` and, before that, read-only share links.
   */
  // `.env` is read once, here at boot: `nest start --watch` restarts on a source change, not on an
  // edit to `.env`, so switching `MODEL_GENERATION_ENABLED` on needs a restart of the API.
  const port = process.env.PORT ?? 3001;
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
  console.log(`Garden Studio API listening on http://${host}:${port}`);
}

bootstrap();
