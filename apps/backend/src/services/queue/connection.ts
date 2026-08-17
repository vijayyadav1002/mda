import { config } from '../../config.js';

export const connection = {
    host: config.redisHost,
    port: config.redisPort
};
