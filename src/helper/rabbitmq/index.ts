import type { Logger } from 'pino';
import type { RabbitMqConfig } from './config.js';
import { RabbitMqConnectionService } from './rabbitmq-connection.service.js';
import { RabbitMqPublisherService } from './rabbitmq-publisher.service.js';
import { RabbitMqConsumerService } from './rabbitmq-consumer.service.js';
import { RabbitMqTopologyService } from './rabbitmq-topology.service.js';
import { RabbitMqError, type RabbitMqSubscription } from './rabbitmq.types.js';
export * from './rabbitmq.types.js';
export type { RabbitMqConfig } from './config.js';
export function createRabbitMq(config: RabbitMqConfig, logger: Logger) {
  const connection = new RabbitMqConnectionService(config, logger);
  const publisher = new RabbitMqPublisherService(connection, logger);
  const consumer = new RabbitMqConsumerService(
    connection,
    publisher,
    new RabbitMqTopologyService(),
    logger,
  );
  let started = false;
  let stopping: Promise<void> | undefined;
  return {
    register<T>(subscription: RabbitMqSubscription<T>) {
      if (stopping) throw new RabbitMqError('REGISTRATION_CLOSED');
      consumer.register(subscription);
    },
    start() {
      if (stopping) throw new RabbitMqError('STOPPING');
      if (started) return;
      started = true;
      publisher.start();
      consumer.start();
    },
    publish: publisher.publish.bind(publisher),
    getStatus: consumer.getStatus.bind(consumer),
    stop(): Promise<void> {
      if (!stopping) {
        publisher.stopAccepting();
        stopping = (async () => {
          await consumer.stopAndDrain();
          await publisher.drain();
          await connection.close();
        })();
      }
      return stopping;
    },
  };
}
