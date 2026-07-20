import { io } from 'socket.io-client';

const storageKeys = {
  token: 'social-test.token',
  user: 'social-test.user',
};

const state = {
  apiBase: '/api/v1',
  socketUrl: window.location.origin,
  token: localStorage.getItem(storageKeys.token) || '',
  user: readStoredJson(storageKeys.user),
  users: [],
  conversations: [],
  presence: {},
  messages: {},
  receiptStatuses: {},
  unreadCounts: {},
  viewingConversationId: '',
  deleteTargetConversationId: '',
  deleteTargetUserId: null,
  activeUserId: null,
  activeConversationId: '',
  socket: null,
  chatStarted: false,
  openingUserId: null,
  openChatRequestId: 0,
  typingTimer: null,
  remoteTypingTimer: null,
  heartbeatTimer: null,
  directorySearchTimer: null,
  directorySearchRequestId: 0,
  directorySearchLoading: false,
  directorySearchResults: [],
  directorySearchResultQuery: '',
  resumeSyncPromise: null,
  needsReconnectSync: false,
};

const elements = {
  authShell: byId('auth-shell'),
  loginView: byId('login-view'),
  signupView: byId('signup-view'),
  loginForm: byId('login-form'),
  signupForm: byId('signup-form'),
  loginError: byId('login-error'),
  signupError: byId('signup-error'),
  chatShell: byId('chat-shell'),
  profileButton: byId('profile-button'),
  profilePopover: byId('profile-popover'),
  profileName: byId('profile-name'),
  profileEmail: byId('profile-email'),
  myAvatar: byId('my-avatar'),
  logoutButton: byId('logout-button'),
  socketIndicator: byId('socket-indicator'),
  userSearch: byId('user-search'),
  peopleListLabel: byId('people-list-label'),
  peopleCount: byId('people-count'),
  peopleList: byId('people-list'),
  emptyChat: byId('empty-chat'),
  activeChat: byId('active-chat'),
  activeAvatar: byId('active-avatar'),
  activeName: byId('active-name'),
  activeStatus: byId('active-status'),
  messageList: byId('message-list'),
  typingIndicator: byId('typing-indicator'),
  messageForm: byId('message-form'),
  messageInput: byId('message-input'),
  backToPeople: byId('back-to-people'),
  closeChat: byId('close-chat'),
  deleteConversation: byId('delete-conversation'),
  deleteDialog: byId('delete-dialog'),
  deleteDialogTitle: byId('delete-dialog-title'),
  cancelDelete: byId('cancel-delete'),
  confirmDelete: byId('confirm-delete'),
  toastRegion: byId('toast-region'),
};

elements.loginForm.addEventListener('submit', handleLogin);
elements.signupForm.addEventListener('submit', handleSignup);
elements.logoutButton.addEventListener('click', logout);
elements.userSearch.addEventListener('input', handleUserSearchInput);
elements.userSearch.addEventListener('focus', refreshFocusedUserSearch);
elements.messageForm.addEventListener('submit', sendMessage);
elements.messageInput.addEventListener('input', handleComposerInput);
elements.messageInput.addEventListener('keydown', handleComposerKeydown);
elements.backToPeople.addEventListener('click', closeActiveChat);
elements.closeChat.addEventListener('click', closeActiveChat);
elements.deleteConversation.addEventListener('click', () => openDeleteDialog());
elements.cancelDelete.addEventListener('click', closeDeleteDialog);
elements.confirmDelete.addEventListener('click', deleteActiveConversation);
elements.deleteDialog.addEventListener('click', (event) => {
  if (event.target === elements.deleteDialog) closeDeleteDialog();
});
elements.profileButton.addEventListener('click', (event) => {
  event.stopPropagation();
  closeActiveChat();
  const opening = elements.profilePopover.classList.contains('hidden');
  elements.profilePopover.classList.toggle('hidden', !opening);
  elements.profileButton.setAttribute('aria-expanded', String(opening));
});
document.addEventListener('click', (event) => {
  closeProfileMenu();
  closeChatFromOutsideClick(event);
});
document.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape' &&
    !elements.deleteDialog.classList.contains('hidden')
  ) {
    closeDeleteDialog();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspendConversationView();
  else syncMissedActivity();
});
window.addEventListener('blur', suspendConversationView);
window.addEventListener('focus', syncMissedActivity);
elements.profilePopover.addEventListener('click', (event) => event.stopPropagation());
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', () => stopRealtime());

if (!window.location.hash) {
  window.location.hash = state.token && state.user ? '#/chat' : '#/login';
} else {
  route();
}

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

function readStoredJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function route() {
  const requested = window.location.hash.replace(/^#\/?/, '') || 'login';
  if (requested === 'chat' && (!state.token || !state.user)) {
    window.location.hash = '#/login';
    return;
  }
  if ((requested === 'login' || requested === 'signup') && state.token && state.user) {
    window.location.hash = '#/chat';
    return;
  }

  const isChat = requested === 'chat';
  elements.authShell.classList.toggle('hidden', isChat);
  elements.chatShell.classList.toggle('hidden', !isChat);
  elements.loginView.classList.toggle('hidden', requested !== 'login');
  elements.signupView.classList.toggle('hidden', requested !== 'signup');

  document.title =
    requested === 'signup'
      ? 'Create account · Loop'
      : requested === 'chat'
        ? 'Messages · Loop'
        : 'Sign in · Loop';

  if (isChat) startChatApp();
}

async function handleLogin(event) {
  event.preventDefault();
  elements.loginError.textContent = '';
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setButtonBusy(button, true, 'Signing in…');

  try {
    const session = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify(formValues(event.currentTarget)),
      authenticated: false,
    });
    setSession(session);
  } catch (error) {
    elements.loginError.textContent = errorMessage(error);
  } finally {
    setButtonBusy(button, false);
  }
}

async function handleSignup(event) {
  event.preventDefault();
  elements.signupError.textContent = '';
  const values = formValues(event.currentTarget);
  if (values.password !== values.passwordConfirm) {
    elements.signupError.textContent = 'The passwords do not match.';
    return;
  }

  const button = event.currentTarget.querySelector('button[type="submit"]');
  setButtonBusy(button, true, 'Creating account…');
  try {
    const session = await api('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ ...values, role: 'user' }),
      authenticated: false,
    });
    setSession(session);
  } catch (error) {
    elements.signupError.textContent = errorMessage(error);
  } finally {
    setButtonBusy(button, false);
  }
}

function setButtonBusy(button, busy, busyText = '') {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.textContent = busyText;
  } else if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
  button.disabled = busy;
}

function setSession(session) {
  stopRealtime();
  state.token = session.access_token;
  state.user = session.user;
  state.chatStarted = false;
  localStorage.setItem(storageKeys.token, state.token);
  localStorage.setItem(storageKeys.user, JSON.stringify(state.user));
  window.location.hash = '#/chat';
  route();
}

function logout() {
  stopRealtime();
  window.clearTimeout(state.directorySearchTimer);
  state.directorySearchRequestId += 1;
  state.directorySearchLoading = false;
  state.directorySearchResults = [];
  state.directorySearchResultQuery = '';
  state.token = '';
  state.user = null;
  state.users = [];
  state.conversations = [];
  state.presence = {};
  state.messages = {};
  state.receiptStatuses = {};
  state.unreadCounts = {};
  state.viewingConversationId = '';
  state.deleteTargetConversationId = '';
  state.deleteTargetUserId = null;
  state.activeUserId = null;
  state.activeConversationId = '';
  state.chatStarted = false;
  state.openChatRequestId += 1;
  state.resumeSyncPromise = null;
  state.needsReconnectSync = false;
  localStorage.removeItem(storageKeys.token);
  localStorage.removeItem(storageKeys.user);
  elements.loginForm.reset();
  elements.signupForm.reset();
  elements.userSearch.value = '';
  closeProfileMenu();
  closeDeleteDialog();
  window.location.hash = '#/login';
  route();
}

async function startChatApp() {
  if (state.chatStarted) return;
  state.chatStarted = true;
  renderProfile();
  setConnectionState('connecting');
  connectSocket();

  try {
    await Promise.all([loadDirectory(), loadConversations()]);
    joinKnownConversations();
    subscribeToPresence();
  } catch (error) {
    if (error?.status === 401) {
      showToast('Your session expired. Please sign in again.', 'error');
      logout();
      return;
    }
    showToast(errorMessage(error), 'error');
  }
}

function renderProfile() {
  const username = state.user?.username || 'User';
  elements.profileName.textContent = username;
  elements.profileEmail.textContent = state.user?.email || '';
  elements.myAvatar.textContent = username;
  elements.profileButton.setAttribute('aria-label', `${username} account menu`);
}

async function loadDirectory() {
  const users = await api('/user/directory', { cache: 'no-store' });
  state.users = Array.isArray(users)
    ? users.filter((user) => Number(user.id) !== Number(state.user?.id))
    : [];
  renderPeople();
  subscribeToPresence();
}

function handleUserSearchInput() {
  renderPeople();
  window.clearTimeout(state.directorySearchTimer);

  const query = elements.userSearch.value.trim();
  const requestId = ++state.directorySearchRequestId;
  state.directorySearchResults = [];
  state.directorySearchResultQuery = '';
  if (!query) {
    state.directorySearchLoading = false;
    renderPeople();
    return;
  }

  state.directorySearchLoading = true;
  renderPeople();
  state.directorySearchTimer = window.setTimeout(() => {
    refreshDirectoryForSearch(requestId, query);
  }, 250);
}

function refreshFocusedUserSearch() {
  if (elements.userSearch.value.trim()) handleUserSearchInput();
}

async function refreshDirectoryForSearch(requestId, query) {
  try {
    const users = await api(
      `/user/directory?search=${encodeURIComponent(query)}`,
      { cache: 'no-store' },
    );
    if (requestId !== state.directorySearchRequestId) return;

    const results = Array.isArray(users)
      ? users.filter((user) => Number(user.id) !== Number(state.user?.id))
      : [];
    state.directorySearchResults = results;
    state.directorySearchResultQuery = query.toLowerCase();
    mergeDirectoryUsers(results);
    subscribeToPresence();
  } catch (error) {
    if (requestId !== state.directorySearchRequestId) return;
    showToast(`People search could not refresh: ${errorMessage(error)}`, 'error');
  } finally {
    if (requestId === state.directorySearchRequestId) {
      state.directorySearchLoading = false;
      renderPeople();
    }
  }
}

