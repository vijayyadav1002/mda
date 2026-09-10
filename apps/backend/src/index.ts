import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import mercurius from 'mercurius';
import { config } from './config.js';
import { MAX_TEXT_CONTENT_BYTES } from './services/file-types.js';
import { schema } from './graphql/schema/index.js';
import { resolvers } from './graphql/resolvers/index.js';
import { buildContext, type GraphQLContext } from './graphql/context.js';
import { db } from './db/index.js';
import { ensureAdminExists } from './services/auth.js';
import { indexMediaLibrary } from './services/media-indexer/index.js';
import { backfillCaptureDates } from './services/capture-date/index.js';
import { startMediaWatcher } from './services/media-watcher.js';
import { startWorkers } from './services/queue/index.js';
import { startCacheMaintenance } from './services/cache-maintenance/index.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './lib/session-cookie.js';
import { isProtectedMediaPath } from './lib/protected-path.js';
import { requireUser } from './lib/require-user.js';
import { shouldSlideSession } from './lib/slide-session.js';
import path from 'node:path';
import fs from 'node:fs';
import downloadRoutes from './routes/download.routes.js';
import filePreviewRoutes from './routes/file-preview.routes.js';
import imageRoutes from './routes/image.routes.js';
import videoRoutes from './routes/video.routes.js';
import compressRoutes from './routes/compress.routes.js';
import transcodeRoutes from './routes/transcode.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import queueStateRoutes from './routes/queue-state.routes.js';
import healthRoutes from './routes/health.routes.js';

const PUBLIC_GRAPHQL_FIELDS = new Set(['login', 'hasAdminUser', 'createFirstAdmin']);

function collectRootFieldNames(document: { definitions: ReadonlyArray<any> }): string[] {
  const fragments = new Map<string, any>();
  for (const def of document.definitions) {
    if (def.kind === 'FragmentDefinition') {
      fragments.set(def.name.value, def);
    }
  }

  const names: string[] = [];
  const seen = new Set<string>();

  const walk = (selections: any[], visited: Set<string>) => {
    for (const sel of selections) {
      if (sel.kind === 'Field') {
        const name = sel.name.value;
        if (!seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
      } else if (sel.kind === 'InlineFragment' && sel.selectionSet) {
        walk(sel.selectionSet.selections, visited);
      } else if (sel.kind === 'FragmentSpread') {
        const fragName = sel.name.value;
        if (visited.has(fragName)) continue;
        visited.add(fragName);
        const frag = fragments.get(fragName);
        if (frag) walk(frag.selectionSet.selections, visited);
      }
    }
  };

  for (const def of document.definitions) {
    if (def.kind === 'OperationDefinition') {
      walk(def.selectionSet.selections, new Set());
    }
  }

  return names;
}

let workerHandles: ReturnType<typeof startWorkers> | null = null;
let cacheMaintenanceTimer: ReturnType<typeof setInterval> | null = null;

const fastify = Fastify({
  logger: true,
  trustProxy: true,
  bodyLimit: MAX_TEXT_CONTENT_BYTES,
});

// Register plugins
await fastify.register(rateLimit, {
  max: 300,
  timeWindow: '1 minute',
  allowList: (request) => {
    return request.url.startsWith('/thumbnails/')
      || request.url.startsWith('/compress-preview/')
      || request.url.startsWith('/media/')
      || request.url.startsWith('/hls/');
  }
});

await fastify.register(cookie);
await fastify.register(jwt, {
  secret: config.jwtSecret,
  sign: { expiresIn: '30d' },
  cookie: { cookieName: SESSION_COOKIE_NAME, signed: false },
});

await fastify.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1GB
  }
});

// Serve thumbnails
await fs.promises.mkdir(path.resolve(config.thumbnailCachePath), { recursive: true });
await fastify.register(fastifyStatic, {
  root: path.resolve(config.thumbnailCachePath),
  prefix: '/thumbnails/'
});

const previewCachePath = path.resolve(path.dirname(config.thumbnailCachePath), 'previews');
await fs.promises.mkdir(previewCachePath, { recursive: true });

