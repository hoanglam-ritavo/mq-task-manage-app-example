import { ConfirmChannel } from 'amqplib';
import { RabbitMqSubscription } from './rabbitmq.types.js';

export const RETRY_DELAYS_MS = [10_000, 60_000, 300_000] as const;

export function subscriptionTopology(queue: string) {
  return {
    exchange: `${queue}.delivery`,
    dead: `${queue}.dead`,
    retries: RETRY_DELAYS_MS.map((delay, i) => ({
      queue: `${queue}.retry.${i + 1}`,
      delay,
    })),
  };
}

export class RabbitMqTopologyService {
  async setup(
    channel: ConfirmChannel,
    subscription: Pick<RabbitMqSubscription<unknown>, 'queue' | 'bindings'>,
  ): Promise<void> {
    const { queue, bindings } = subscription;
    const topology = subscriptionTopology(queue);
    await channel.assertExchange(topology.exchange, 'direct', {
      durable: true,
    });
    const quorum = {
      'x-queue-type': 'quorum',
      'x-overflow': 'reject-publish',
      'x-delivery-limit': -1,
    };
    await channel.assertQueue(queue, { durable: true, arguments: quorum });
    await channel.bindQueue(queue, topology.exchange, queue);
    await channel.assertQueue(topology.dead, {
      durable: true,
      arguments: quorum,
    });
    await channel.bindQueue(topology.dead, topology.exchange, topology.dead);
    for (const retry of topology.retries) {
      await channel.assertQueue(retry.queue, {
        durable: true,
        arguments: {
          ...quorum,
          'x-message-ttl': retry.delay,
          'x-dead-letter-exchange': topology.exchange,
          'x-dead-letter-routing-key': queue,
          'x-dead-letter-strategy': 'at-least-once',
        },
      });
      await channel.bindQueue(retry.queue, topology.exchange, retry.queue);
    }
    for (const binding of bindings) {
      await channel.assertExchange(binding.exchange, binding.type, {
        durable: true,
      });
      await channel.bindQueue(queue, binding.exchange, binding.routingKey);
    }
  }
}
