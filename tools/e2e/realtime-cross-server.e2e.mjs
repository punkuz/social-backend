import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { createClient } from 'redis';

const runId = randomUUID();
const conversationId = `e2e-${runId}`;
const jwtSecret = 'local-e2e-jwt-secret';
const ports = [3101, 3102];
const processes = [];
const clients = [];
const redis = createClient({ url: 'redis://localhost:6379' });

try {
  await redis.connect();
  const membershipKey = `chat:conversation:${conversationId}:members`;
  await redis.sAdd(membershipKey, ['1', '2']);
  await redis.expire(membershipKey, 300);

  for (const [index, port] of ports.entries()) {
    processes.push(startGateway(port, index + 1));
  }
  await Promise.all(ports.map(waitForReadiness));
  await delay(2_000);

  const userA = createSocket(ports[0], token(1));
  clients.push(userA);
  const connectedA = waitForEvent(userA, 'chat.connected');
  userA.connect();
  await connectedA;

  const snapshot = waitForEvent(userA, 'presence.snapshot');
  userA.emit('presence.subscribe', { userIds: [2] });
  await snapshot;

  const userBOnline = waitForEvent(
    userA,
    'presence.changed',
    (event) => event.userId === 2 && event.online === true,
  );
  const userB = createSocket(ports[1], token(2));
  clients.push(userB);
  const connectedB = waitForEvent(userB, 'chat.connected');
  userB.connect();
  await Promise.all([connectedB, userBOnline]);

  await Promise.all([
    joinConversation(userA, conversationId),
    joinConversation(userB, conversationId),
  ]);

  const typing = waitForEvent(
    userA,
    'chat.typing',
    (event) => event.userId === 2 && event.isTyping === true,
  );
  userB.emit('chat.typing', { conversationId, isTyping: true });
  await typing;

  const clientMessageId = `client-${runId}`;
  const sent = waitForEvent(userA, 'chat.message.sent');
  const received = waitForEvent(userB, 'chat.message');
  userA.emit('chat.send', {
    clientMessageId,
    conversationId,
    content: 'Cross-server message',
  });
  const [sentEvent, receivedMessage] = await Promise.all([sent, received]);

  const receipt = {
    messageId: receivedMessage.messageId,
    senderId: receivedMessage.senderId,
    conversationId,
    receiptToken: receivedMessage.receiptToken,
  };
  const delivered = waitForEvent(userA, 'chat.message.delivered');
  userB.emit('chat.delivered', receipt);
  await delivered;
  const seen = waitForEvent(userA, 'chat.message.seen');
  userB.emit('chat.seen', receipt);
  await seen;

  const userBOffline = waitForEvent(
    userA,
    'presence.changed',
    (event) => event.userId === 2 && event.online === false,
  );
  userB.disconnect();
  await userBOffline;

  process.stdout.write(
    `${JSON.stringify({ status: 'passed', servers: ports.length, conversationId, messageId: sentEvent.messageId, delivered: true, seen: true, presence: true, typing: true })}\n`,
  );
} finally {
  for (const client of clients) client.disconnect();
  for (const child of processes) child.kill('SIGTERM');
  await Promise.allSettled(processes.map(waitForExit));
  if (redis.isOpen) {
    await redis.del(`chat:conversation:${conversationId}:members`);
    await redis.del('chat:presence:1:connections');
    await redis.del('chat:presence:2:connections');
    await redis.close();
  }
}

function startGateway(port, instance) {
  const logs = [];
  const child = spawn(process.execPath, ['apps/realtime-gateway/dist/main.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      INSTANCE_ID: `realtime-e2e-${instance}`,
      KAFKA_CLIENT_ID: `realtime-e2e-${instance}-${runId}`,
      KAFKA_FANOUT_GROUP_ID: `realtime-fanout-e2e-${runId}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      logs.push(chunk.toString());
      if (logs.length > 100) logs.shift();
    });
  }
  child.on('exit', (code) => {
    if (code && code !== 0) {
      process.stderr.write(logs.join(''));
    }
  });
  return child;
}

function createSocket(port, authToken) {
  return io(`http://127.0.0.1:${port}/chat`, {
    auth: { token: authToken },
    autoConnect: false,
    reconnection: false,
    transports: ['websocket'],
  });
}

async function joinConversation(client, targetConversationId) {
  const joined = waitForEvent(
    client,
    'chat.joined',
    (event) => event.conversationId === targetConversationId,
  );
  client.emit('chat.join', { conversationId: targetConversationId });
  await joined;
}

function waitForEvent(client, eventName, predicate = () => true, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeout);
    const handler = (value) => {
      if (!predicate(value)) return;
      cleanup();
      resolve(value);
    };
    const errorHandler = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.off(eventName, handler);
      client.off('connect_error', errorHandler);
      client.off('chat.error', errorHandler);
    };
    client.on(eventName, handler);
    client.on('connect_error', errorHandler);
    client.on('chat.error', errorHandler);
  });
}

async function waitForReadiness(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await delay(250);
  }
  throw new Error(`Gateway on port ${port} did not become ready`);
}

function token(userId) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      id: userId,
      username: `e2e-user-${userId}`,
      role: 'user',
      iat: Math.floor(Date.now() / 1_000),
      exp: Math.floor(Date.now() / 1_000) + 300,
    }),
  );
  const signature = createHmac('sha256', jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
