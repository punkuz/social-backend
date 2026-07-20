# Social backend test client

This is a deliberately small HTML, CSS, and JavaScript client for manually
testing the backend. It covers signup, login, protected user lookup,
conversations, history, Socket.IO authentication, joining chats, sending
messages, presence, typing, delivery receipts, and seen receipts.

## Run locally

Start the infrastructure:

```sh
docker compose -f compose.local.yml up -d
```

Start the four backend applications (in one terminal):

```sh
npm exec -- nx run-many -t serve -p @org/user-service @org/chat-service @org/api-gateway @org/realtime-gateway --parallel=4
```

Start this client (in another terminal):

```sh
npm exec -- nx serve @org/social-test-client
```

Open <http://localhost:4200>. Use two browser windows with different users to
exercise two-sided realtime features. The client stores its JWT and endpoint
settings in local storage, so use a private window or a separate browser profile
for the second user.