async function loadConversations() {
  const conversations = await api('/chat/conversations');
  state.conversations = Array.isArray(conversations) ? conversations : [];
  for (const conversation of state.conversations) {
    if (conversation.type !== 'direct') continue;
    const otherUserId = conversation.memberIds?.find(
      (id) => Number(id) !== Number(state.user?.id),
    );
    if (!Number.isInteger(Number(otherUserId))) continue;
    state.unreadCounts[otherUserId] = Math.max(
      Number(state.unreadCounts[otherUserId] || 0),
      Number(conversation.unreadCount || 0),
    );
  }
  renderPeople();
  updateUnreadTitle();
  joinKnownConversations();
}

function renderPeople() {
  const query = elements.userSearch.value.trim().toLowerCase();
  const hasCurrentSearchResults =
    query && state.directorySearchResultQuery === query;
  const candidates = query
    ? hasCurrentSearchResults
      ? state.directorySearchResults
      : state.users
    : state.users.filter((user) => Boolean(findDirectConversation(user.id)));
  const filtered = candidates
    .filter((user) => {
      if (!query) return true;
      return (
        String(user.username).toLowerCase().includes(query) ||
        String(user.email).toLowerCase().includes(query)
      );
    })
    .sort((first, second) => {
      const activityDifference =
        inboxTimestamp(second) - inboxTimestamp(first);
      if (activityDifference) return activityDifference;
      const presenceDifference =
        Number(Boolean(state.presence[second.id])) -
        Number(Boolean(state.presence[first.id]));
      return (
        presenceDifference ||
        String(first.username).localeCompare(String(second.username))
      );
    });

  elements.peopleListLabel.textContent = query ? 'Search results' : 'Recent chats';
  elements.peopleCount.textContent = String(filtered.length);
  elements.peopleList.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'list-state';
    empty.textContent = query
      ? state.directorySearchLoading
        ? 'Searching all people…'
        : 'No people match that username or email.'
      : 'No conversations yet. Search for someone to start chatting.';
    elements.peopleList.append(empty);
    return;
  }

  for (const user of filtered) {
    const online = Boolean(state.presence[user.id]);
    const conversation = findDirectConversation(user.id);
    const lastMessage = conversation?.lastMessage;
    const unreadCount = Number(state.unreadCounts[user.id] || 0);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'person-row';
    if (Number(user.id) === Number(state.activeUserId)) row.classList.add('active');
    if (unreadCount > 0) row.classList.add('unread');
    row.setAttribute(
      'aria-label',
      `Chat with ${user.username}${unreadCount ? `, ${unreadCount} unread` : ''}`,
    );

    const avatarWrap = document.createElement('span');
    avatarWrap.className = 'person-avatar-wrap';
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    setAvatar(avatar, user.username, user.id);
    const dot = document.createElement('span');
    dot.className = `presence-dot${online ? ' online' : ''}`;
    dot.setAttribute('aria-label', online ? 'Online' : 'Offline');
    avatarWrap.append(avatar, dot);

    const copy = document.createElement('span');
    copy.className = 'person-copy';
    const name = document.createElement('strong');
    name.textContent = user.username;
    const preview = document.createElement('span');
    preview.className = 'person-preview';
    if (lastMessage) {
      const ownMessage =
        Number(lastMessage.senderId) === Number(state.user?.id);
      if (ownMessage) {
        const receiptStatus = sidebarReceiptStatus(lastMessage);
        const receipt = document.createElement('span');
        receipt.className = `sidebar-receipt ${receiptStatus}`;
        receipt.textContent = receiptStatusLabel(receiptStatus);
        preview.append(receipt, ` · ${lastMessage.content}`);
      } else {
        preview.textContent = lastMessage.content;
      }
    } else {
      preview.textContent = user.email;
    }
    copy.append(name, preview);

    const meta = document.createElement('span');
    meta.className = 'person-meta';
    const time = document.createElement('span');
    time.className = `person-state${online && !lastMessage ? ' online' : ''}`;
    time.textContent = lastMessage
      ? formatInboxTime(messageDate(lastMessage))
      : online
        ? 'Online'
        : '';
    meta.append(time);
    if (unreadCount > 0) {
      const unread = document.createElement('span');
      unread.className = 'unread-badge';
      unread.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      meta.append(unread);
    }

    row.append(avatarWrap, copy, meta);
    row.addEventListener('click', () => openDirectChat(user.id));

    const rowShell = document.createElement('div');
    rowShell.className = 'person-row-shell';
    rowShell.append(row);
    if (conversation) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'sidebar-delete';
      deleteButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="m6.5 7 .75 13h9.5l.75-13" />
          <path d="M10 11v5M14 11v5" />
        </svg>
      `;
      deleteButton.title = `Delete conversation with ${user.username}`;
      deleteButton.setAttribute(
        'aria-label',
        `Delete conversation with ${user.username}`,
      );
      deleteButton.addEventListener('click', () =>
        openDeleteDialog(conversation.conversationId, user.id),
      );
      rowShell.append(deleteButton);
    }
    elements.peopleList.append(rowShell);
  }
}

function setAvatar(element, username, id) {
  const name = String(username || '?').trim();
  const words = name.split(/\s+/).filter(Boolean);
  element.textContent = words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase() || '?';

  const hue = (Number(id) * 47 + 102) % 360;
  element.style.background = `hsl(${hue} 42% 88%)`;
  element.style.color = `hsl(${hue} 38% 28%)`;
}

async function openDirectChat(userId) {
  const numericUserId = Number(userId);
  if (state.openingUserId === numericUserId) return;
  const contact = userById(numericUserId);
  if (!contact) return;
  if (
    numericUserId === Number(state.activeUserId) &&
    state.activeConversationId &&
    !elements.activeChat.classList.contains('hidden')
  ) {
    requestActiveConversationView();
    return;
  }

  const requestId = ++state.openChatRequestId;
  suspendConversationView();
  state.activeConversationId = '';
  state.openingUserId = numericUserId;
  state.activeUserId = numericUserId;
  elements.chatShell.classList.add('chat-open');
  renderPeople();
  renderActiveHeader();
  elements.emptyChat.classList.add('hidden');
  elements.activeChat.classList.remove('hidden');
  renderMessageLoading();

  try {
    let conversation = findDirectConversation(numericUserId);
    if (!conversation) {
      conversation = await api('/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ type: 'direct', memberIds: [numericUserId] }),
      });
      if (requestId !== state.openChatRequestId) return;
      upsertConversation(conversation);
    }

    if (requestId !== state.openChatRequestId) return;
    state.activeConversationId = conversation.conversationId;
    joinConversation(conversation.conversationId);
    await loadHistory(conversation.conversationId);
    if (requestId !== state.openChatRequestId) return;
    requestActiveConversationView();
    elements.messageInput.focus();
  } catch (error) {
    showToast(`Could not open this chat: ${errorMessage(error)}`, 'error');
    elements.messageList.replaceChildren(createState('Could not load this conversation.'));
  } finally {
    if (requestId === state.openChatRequestId) state.openingUserId = null;
  }
}

function closeActiveChat() {
  if (!state.activeConversationId && !state.activeUserId) return;
  suspendConversationView();
  stopTyping();
  state.openChatRequestId += 1;
  state.activeConversationId = '';
  state.activeUserId = null;
  state.openingUserId = null;
  elements.typingIndicator.textContent = '';
  elements.activeChat.classList.add('hidden');
  elements.emptyChat.classList.remove('hidden');
  elements.chatShell.classList.remove('chat-open');
  renderPeople();
}

function closeChatFromOutsideClick(event) {
  if (!state.activeConversationId && !state.activeUserId) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (
    elements.activeChat.contains(target) ||
    target.closest('.person-row') ||
    target.closest('.sidebar-delete') ||
    elements.deleteDialog.contains(target)
  ) {
    return;
  }
  closeActiveChat();
}

function canViewActiveConversation() {
  return Boolean(
    state.activeConversationId &&
      !elements.activeChat.classList.contains('hidden') &&
      !document.hidden &&
      document.hasFocus(),
  );
}

function requestActiveConversationView() {
  if (!state.socket?.connected || !canViewActiveConversation()) return;
  state.socket.emit('chat.open', {
    conversationId: state.activeConversationId,
  });
}

function suspendConversationView() {
  const conversationId =
    state.viewingConversationId || state.activeConversationId;
  state.viewingConversationId = '';
  if (conversationId && state.socket?.connected) {
    state.socket.emit('chat.close', { conversationId });
  }
}

function handleConversationOpened(payload) {
  const conversationId = payload?.conversationId;
  if (
    conversationId !== state.activeConversationId ||
    !canViewActiveConversation()
  ) {
    if (conversationId && state.socket?.connected) {
      state.socket.emit('chat.close', { conversationId });
    }
    return;
  }
  state.viewingConversationId = conversationId;
  markActiveConversationRead();
}

function syncMissedActivity() {
  if (
    !state.token ||
    !state.user ||
    !state.chatStarted ||
    !state.socket?.connected
  ) {
    return Promise.resolve();
  }
  if (state.resumeSyncPromise) return state.resumeSyncPromise;

  const sync = (async () => {
    try {
      await Promise.all([loadDirectory(), loadConversations()]);
      joinKnownConversations();
      const activeConversationId = state.activeConversationId;
      if (activeConversationId) await loadHistory(activeConversationId);
    } catch (error) {
      if (error?.status === 401) {
        showToast('Your session expired. Please sign in again.', 'error');
        logout();
        return;
      }
      showToast(`Could not refresh messages: ${errorMessage(error)}`, 'error');
    } finally {
      if (state.resumeSyncPromise === sync) state.resumeSyncPromise = null;
      requestActiveConversationView();
    }
  })();
  state.resumeSyncPromise = sync;
  return sync;
}

function findDirectConversation(otherUserId) {
  return state.conversations.find(
    (conversation) =>
      conversation.type === 'direct' &&
      conversation.memberIds?.length === 2 &&
      conversation.memberIds.some((id) => Number(id) === Number(state.user?.id)) &&
      conversation.memberIds.some((id) => Number(id) === Number(otherUserId)),
  );
}

function upsertConversation(conversation) {
  const index = state.conversations.findIndex(
    (item) => item.conversationId === conversation.conversationId,
  );
  if (index >= 0) {
    const current = state.conversations[index];
    state.conversations[index] = {
      ...current,
      ...conversation,
      lastMessage: conversation.lastMessage || current.lastMessage,
    };
  }
  else state.conversations.unshift(conversation);
}

function inboxTimestamp(user) {
  const conversation = findDirectConversation(user.id);
  const activity =
    conversation?.lastMessage?.sentAt ||
    conversation?.lastMessage?.createdAt ||
    conversation?.updatedAt ||
    conversation?.createdAt;
  const timestamp = activity ? new Date(activity).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatInboxTime(date) {
  const now = new Date();
  const sameDay = now.toDateString() === date.toDateString();
  if (sameDay) return formatTime(date);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (yesterday.toDateString() === date.toDateString()) return 'Yesterday';

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function updateConversationPreview(message) {
  let conversation = state.conversations.find(
    (item) => item.conversationId === message.conversationId,
  );
  if (!conversation) {
    const otherUserId =
      Number(message.senderId) === Number(state.user?.id)
        ? Number(state.activeUserId)
        : Number(message.senderId);
    if (!Number.isInteger(otherUserId) || otherUserId < 1) return;
    conversation = {
      conversationId: message.conversationId,
      type: 'direct',
      memberIds: [Number(state.user.id), otherUserId],
    };
    state.conversations.unshift(conversation);
  }
  const currentPreview = conversation.lastMessage;
  const updatesSameMessage = Boolean(
    (message.messageId &&
      currentPreview?.messageId === message.messageId) ||
      (message.clientMessageId &&
        currentPreview?.clientMessageId === message.clientMessageId),
  );
  conversation.lastMessage = updatesSameMessage
    ? { ...currentPreview, ...message }
    : { ...message };
}

function markActiveConversationRead() {
  if (
    !state.activeConversationId ||
    !state.activeUserId ||
    state.viewingConversationId !== state.activeConversationId ||
    !canViewActiveConversation()
  ) {
    return;
  }
  state.unreadCounts[state.activeUserId] = 0;
  const conversation = state.conversations.find(
    (item) => item.conversationId === state.activeConversationId,
  );
  if (conversation) conversation.unreadCount = 0;
  for (const message of state.messages[state.activeConversationId] || []) {
    acknowledgeMessage(message, 'seen');
  }
  renderPeople();
  updateUnreadTitle();
}

function updateUnreadTitle() {
  const total = Object.values(state.unreadCounts).reduce(
    (sum, count) => sum + Number(count || 0),
    0,
  );
  document.title = total ? `(${total}) Messages · Loop` : 'Messages · Loop';
}

function renderActiveHeader() {
  const contact = userById(state.activeUserId);
  if (!contact) return;
  elements.activeName.textContent = contact.username;
  setAvatar(elements.activeAvatar, contact.username, contact.id);
  const online = Boolean(state.presence[contact.id]);
  elements.activeStatus.textContent = online ? 'Online now' : 'Offline';
  elements.activeStatus.classList.toggle('online', online);
}

function openDeleteDialog(
  conversationId = state.activeConversationId,
  userId = state.activeUserId,
) {
  if (!conversationId) return;
  state.deleteTargetConversationId = conversationId;
  state.deleteTargetUserId = Number(userId) || null;
  const contact = userById(userId);
  elements.deleteDialogTitle.textContent = contact
    ? `Delete conversation with ${contact.username}?`
    : 'Delete this conversation?';
  elements.deleteDialog.classList.remove('hidden');
  elements.cancelDelete.focus();
}

function closeDeleteDialog() {
  elements.deleteDialog.classList.add('hidden');
  state.deleteTargetConversationId = '';
  state.deleteTargetUserId = null;
}

async function deleteActiveConversation() {
  const conversationId = state.deleteTargetConversationId;
  const userId = state.deleteTargetUserId;
  if (!conversationId) return;
  const deletingActiveConversation =
    state.activeConversationId === conversationId;

  setButtonBusy(elements.confirmDelete, true, 'Deleting…');
  try {
    await api(`/chat/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
    });
    state.conversations = state.conversations.filter(
      (conversation) => conversation.conversationId !== conversationId,
    );
    delete state.messages[conversationId];
    if (userId) delete state.unreadCounts[userId];
    if (deletingActiveConversation) {
      suspendConversationView();
      state.activeConversationId = '';
      state.activeUserId = null;
      elements.activeChat.classList.add('hidden');
      elements.emptyChat.classList.remove('hidden');
      elements.chatShell.classList.remove('chat-open');
    }
    closeDeleteDialog();
    renderPeople();
    updateUnreadTitle();
    showToast('Conversation deleted from your inbox.');
  } catch (error) {
    showToast(`Could not delete conversation: ${errorMessage(error)}`, 'error');
  } finally {
    setButtonBusy(elements.confirmDelete, false);
  }
}

