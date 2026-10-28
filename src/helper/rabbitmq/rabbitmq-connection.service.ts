import type { Logger } from 'pino';
import {
  connect,
  ChannelWrapper,
  AmqpConnectionManager,
} from 'amqp-connection-manager';
import { ConfirmChannel, Options } from 'amqplib';
import type { RabbitMqConfig } from './config.js';
import { RabbitMqState } from './rabbitmq.types.js';

export interface ManagedRabbitChannel {
  raw?: ConfirmChannel;
  ready: boolean;
  wrapper?: ChannelWrapper;
  retry?: ReturnType<typeof setTimeout>;
  closed: boolean;
  restart: () => Promise<void>;
}

export class RabbitMqConnectionService {
  private readonly managers = new Map<
    'publisher' | 'consumer',
    AmqpConnectionManager
  >();
  private readonly slots = new Set<ManagedRabbitChannel>();
  private readonly blocked = new Set<string>();
  private stopping = false;

  constructor(
    readonly settings: RabbitMqConfig,
    private readonly logger: Logger,
  ) {}

  isBlocked(): boolean {
    return this.blocked.has('publisher');
  }

  getStatus(): RabbitMqState {
    if (!this.settings.enabled) return 'disabled';
    if (this.stopping) return 'stopping';
    if (!this.managers.size) return 'connecting';
    return [...this.managers.values()].every((m) => m.isConnected()) &&
      [...this.slots].every((s) => s.ready) &&
      !this.blocked.size
      ? 'ready'
      : 'degraded';
  }

  private manager(kind: 'publisher' | 'consumer'): AmqpConnectionManager {
    let manager = this.managers.get(kind);
    if (manager) return manager;
    const options: Options.Connect = {
      protocol: this.settings.tlsEnabled ? 'amqps' : 'amqp',
      hostname: this.settings.host,
      port: this.settings.port,
      username: this.settings.username,
      password: this.settings.password,
      // amqplib 2.2.0 decodes object-form vhost once, just like a URL pathname.
      vhost: encodeURIComponent(this.settings.vhost),
    };
    manager = connect([options], {
      heartbeatIntervalInSeconds: this.settings.heartbeatSeconds,
      reconnectTimeInSeconds: this.settings.reconnectSeconds,
      connectionOptions: { timeout: this.settings.publishTimeoutMs },
    });
    this.managers.set(kind, manager);
    manager.on('connect', () => {
      this.blocked.delete(kind);
      this.logger.info({ event: 'rabbitmq_connected', kind });
    });
    manager.on('disconnect', () => {
      this.blocked.delete(kind);
      this.logger.warn({ event: 'rabbitmq_disconnected', kind });
    });
    manager.on('connectFailed', () =>
      this.logger.warn({ event: 'rabbitmq_connect_failed', kind }),
    );
    manager.on('blocked', () => {
      this.blocked.add(kind);
      this.logger.warn({ event: 'rabbitmq_blocked', kind });
    });
    manager.on('unblocked', () => {
      this.blocked.delete(kind);
    });
    manager.on('error', () =>
      this.logger.error({ event: 'rabbitmq_connection_error', kind }),
    );
    return manager;
  }

  open(
    kind: 'publisher' | 'consumer',
    name: string,
    setup: (channel: ConfirmChannel) => Promise<void>,
  ): ManagedRabbitChannel {
    const slot: ManagedRabbitChannel = {
      ready: false,
      closed: false,
      restart: async () => {
        slot.ready = false;
        slot.raw = undefined;
        await slot.wrapper?.close().catch(() => undefined);
        slot.wrapper = undefined;
        schedule();
      },
    };
    const schedule = () => {
      if (this.stopping || slot.closed || slot.retry) return;
      slot.retry = setTimeout(() => {
        slot.retry = undefined;
        create();
      }, this.settings.reconnectSeconds * 1000);
    };
    const create = () => {
      if (this.stopping || slot.closed || !this.settings.enabled) return;
      const wrapper = this.manager(kind).createChannel({
        name,
        confirm: true,
        setup: async (raw: ConfirmChannel) => {
          if (this.stopping || slot.closed) return;
          slot.raw = raw;
          slot.ready = false;
          raw.on('error', () => undefined); // Never log driver errors/credentials/payloads.
          raw.once('close', () => {
            if (slot.raw !== raw) return;
            slot.raw = undefined;
            slot.ready = false;
            void slot.restart();
          });
          try {
            await setup(raw);
            if (slot.raw === raw && !slot.closed && !this.stopping)
              slot.ready = true;
          } catch {
            this.logger.error({
              event: 'rabbitmq_setup_failed',
              channel: name,
            });
            if (slot.raw === raw) void slot.restart();
            throw new Error('RabbitMQ channel setup failed');
          }
        },
      });
      slot.wrapper = wrapper;
      wrapper.on('error', () => undefined);
    };
    this.slots.add(slot);
    create();
    return slot;
  }

  async close(): Promise<void> {
    this.stopping = true;
    for (const slot of this.slots) {
      slot.closed = true;
      slot.ready = false;
      clearTimeout(slot.retry);
    }
    await Promise.allSettled([...this.slots].map((s) => s.wrapper?.close()));
    await Promise.allSettled([...this.managers.values()].map((m) => m.close()));
    this.slots.clear();
    this.managers.clear();
  }
}
