export interface RabbitMqConfig {
  enabled: boolean;
  host: string;
  port: number;
  username?: string;
  password?: string;
  vhost: string;
  tlsEnabled: boolean;
  prefetch: number;
  publishTimeoutMs: number;
  maxInFlight: number;
  heartbeatSeconds: number;
  reconnectSeconds: number;
}