async function loadHistory(conversationId) {
  const history = await api(
    `/chat/conversations/${encodeURIComponent(conversationId)}/messages?limit=100`,
  );
  if (state.activeConversationId !== conversationId) return;
  const historyMessages = Array.isArray(history)
    ? history.map((message) => ({ ...message, status: historyStatus(message) }))
    : [];
  state.messages[conversationId] = mergeConversationMessages(
    historyMessages,
    state.messages[conversationId] || [],
  );
  renderMessages();
}

function historyStatus(message) {
  return sidebarReceiptStatus(message);
}

function sidebarReceiptStatus(message) {
  if (message.pending) return 'sending';
  const durableStatus =
    message.receipts?.seenCount > 0
      ? 'seen'
      : message.receipts?.deliveredCount > 0
        ? 'delivered'
        : 'sent';
  return advanceStatus(
    advanceStatus(durableStatus, message.status),
    state.receiptStatuses[message.messageId],
  );
}

function mergeConversationMessages(...collections) {
  const merged = [];
  for (const message of collections.flat()) {
    const index = merged.findIndex(
      (current) =>
        (message.messageId && current.messageId === message.messageId) ||
        (message.clientMessageId &&
          current.clientMessageId === message.clientMessageId),
    );
    if (index < 0) {
      merged.push(message);
      continue;
    }
    const current = merged[index];
    merged[index] = {
      ...current,
      ...message,
      status: advanceStatus(current.status, message.status),
    };
  }
  return merged;
}

