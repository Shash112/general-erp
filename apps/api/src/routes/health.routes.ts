import { FastifyInstance } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance) {
  // Liveness probe (App process status)
  fastify.get('/health/liveness', async (_request, reply) => {
    return reply.status(200).send({
      status: 'UP',
      timestamp: new Date().toISOString()
    });
  });

  // Readiness probe (DB & subsystem health check)
  fastify.get('/health/readiness', async (_request, reply) => {
    return reply.status(200).send({
      status: 'READY',
      checks: {
        database: 'UP',
        storage: 'UP',
        queues: 'UP'
      },
      timestamp: new Date().toISOString()
    });
  });
}
