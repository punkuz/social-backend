import { createHash, createHmac, randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const urls = required('SOCKET_URLS').split(',').map((value) => value.trim());
const conversationId = required('CONVERSATION_ID');
const jwtSecret = required('JWT_SECRET');
const connections = positiveInteger('CONNECTIONS', 100);
const messagesPerSecond = positiveInteger('MESSAGES_PER_SECOND', 100);
const durationSeconds = positiveInteger('DURATION_SECONDS', 30);
const userIdStart = positiveInteger('USER_ID_START', 100_000);
const sockets = [];
const pending = new Map();
const latencies = [];
let sent = 0;
let accepted = 0;
let errors = 0;

try {
  for (let index = 0; index < connections; index += 1) {
    const userId = userIdStart + index;
    const socket = io(`${urls[index % urls.length]}/chat`, {
      auth: { token: token(userId) },
      reconnection: false,
      transports: ['websocket'],
    });
    sockets.push(socket);
    await waitFor(socket, 'chat.connected', 15_000);
    const joined = waitFor(socket, 'chat.joined', 15_000);
    socket.emit('chat.join', { conversationId });
    await joined;
    socket.on('chat.message.sent', ({ messageId }) => {
      accepted += 1;
      const startedAt = pending.get(messageId);
      if (startedAt) latencies.push(Date.now() - startedAt);
      pending.delete(messageId);
    });
    socket.on('chat.error', () => {
      errors += 1;
    });
  }

  const intervalMs = Math.max(1, Math.floor(1_000 / messagesPerSecond));
  const deadline = Date.now() + durationSeconds * 1_000;
  while (Date.now() < deadline) {
    const socket = sockets[sent % sockets.length];
    const clientMessageId = `load-${randomUUID()}`;
    const messageId = createHash('sha256')
      .update(`${userIdStart + (sent % sockets.length)}:${clientMessageId}`)
      .digest('hex');
    pending.set(messageId, Date.now());
    socket.emit('chat.send', {
      clientMessageId,
      conversationId,
      content: `Load test message ${sent}`,
    });
    sent += 1;
    await delay(intervalMs);
  }
  await delay(3_000);

  latencies.sort((left, right) => left - right);
  process.stdout.write(
    `${JSON.stringify({ connections, sent, accepted, errors, p50Ms: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95), p99Ms: percentile(latencies, 0.99) })}\n`,
  );
} finally {
  for (const socket of sockets) socket.disconnect();
}

function token(userId) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      id: userId,
      username: `load-user-${userId}`,
      role: 'user',
      iat: Math.floor(Date.now() / 1_000),
      exp: Math.floor(Date.now() / 1_000) + durationSeconds + 300,
    }),
  );
  const signature = createHmac('sha256', jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function waitFor(socket, event, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      timeout,
    );
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  return values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
