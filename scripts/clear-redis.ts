import Redis from 'ioredis';

async function clearRedis() {
  if (!process.env.REDIS_URL) {
    console.error('❌ REDIS_URL environment variable is not set');
    process.exit(1);
  }

  const redis = new Redis(process.env.REDIS_URL);

  try {
    console.log('Clearing Redis cache...');
    await redis.flushdb();
    console.log('✅ Redis cache cleared successfully');
  } catch (error) {
    console.error('❌ Error clearing Redis cache:', error);
  } finally {
    redis.disconnect();
  }
}

clearRedis();
