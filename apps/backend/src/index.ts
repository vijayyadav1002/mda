import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import mercurius from 'mercurius';
import { config } from './config.js';
import { schema } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';
import { buildContext } from './graphql/context.js';
import { db } from './db/index.js';
import { ensureAdminExists } from './services/auth.js';
import { indexMediaLibrary } from './services/media-indexer.js';
import { startMediaWatcher } from './services/media-watcher.js';
import { getWebCompatibleVideo, markTranscodeAccessed, startTranscodeCleanup, deleteTranscodedVideo } from './services/video-transcode.js';
import path from 'node:path';
import fs from 'node:fs';

const fastify = Fastify({
  logger: true
});

// Register plugins
await fastify.register(cors, {
  origin: true,
  credentials: true
});

await fastify.register(jwt, {
  secret: config.jwtSecret
});

await fastify.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1GB
  }
});

// Serve thumbnails
await fastify.register(fastifyStatic, {
  root: path.resolve(config.thumbnailCachePath),
  prefix: '/thumbnails/'
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

// On-demand video transcoding endpoint
fastify.get('/video/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  
  try {
    // Get video info from database
    const result = await db.query(
      'SELECT file_path, mime_type FROM media_assets WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Video not found' });
    }
    
    const { file_path, mime_type } = result.rows[0];
    
    if (!mime_type.startsWith('video/')) {
      return reply.code(400).send({ error: 'Not a video file' });
    }
    
    // Get web-compatible video (transcode if needed)
    const videoPath = await getWebCompatibleVideo(file_path, id);
    
    // Mark as accessed for cleanup tracking
    markTranscodeAccessed(videoPath);
    
    // Stream the video with range support
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = request.headers.range;
    
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Number.parseInt(parts[0], 10);
      const end = parts[1] ? Number.parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const stream = fs.createReadStream(videoPath, { start, end });
      
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', chunksize);
      reply.header('Content-Type', 'video/mp4');
      
      return reply.send(stream);
    } else {
      reply.header('Content-Length', fileSize);
      reply.header('Content-Type', 'video/mp4');
      
      const stream = fs.createReadStream(videoPath);
      return reply.send(stream);
    }
  } catch (error) {
    fastify.log.error('Error serving video:', error);
    return reply.code(500).send({ error: 'Error serving video' });
  }
});

// Delete transcoded video endpoint (called when video dialog closes)
fastify.delete('/video/:id/cleanup', async (request, reply) => {
  const { id } = request.params as { id: string };
  
  try {
    // Get video info from database
    const result = await db.query(
      'SELECT file_path, mime_type FROM media_assets WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Video not found' });
    }
    
    const { file_path, mime_type } = result.rows[0];
    
    if (!mime_type.startsWith('video/')) {
      return reply.code(400).send({ error: 'Not a video file' });
    }
    
    // Delete transcoded video if it exists
    await deleteTranscodedVideo(file_path, id);
    
    return reply.send({ success: true, message: 'Transcoded video cleaned up' });
  } catch (error) {
    fastify.log.error('Error cleaning up transcoded video:', error);
    return reply.code(500).send({ error: 'Error cleaning up transcoded video' });
  }
});

// GraphQL
await fastify.register(mercurius, {
  schema,
  resolvers,
  context: buildContext,
  graphiql: process.env.NODE_ENV !== 'production'
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
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

    // Start file system watcher
    fastify.log.info('Starting media file watcher...');
    startMediaWatcher();

    // Start transcode cleanup service
    startTranscodeCleanup();

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