const compressPreviewPath = path.resolve(path.dirname(config.thumbnailCachePath), 'compress-preview');
await fs.promises.mkdir(compressPreviewPath, { recursive: true });

// Serve compress preview files
await fastify.register(fastifyStatic, {
  root: compressPreviewPath,
  prefix: '/compress-preview/',
  decorateReply: false,
  cacheControl: false
});

// Serve media files
await fastify.register(fastifyStatic, {
  root: path.resolve(config.mediaLibraryPath),
  prefix: '/media/',
  decorateReply: false,
  acceptRanges: true,
  cacheControl: true,
  maxAge: '1d'
});

// Serve HLS segments
const hlsCachePath = path.resolve(path.dirname(config.thumbnailCachePath), 'hls');
await fs.promises.mkdir(hlsCachePath, { recursive: true });

await fastify.register(fastifyStatic, {
  root: hlsCachePath,
  prefix: '/hls/',
  decorateReply: false
});

// Register route plugins
await fastify.register(downloadRoutes);
await fastify.register(filePreviewRoutes);
await fastify.register(imageRoutes);
await fastify.register(videoRoutes);
await fastify.register(compressRoutes);
await fastify.register(transcodeRoutes);
await fastify.register(uploadRoutes);
await fastify.register(queueStateRoutes);
await fastify.register(healthRoutes);

// GraphQL
// @ts-ignore
await fastify.register(mercurius, {
  schema,
  resolvers,
  context: buildContext,
  graphiql: process.env.NODE_ENV !== 'production'
});

fastify.graphql.addHook<GraphQLContext>('preExecution', async function (_schema, document, context) {
  const rootFields = collectRootFieldNames(document);
  const requiresUser = rootFields.some(
    (name) => name !== 'logout' && !PUBLIC_GRAPHQL_FIELDS.has(name)
  );
  if (requiresUser && !context.user) {
    throw new Error('Unauthorized');
  }

  const isPublicOnly = rootFields.every((name) => PUBLIC_GRAPHQL_FIELDS.has(name));
  if (context.user && !isPublicOnly && !rootFields.includes('logout')) {
    const token = await context.reply.jwtSign({
      id: context.user.id,
      username: context.user.username,
      role: context.user.role,
    });
    context.reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(context.request));
  }
});

fastify.addHook('onRequest', async (request, reply) => {
  const pathOnly = request.url.split('?')[0];
  if (!isProtectedMediaPath(pathOnly)) return;
  const ok = await requireUser(request, reply);
  if (!ok) return;
  if (shouldSlideSession(request.method, pathOnly)) {
    const token = await reply.jwtSign({
      id: (request.user as any).id,
      username: (request.user as any).username,
      role: (request.user as any).role,
    });
    reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(request));
  }
});

// Startup
const start = async () => {
  try {
    // Check database connection
    await db.query('SELECT NOW()');
    fastify.log.info('Database connected');

    // Ensure admin exists (first-time setup)
    await ensureAdminExists();

    // Index existing media library
    fastify.log.info('Starting initial media library indexing...');
    await indexMediaLibrary();
    fastify.log.info('Initial media library indexed');

    // Backfill capture dates for assets indexed before the timeline feature (non-blocking)
    void backfillCaptureDates().catch((error) => {
      fastify.log.error({ err: error }, 'Capture date backfill failed');
    });

    // Start file system watcher
    fastify.log.info('Starting media file watcher...');
    startMediaWatcher();

    // Transcoded videos are intentionally persistent: no inactivity cleanup.
    // Eviction is size-based only, handled by cache maintenance.

    // Start cache maintenance service
    cacheMaintenanceTimer = startCacheMaintenance();

    // Start background queue workers
    workerHandles = startWorkers();

    await fastify.listen({
      port: config.port,
      host: config.host
    });

    fastify.log.info(`Server listening on ${config.host}:${config.port}`);
    fastify.log.info(`GraphiQL available at http://${config.host}:${config.port}/graphiql`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