function renderMessageLoading() {
  elements.messageList.replaceChildren(createState('Loading conversation…'));
}

function createState(text) {
  const element = document.createElement('div');
  element.className = 'list-state';
  element.textContent = text;
  return element;
}

function renderMessages() {
  const conversationId = state.activeConversationId;
  const messages = state.messages[conversationId] || [];
  elements.messageList.replaceChildren();

  if (!messages.length) {
    elements.messageList.append(createState('No messages yet. Say hello!'));
    return;
  }

  const sorted = [...messages].sort(
    (first, second) =>
      messageDate(first).getTime() - messageDate(second).getTime(),
  );

  for (const message of sorted) {
    const own = Number(message.senderId) === Number(state.user?.id);
    const group = document.createElement('article');
    group.className = `message-group${own ? ' own' : ''}`;

    const bubble = document.createElement('p');
    bubble.className = 'message-bubble';
    bubble.textContent = message.content || '';

    const meta = document.createElement('span');
    meta.className = 'message-meta';
    const time = document.createElement('span');
    time.textContent = formatTime(messageDate(message));
    meta.append(time);
    if (own) {
      const status = document.createElement('span');
      const currentStatus = message.pending
        ? 'sending'
        : message.status || 'sent';
      status.className = `receipt-status ${currentStatus}`;
      status.textContent = receiptStatusLabel(currentStatus);
      meta.append(status);
    }

    group.append(bubble, meta);
    elements.messageList.append(group);
  }

  requestAnimationFrame(() => {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
  });
}

