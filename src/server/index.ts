import http from 'node:http';
import path from 'node:path';

import { loadConfig, validateMountDirectories } from './config.ts';
import { createRequestHandler } from './routes.ts';
import { JobRunner } from './services/jobRunner.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const mountErrors = await validateMountDirectories(config);
  if (mountErrors.length > 0) {
    process.stderr.write(`Mount warnings:\n${mountErrors.join('\n')}\n`);
  }

  const runner = new JobRunner(config);
  await runner.init();

  const distDir = path.resolve(process.cwd(), 'dist');
  const server = http.createServer(createRequestHandler(runner, distDir));

  server.listen(config.appPort, '0.0.0.0', (): void => {
    process.stdout.write(
      `Plex Video Organizer listening on http://0.0.0.0:${String(config.appPort)}\n`
    );
  });
}

void main();
