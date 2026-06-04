// scripts/dev-db.mjs
// Start een ECHTE (embedded) PostgreSQL voor lokale dev — zonder Docker.
//
// LET OP: embedded-postgres stopt de Postgres-server automatisch zodra DIT
// node-proces eindigt. Daarom blijft dit script draaien (keep-alive) en moet
// het als achtergrondproces gestart worden:
//
//   node scripts/dev-db.mjs    (run in background)
//
// De data-dir (.pgdata) is persistent: stoppen/herstarten behoudt de data.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '..', '.pgdata');

const PORT = 7432;
const USER = 'webshop';
const PASSWORD = 'webshop';
const DATABASES = ['webshop_crm', 'webshop_crm_test'];

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  port: PORT,
  user: USER,
  password: PASSWORD,
  persistent: true,
  // UTF8 + locale C: emoji/internationale tekens veilig opslaan, byte-order sort.
  // Matcht de originele docker-compose (POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C).
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: (m) => process.stdout.write(`[pg] ${m}\n`),
  onError: (m) => process.stderr.write(`[pg:err] ${m}\n`),
});

const freshCluster = !existsSync(resolve(dataDir, 'PG_VERSION'));
if (freshCluster) {
  console.log('[dev-db] initialising new cluster at', dataDir);
  await pg.initialise();
}

await pg.start();
console.log(`[dev-db] PostgreSQL listening on 127.0.0.1:${PORT}`);

for (const name of DATABASES) {
  try {
    await pg.createDatabase(name);
    console.log('[dev-db] created database', name);
  } catch {
    console.log(`[dev-db] database ${name} already exists (ok)`);
  }
}

console.log('[dev-db] READY — postgres://webshop:webshop@127.0.0.1:7432/webshop_crm');

async function stop(sig) {
  console.log(`[dev-db] ${sig} — stopping PostgreSQL...`);
  try {
    await pg.stop();
  } catch (e) {
    console.error('[dev-db] stop error', e);
  }
  process.exit(0);
}
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));

// Houd het proces in leven zodat Postgres blijft draaien.
await new Promise(() => {});