function messageDate(message) {
  return new Date(message.sentAt || message.createdAt || Date.now());
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function receiptStatusLabel(status) {
  if (status === 'seen') return '✓✓ Seen';
  if (status === 'delivered') return '✓✓ Delivered';
  if (status === 'sent') return '✓ Sent';
  return 'Sending…';
}

function advanceStatus(currentStatus, nextStatus) {
  const ranks = { sending: 0, sent: 1, delivered: 2, seen: 3 };
  const current = currentStatus || 'sending';
  const next = nextStatus || current;
  return (ranks[next] ?? 0) > (ranks[current] ?? 0) ? next : current;
}

function sendMessage(event) {
  event.preventDefault();
  const content = elements.messageInput.value.trim();
  const conversationId = state.activeConversationId;
  if (!content || !conversationId) return;
  if (!state.socket?.connected) {
    showToast('Still connecting. Try again in a moment.', 'error');
    return;
  }

  const clientMessageId =
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const message = {
    clientMessageId,
    conversationId,
    content,
    senderId: state.user.id,
    sentAt: new Date().toISOString(),
    status: 'sending',
    pending: true,
  };

  const messages = state.messages[conversationId] || [];
  messages.push(message);
  state.messages[conversationId] = messages;
  updateConversationPreview(message);
  renderPeople();
  renderMessages();
  elements.messageForm.reset();
  resizeComposer();
  stopTyping();

  state.socket.emit('chat.send', {
    clientMessageId,
    conversationId,
    content,
  });
}

function handleComposerInput() {
  resizeComposer();
  if (!state.activeConversationId || !state.socket?.connected) return;

  state.socket.emit('chat.typing', {
    conversationId: state.activeConversationId,
    isTyping: true,
  });
  window.clearTimeout(state.typingTimer);
  state.typingTimer = window.setTimeout(stopTyping, 1000);
}

function handleComposerKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    elements.messageForm.requestSubmit();
  }
}

function resizeComposer() {
  elements.messageInput.style.height = 'auto';
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 128)}px`;
}

function stopTyping() {
  window.clearTimeout(state.typingTimer);
  state.typingTimer = null;
  if (state.activeConversationId && state.socket?.connected) {
    state.socket.emit('chat.typing', {
      conversationId: state.activeConversationId,
      isTyping: false,
    });
  }
}

function connectSocket() {
  if (!state.token || state.socket) return;
  const socket = io(`${state.socketUrl}/chat`, {
    auth: { token: state.token },
    transports: ['websocket'],
    reconnection: true,
  });
  state.socket = socket;

  socket.on('connect', () => {
    const shouldSyncMissedActivity = state.needsReconnectSync;
    state.needsReconnectSync = false;
    state.viewingConversationId = '';
    setConnectionState('online');
    joinKnownConversations();
    subscribeToPresence();
    startHeartbeat();
    if (shouldSyncMissedActivity) syncMissedActivity();
    else requestActiveConversationView();
  });
  socket.on('disconnect', () => {
    state.needsReconnectSync = true;
    state.viewingConversationId = '';
    setConnectionState('offline');
    stopHeartbeat();
  });
  socket.on('connect_error', (error) => {
    setConnectionState('offline');
    showToast(`Realtime connection failed: ${error.message}`, 'error');
  });
  socket.on('presence.snapshot', (payload) => {
    state.presence = { ...state.presence, ...(payload?.statuses || {}) };
    renderPeople();
    renderActiveHeader();
  });
  socket.on('presence.changed', (payload) => {
    if (!payload || !Number.isInteger(Number(payload.userId))) return;
    state.presence[payload.userId] = Boolean(payload.online);
    renderPeople();
    renderActiveHeader();
  });
  socket.on('chat.message', receiveMessage);
  socket.on('chat.message.sent', (payload) => updatePendingMessage(payload));
  socket.on('chat.message.delivered', (payload) => updateMessageStatus(payload, 'delivered'));
  socket.on('chat.message.seen', (payload) => updateMessageStatus(payload, 'seen'));
  socket.on('chat.opened', handleConversationOpened);
  socket.on('chat.closed', (payload) => {
    if (payload?.conversationId === state.viewingConversationId) {
      state.viewingConversationId = '';
    }
  });
  socket.on('chat.typing', handleRemoteTyping);
  socket.on('chat.error', (payload) => showToast(socketError(payload), 'error'));
  socket.on('exception', (payload) => showToast(socketError(payload), 'error'));
}

function stopRealtime() {
  suspendConversationView();
  stopHeartbeat();
  window.clearTimeout(state.typingTimer);
  window.clearTimeout(state.remoteTypingTimer);
  state.typingTimer = null;
  state.remoteTypingTimer = null;
  if (state.socket) {
    state.socket.removeAllListeners();
    state.socket.disconnect();
    state.socket = null;
  }
  setConnectionState('offline');
}

function setConnectionState(status) {
  const online = status === 'online';
  elements.socketIndicator.className = `connection-pill ${online ? 'online' : 'offline'}`;
  elements.socketIndicator.lastChild.textContent =
    status === 'connecting' ? 'Connecting' : online ? 'Live' : 'Offline';
}

function startHeartbeat() {
  stopHeartbeat();
  state.heartbeatTimer = window.setInterval(() => {
    if (state.socket?.connected) state.socket.emit('chat.ping');
  }, 30_000);
}

function stopHeartbeat() {
  window.clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
}

function subscribeToPresence() {
  if (!state.socket?.connected || !state.users.length) return;
  state.socket.emit('presence.subscribe', {
    userIds: state.users.map((user) => Number(user.id)),
  });
}

function joinKnownConversations() {
  if (!state.socket?.connected) return;
  for (const conversation of state.conversations) {
    joinConversation(conversation.conversationId);
  }
}

function joinConversation(conversationId) {
  if (!state.socket?.connected || !conversationId) return;
  state.socket.emit('chat.join', { conversationId });
}

async function receiveMessage(message) {
  if (!message?.conversationId) return;
  const messages = state.messages[message.conversationId] || [];
  const existing = messages.findIndex(
    (item) =>
      (message.messageId && item.messageId === message.messageId) ||
      (message.clientMessageId && item.clientMessageId === message.clientMessageId),
  );
  const nextMessage = { ...message, status: 'sent', pending: false };
  if (existing >= 0) messages[existing] = { ...messages[existing], ...nextMessage };
  else messages.push(nextMessage);
  state.messages[message.conversationId] = messages;
  updateConversationPreview(nextMessage);

  const isSelectedSender =
    Number(state.activeUserId) === Number(message.senderId);
  if (isSelectedSender && state.activeConversationId !== message.conversationId) {
    state.activeConversationId = message.conversationId;
  }

  acknowledgeMessage(message, 'delivered');
  const isActiveAndVisible =
    (state.activeConversationId === message.conversationId || isSelectedSender) &&
    state.viewingConversationId === message.conversationId &&
    canViewActiveConversation();
  if (isActiveAndVisible) {
    acknowledgeMessage(message, 'seen');
    renderMessages();
  } else {
    state.unreadCounts[message.senderId] =
      Number(state.unreadCounts[message.senderId] || 0) + 1;
    const sender = await ensureUserKnown(message.senderId);
    showToast(`New message from ${sender?.username || 'someone'}`);
  }
  renderPeople();
  updateUnreadTitle();
}

async function ensureUserKnown(userId) {
  const knownUser = userById(userId);
  if (knownUser) return knownUser;

  try {
    const users = await api('/user/directory', { cache: 'no-store' });
    mergeDirectoryUsers(users);
    subscribeToPresence();
  } catch {
    state.users.push({
      id: Number(userId),
      username: `User ${userId}`,
      email: '',
    });
  }

  return userById(userId);
}

function mergeDirectoryUsers(users) {
  if (!Array.isArray(users)) return;
  const usersById = new Map(
    state.users.map((user) => [Number(user.id), user]),
  );
  for (const user of users) {
    const userId = Number(user.id);
    if (!Number.isInteger(userId) || userId === Number(state.user?.id)) continue;
    usersById.set(userId, { ...usersById.get(userId), ...user });
  }
  state.users = [...usersById.values()];
}

function acknowledgeMessage(message, status) {
  if (
    !state.socket?.connected ||
    !message.receiptToken ||
    Number(message.senderId) === Number(state.user?.id)
  ) {
    return;
  }
  if (
    advanceStatus(message.acknowledgedStatus, status) ===
    message.acknowledgedStatus
  ) {
    return;
  }
  message.acknowledgedStatus = status;
  state.socket.emit(`chat.${status}`, {
    messageId: message.messageId,
    senderId: message.senderId,
    conversationId: message.conversationId,
    receiptToken: message.receiptToken,
  });
}

function updatePendingMessage(payload) {
  const messages = state.messages[payload?.conversationId] || [];
  const pending = [...messages].reverse().find((message) => message.pending);
  if (!pending) return;
  pending.messageId = payload.messageId;
  pending.pending = false;
  pending.status = advanceStatus(
    pending.status,
    state.receiptStatuses[payload.messageId] || 'sent',
  );
  updateConversationPreview(pending);
  renderPeople();
  if (state.activeConversationId === payload.conversationId) renderMessages();
}

function updateMessageStatus(payload, status) {
  if (!payload?.messageId) return;
  state.receiptStatuses[payload.messageId] = advanceStatus(
    state.receiptStatuses[payload.messageId],
    status,
  );
  const messages = state.messages[payload?.conversationId] || [];
  const message = messages.find((item) => item.messageId === payload?.messageId);
  if (message) {
    message.pending = false;
    message.status = advanceStatus(message.status, status);
  }
  const conversation = state.conversations.find(
    (item) => item.conversationId === payload?.conversationId,
  );
  if (conversation?.lastMessage?.messageId === payload.messageId) {
    conversation.lastMessage.pending = false;
    conversation.lastMessage.status = advanceStatus(
      conversation.lastMessage.status,
      status,
    );
    conversation.lastMessage.receipts = {
      ...(conversation.lastMessage.receipts || {}),
      deliveredCount: Math.max(
        Number(conversation.lastMessage.receipts?.deliveredCount || 0),
        1,
      ),
      seenCount:
        status === 'seen'
          ? Math.max(
              Number(conversation.lastMessage.receipts?.seenCount || 0),
              1,
            )
          : Number(conversation.lastMessage.receipts?.seenCount || 0),
    };
  }
  renderPeople();
  if (message && state.activeConversationId === payload.conversationId) {
    renderMessages();
  }
}

function handleRemoteTyping(payload) {
  if (
    payload?.conversationId !== state.activeConversationId ||
    Number(payload.userId) === Number(state.user?.id)
  ) {
    return;
  }
  window.clearTimeout(state.remoteTypingTimer);
  elements.typingIndicator.textContent = payload.isTyping
    ? `${userById(payload.userId)?.username || 'Someone'} is typing…`
    : '';
  if (payload.isTyping) {
    state.remoteTypingTimer = window.setTimeout(() => {
      elements.typingIndicator.textContent = '';
    }, 1800);
  }
}

function userById(id) {
  return state.users.find((user) => Number(user.id) === Number(id));
}

function closeProfileMenu() {
  elements.profilePopover.classList.add('hidden');
  elements.profileButton.setAttribute('aria-expanded', 'false');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' error' : ''}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3800);
}

function socketError(payload) {
  if (typeof payload === 'string') return payload;
  return payload?.message || payload?.error || 'Something went wrong in realtime chat.';
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (options.body) headers.set('Content-Type', 'application/json');
  if (options.authenticated !== false && state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  const response = await fetch(`${state.apiBase}${path}`, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const error = new Error(responseError(payload, response.statusText));
    error.status = response.status;
    throw error;
  }
  return payload;
}

function responseError(payload, fallback) {
  const message = payload?.message ?? payload?.error ?? fallback;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'object' && message) {
    return message.message || JSON.stringify(message);
  }
  return String(message || 'Request failed');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Something went wrong.');
}
