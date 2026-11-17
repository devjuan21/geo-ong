/**
 * GeoSafe - Dedicated Private Rescue Messaging Controller (Resident & Responder)
 */
(function (window) {
  'use strict';

  const state = {
    role: 'Resident',
    currentUser: null,
    conversations: [],
    pendingRequests: [],
    activeConversationId: null,
    activeConversation: null,
    messages: [],
    isLoadingList: false,
    isLoadingThread: false,
  };

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatManilaTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-PH', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  function showErrorBanner(msg) {
    const banner = document.getElementById('messages-error-banner');
    const textEl = document.getElementById('messages-error-banner-text');
    if (banner && textEl) {
      textEl.textContent = msg || 'Unable to process messaging request.';
      banner.classList.remove('hidden');
    }
  }

  function dismissErrorBanner() {
    document.getElementById('messages-error-banner')?.classList.add('hidden');
  }

  function renderStatusBadge(status) {
    const s = String(status || 'Active');
    if (s === 'Completed') {
      return '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">Completed</span>';
    }
    if (s === 'Closed') {
      return '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">Closed</span>';
    }
    return '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-[#278653] border border-emerald-200">Active</span>';
  }

  async function initMessagesPage() {
    const roleAttr = document.body?.getAttribute('data-messages-role') || 'Resident';
    state.role = roleAttr;

    if (roleAttr === 'Responder' && window.GeoSafeResponderUI) {
      await window.GeoSafeResponderUI.init('messages', 'Messages');
      const auth = await window.GeoSafeResponderUI.verifyResponderSession();
      if (!auth.authorized) {
        window.GeoSafeResponderUI.renderUnauthorizedScreen(document.querySelector('main'));
        return;
      }
    } else if (window.GeoSafeUI) {
      await window.GeoSafeUI.init('messages', 'Messages');
    }

    if (window.geoSafeStore) {
      state.currentUser = window.geoSafeStore.getCurrentUser();
      await window.geoSafeStore.initRealtimeSocket();
    }

    await loadConversationsList();

    const params = new URLSearchParams(window.location.search || '');
    const reqConvId = params.get('conversationId');
    const reqRescueId = params.get('rescueId');

    if (reqConvId) {
      await selectConversation(Number(reqConvId));
    } else if (reqRescueId) {
      const match = state.conversations.find((c) => Number(c.rescueId) === Number(reqRescueId));
      if (match) {
        await selectConversation(match.id);
      }
    } else if (state.conversations.length > 0 && window.innerWidth >= 1024) {
      await selectConversation(state.conversations[0].id);
    }

    window.addEventListener('geosafe:realtime-update', (ev) => {
      handleRealtimeUpdate(ev.detail || {});
    });
  }

  async function handleRealtimeUpdate({ event, data }) {
    if (event === 'conversation:new-message' && data) {
      const msgConvId = Number(data.conversationId);
      clearPeerTyping(msgConvId, data.senderUserId);
      if (state.activeConversationId && msgConvId === Number(state.activeConversationId)) {
        const isOwnMsg = state.currentUser && Number(data.senderUserId) === Number(state.currentUser.id);
        const shouldScroll = isNearBottom() || isOwnMsg;
        upsertMessageInThread(data);
        if (shouldScroll) scrollToBottom();
        if (state.currentUser && Number(data.senderUserId) !== Number(state.currentUser.id)) {
          markActiveConversationRead();
        }
      }
      await loadConversationsList({ silent: true });
      return;
    }

    if (event === 'conversation:messages-read' && data) {
      const msgConvId = Number(data.conversationId);
      if (state.activeConversationId && msgConvId === Number(state.activeConversationId)) {
        state.messages.forEach((m) => {
          if (Number(m.senderUserId) !== Number(data.readerUserId)) {
            m.isRead = true;
            m.readAt = data.readAt;
          }
        });
        renderMessagesThread();
      }
      await loadConversationsList({ silent: true });
      return;
    }

    if (event === 'conversation:typing' && data) {
      handleIncomingTyping(data);
      return;
    }

    if (
      event === 'messages:unread-update' ||
      event === 'messages:access-updated' ||
      event === 'rescue-assignment-updated' ||
      event === 'rescue-status-updated' ||
      event === 'status-update' ||
      event === 'reconnect-sync'
    ) {
      if (event === 'messages:access-updated' && data) {
        const matchesActive = state.activeConversation && (
          (data.conversationId && Number(data.conversationId) === Number(state.activeConversation.id)) ||
          (data.rescueId && Number(data.rescueId) === Number(state.activeConversation.rescueId))
        );
        if (matchesActive && ['Closed', 'Completed'].includes(data.status)) {
          stopTypingSignal();
          clearAllPeerTyping();
          state.activeConversation.conversationStatus = 'Closed';
          state.activeConversation.canSend = false;
          renderActiveThreadState();
        }
      }
      if (event === 'reconnect-sync') {
        clearAllPeerTyping();
      }
      await loadConversationsList({ silent: true });
      if (state.activeConversationId) {
        const stillAuthorized = state.conversations.some(
          (c) => Number(c.id) === Number(state.activeConversationId)
        );
        if (!stillAuthorized && event === 'messages:access-updated') {
          leaveSocketConversation(state.activeConversationId);
          state.activeConversationId = null;
          state.activeConversation = null;
          state.messages = [];
          renderActiveThreadState();
          showErrorBanner('Your access to that conversation has been updated.');
        } else {
          await loadConversationHistory(state.activeConversationId, { silent: true });
        }
      }
    }
  }

  function joinSocketConversation(convId) {
    const socket = window.geoSafeStore && window.geoSafeStore.socket;
    if (socket && socket.connected && convId) {
      socket.emit('join-conversation', convId);
    }
  }

  function leaveSocketConversation(convId) {
    const socket = window.geoSafeStore && window.geoSafeStore.socket;
    if (socket && socket.connected && convId) {
      socket.emit('leave-conversation', convId);
    }
  }

  async function loadConversationsList({ silent = false } = {}) {
    const loadingEl = document.getElementById('messages-conversations-loading');
    const emptyEl = document.getElementById('messages-conversations-empty');
    const listEl = document.getElementById('messages-conversations-list');
    const countBadge = document.getElementById('messages-active-count-badge');
    const unreadPill = document.getElementById('messages-unread-pill');

    if (!silent && loadingEl) loadingEl.classList.remove('hidden');
    if (!silent && emptyEl) emptyEl.classList.add('hidden');

    try {
      const data = await window.geoSafeStore.request('/messages/conversations', { method: 'GET' });
      state.conversations = Array.isArray(data && data.conversations) ? data.conversations : [];
      state.pendingRequests = Array.isArray(data && data.pendingRequests) ? data.pendingRequests : [];

      if (loadingEl) loadingEl.classList.add('hidden');

      if (countBadge) {
        countBadge.textContent = `${state.conversations.length} Conversation${
          state.conversations.length === 1 ? '' : 's'
        }`;
      }

      const totalUnread = state.conversations.reduce((sum, c) => sum + Number(c.unreadCount || 0), 0);
      if (unreadPill) {
        unreadPill.textContent = `${totalUnread} Unread`;
        unreadPill.classList.toggle('hidden', totalUnread <= 0);
      }

      renderPendingRequestsNotice();
      renderConversationsList();

      if (emptyEl) {
        emptyEl.classList.toggle('hidden', state.conversations.length > 0);
      }

      if (state.role === 'Responder' && window.GeoSafeResponderUI) {
        window.GeoSafeResponderUI.syncHeaderResponderData();
      } else if (window.GeoSafeUI) {
        window.GeoSafeUI.syncHeaderResidentData();
      }
    } catch (err) {
      if (loadingEl) loadingEl.classList.add('hidden');
      showErrorBanner(err.message || 'Unable to load conversations from server.');
    }
  }

  function renderPendingRequestsNotice() {
    const wrap = document.getElementById('messages-pending-requests-wrap');
    if (!wrap) return;
    if (!state.pendingRequests.length) {
      wrap.innerHTML = '';
      wrap.classList.add('hidden');
      return;
    }

    wrap.classList.remove('hidden');
    wrap.innerHTML = state.pendingRequests
      .map((pr) => {
        if (state.role === 'Responder') {
          return `
            <div class="p-3 rounded-xl bg-white border border-[#FFE872] shadow-subtle flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                <span class="font-mono font-bold text-[#8A6800]">${escapeHtml(pr.rescueReference)}</span>
                <span class="font-bold text-[#202020] ml-1.5">${escapeHtml(pr.emergencyType)}</span>
                <span class="text-[#555555] ml-1.5">• Resident: <strong>${escapeHtml(pr.residentName)}</strong></span>
              </div>
              <a href="responder-assignments.html" class="px-3 py-1 rounded-lg bg-[#F5B900] text-[#202020] font-bold text-[11px]">
                Accept Assignment to Unlock Chat
              </a>
            </div>
          `;
        }
        const statusMsg = pr.assignedResponderName
          ? `Assigned to ${pr.assignedResponderName} — waiting for Responder to accept assignment.`
          : 'Waiting for Administrator responder assignment and acceptance.';
        return `
          <div class="p-3 rounded-xl bg-white border border-[#FFE872] shadow-subtle flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <span class="font-mono font-bold text-[#8A6800]">${escapeHtml(pr.rescueReference)}</span>
              <span class="font-bold text-[#202020] ml-1.5">${escapeHtml(pr.emergencyType)}</span>
              <span class="text-[#777777] block sm:inline sm:ml-2 text-[11px]">${escapeHtml(statusMsg)}</span>
            </div>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF9E8] text-[#8A6800] border border-[#FFE872]">
              Messaging Locked Until Accepted
            </span>
          </div>
        `;
      })
      .join('');
  }

  function renderConversationsList() {
    const listEl = document.getElementById('messages-conversations-list');
    if (!listEl) return;

    if (!state.conversations.length) {
      listEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = state.conversations
      .map((c) => {
        const isSelected = Number(c.id) === Number(state.activeConversationId);
        const counterpart = state.role === 'Resident' ? c.responder : c.resident;
        const preview = c.lastMessagePreview
          ? escapeHtml(c.lastMessagePreview)
          : 'No messages yet — start the conversation';
        const timeStr = c.lastMessageAt ? formatManilaTime(c.lastMessageAt) : formatManilaTime(c.createdAt);
        const unread = Number(c.unreadCount || 0);

        return `
          <button type="button" onclick="window.GeoSafeMessages.selectConversation(${c.id})"
            class="w-full p-3.5 text-left transition-colors flex items-start justify-between gap-2.5 ${
              isSelected ? 'bg-[#FFF9E8] border-l-4 border-l-[#F5B900]' : 'hover:bg-[#FFFDF7]'
            }">
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-xs font-bold text-[#202020] truncate">${escapeHtml(counterpart.name)}</span>
                <span class="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-[#FFF9E8] text-[#8A6800] border border-[#FFE872]">${escapeHtml(c.rescueReference)}</span>
              </div>
              <p class="text-[11px] ${unread > 0 ? 'font-bold text-[#202020]' : 'text-[#555555]'} truncate">${preview}</p>
              <div class="flex items-center gap-2 text-[10px] text-[#777777]">
                <span>${escapeHtml(c.emergencyType)}</span>
                <span>•</span>
                <span>${escapeHtml(timeStr)}</span>
              </div>
            </div>
            <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
              ${renderStatusBadge(c.conversationStatus)}
              ${
                unread > 0
                  ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#D93636] text-white">${unread}</span>`
                  : ''
              }
            </div>
          </button>
        `;
      })
      .join('');
  }

  let savedInboxScrollY = 0;

  function syncMobileThreadViewportHeight() {
    const threadPanel = document.getElementById('messages-thread-panel');
    if (!threadPanel) return;
    if (window.innerWidth >= 1024 || !document.body.classList.contains('gs-chat-fullscreen')) {
      threadPanel.style.height = '';
      threadPanel.style.top = '';
      return;
    }
    if (window.visualViewport) {
      threadPanel.style.height = `${window.visualViewport.height}px`;
      threadPanel.style.top = `${window.visualViewport.offsetTop || 0}px`;
    }
  }

  function enterMobileFullscreenThread() {
    if (window.innerWidth >= 1024) return;
    savedInboxScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.classList.add('gs-chat-fullscreen');
    syncMobileThreadViewportHeight();
  }

  function exitMobileFullscreenThread() {
    document.body.classList.remove('gs-chat-fullscreen');
    const threadPanel = document.getElementById('messages-thread-panel');
    if (threadPanel) {
      threadPanel.style.height = '';
      threadPanel.style.top = '';
    }
    if (savedInboxScrollY > 0) {
      window.scrollTo(0, savedInboxScrollY);
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024) {
        exitMobileFullscreenThread();
      } else {
        syncMobileThreadViewportHeight();
      }
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncMobileThreadViewportHeight);
      window.visualViewport.addEventListener('scroll', syncMobileThreadViewportHeight);
    }
  }

  async function selectConversation(conversationId) {
    dismissErrorBanner();
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0) return;

    if (state.activeConversationId && Number(state.activeConversationId) !== convId) {
      stopTypingSignal();
      leaveSocketConversation(state.activeConversationId);
    }

    state.activeConversationId = convId;
    renderConversationsList();
    renderTypingIndicator();

    // On mobile, enter full-screen conversation mode and hide list/nav
    const listPanel = document.getElementById('messages-list-panel');
    const threadPanel = document.getElementById('messages-thread-panel');
    if (window.innerWidth < 1024 && listPanel && threadPanel) {
      listPanel.classList.add('hidden');
      threadPanel.classList.remove('hidden');
      threadPanel.classList.add('flex');
      enterMobileFullscreenThread();
    }

    const loaded = await loadConversationHistory(convId);
    if (loaded) {
      joinSocketConversation(convId);
      await markActiveConversationRead();
    }
  }

  function backToConversationList() {
    stopTypingSignal();
    exitMobileFullscreenThread();
    const listPanel = document.getElementById('messages-list-panel');
    const threadPanel = document.getElementById('messages-thread-panel');
    if (listPanel && threadPanel) {
      listPanel.classList.remove('hidden');
      threadPanel.classList.add('hidden');
      threadPanel.classList.remove('flex');
    }
  }

  async function loadConversationHistory(conversationId, { silent = false } = {}) {
    try {
      const data = await window.geoSafeStore.request(
        `/messages/conversations/${conversationId}/messages`,
        { method: 'GET' }
      );
      state.activeConversation = data.conversation;
      const serverMessages = Array.isArray(data.messages) ? data.messages : [];

      // Preserve any local failed/sending optimistic messages not yet on server
      const serverClientIds = new Set(
        serverMessages.map((m) => m.clientMessageId).filter(Boolean)
      );
      const localPending = state.messages.filter(
        (m) =>
          Number(m.conversationId) === Number(conversationId) &&
          (m._localStatus === 'sending' || m._localStatus === 'failed') &&
          m.clientMessageId &&
          !serverClientIds.has(m.clientMessageId)
      );

      state.messages = [...serverMessages, ...localPending];
      renderActiveThreadState();
      if (!silent) scrollToBottom();
      return true;
    } catch (err) {
      state.activeConversationId = null;
      state.activeConversation = null;
      state.messages = [];
      renderActiveThreadState();
      renderConversationsList();
      showErrorBanner(err.message || 'You are not authorized to access this conversation.');
      return false;
    }
  }

  async function markActiveConversationRead() {
    if (!state.activeConversationId) return;
    try {
      await window.geoSafeStore.request(
        `/messages/conversations/${state.activeConversationId}/read`,
        { method: 'POST' }
      );
      const conv = state.conversations.find(
        (c) => Number(c.id) === Number(state.activeConversationId)
      );
      if (conv) conv.unreadCount = 0;
      renderConversationsList();
      await loadConversationsList({ silent: true });
    } catch (_) {}
  }

  function renderActiveThreadState() {
    const placeholder = document.getElementById('messages-thread-placeholder');
    const activeWrap = document.getElementById('messages-thread-active');
    if (!placeholder || !activeWrap) return;

    if (!state.activeConversation) {
      placeholder.classList.remove('hidden');
      activeWrap.classList.add('hidden');
      return;
    }

    placeholder.classList.add('hidden');
    activeWrap.classList.remove('hidden');

    const conv = state.activeConversation;
    const counterpart = state.role === 'Resident' ? conv.responder : conv.resident;
    document.getElementById('thread-participant-name').textContent = counterpart.name;
    document.getElementById('thread-rescue-ref').textContent = conv.rescueReference;

    const statusBadge = document.getElementById('thread-status-badge');
    if (statusBadge) {
      statusBadge.outerHTML = `<span id="thread-status-badge">${renderStatusBadge(
        conv.conversationStatus
      )}</span>`;
    }

    const subText =
      state.role === 'Resident'
        ? `${counterpart.userCode} • ${counterpart.unit || 'Assigned Responder'} • ${conv.emergencyType}`
        : `${counterpart.userCode} • ${conv.emergencyType}${
            conv.rescueAddress ? ` • ${conv.rescueAddress}` : ''
          }`;
    document.getElementById('thread-participant-sub').textContent = subText;

    const inputEl = document.getElementById('messages-compose-input');
    const sendBtn = document.getElementById('messages-send-btn');
    const closedBannerEl = document.getElementById('messages-closed-banner');
    const isReadOnly =
      ['Completed', 'Closed'].includes(conv.conversationStatus) || !conv.canSend;
    if (isReadOnly) {
      stopTypingSignal();
      clearPeerTyping(conv.id);
    }
    if (closedBannerEl) {
      closedBannerEl.classList.toggle('hidden', !isReadOnly);
    }
    if (inputEl) {
      inputEl.disabled = isReadOnly;
      inputEl.placeholder = isReadOnly
        ? 'Conversation closed — assignment completed'
        : 'Message';
    }
    if (sendBtn) {
      sendBtn.disabled = isReadOnly;
      sendBtn.classList.toggle('hidden', isReadOnly);
    }

    renderMessagesThread();
  }

  function upsertMessageInThread(msg) {
    if (!msg) return;
    const idx = state.messages.findIndex(
      (m) =>
        (msg.id && Number(m.id) === Number(msg.id)) ||
        (msg.clientMessageId && m.clientMessageId === msg.clientMessageId)
    );
    if (idx >= 0) {
      state.messages[idx] = { ...msg, _localStatus: 'sent' };
    } else {
      state.messages.push({ ...msg, _localStatus: 'sent' });
    }
    renderMessagesThread();
  }

  function renderMessagesThread() {
    const bodyEl = document.getElementById('messages-thread-body');
    if (!bodyEl) return;

    if (!state.messages.length) {
      bodyEl.innerHTML = `
        <div class="py-12 text-center text-xs text-[#777777]">
          No messages exchanged yet. Send a message below to coordinate regarding <strong class="text-[#202020]">${escapeHtml(
            state.activeConversation?.rescueReference || ''
          )}</strong>.
        </div>
      `;
      return;
    }

    const myId = state.currentUser ? Number(state.currentUser.id) : -1;

    bodyEl.innerHTML = state.messages
      .map((m) => {
        const isMine = Number(m.senderUserId) === myId;
        const timeStr = formatManilaTime(m.createdAt);
        let deliveryText = '';
        if (isMine) {
          if (m._localStatus === 'sending') {
            deliveryText = '• Sending...';
          } else if (m._localStatus === 'failed') {
            deliveryText = `• <button type="button" onclick="window.GeoSafeMessages.retryMessage('${escapeHtml(
              m.clientMessageId
            )}')" class="text-[#D93636] font-bold underline">Failed — Tap to Retry</button>`;
          } else if (m.isRead) {
            deliveryText = '• Read';
          } else {
            deliveryText = '• Sent';
          }
        }

        return `
          <div class="flex flex-col ${isMine ? 'items-end' : 'items-start'}">
            <div class="max-w-[82%] sm:max-w-[72%] rounded-2xl px-3.5 py-2.5 text-xs ${
              isMine
                ? 'bg-[#202020] text-white rounded-br-sm'
                : 'bg-white border border-[#EEEEEE] text-[#202020] rounded-bl-sm shadow-subtle'
            }">
              ${
                !isMine
                  ? `<span class="block text-[10px] font-bold text-[#8A6800] mb-0.5">${escapeHtml(
                      m.senderName
                    )} (${escapeHtml(m.senderRole)})</span>`
                  : ''
              }
              <p class="whitespace-pre-line leading-relaxed break-words">${escapeHtml(m.body)}</p>
            </div>
            <div class="mt-1 px-1 text-[10px] text-[#777777] flex items-center gap-1">
              <span>${escapeHtml(timeStr)}</span>
              ${deliveryText}
            </div>
          </div>
        `;
      })
      .join('');
  }

  function isNearBottom() {
    const bodyEl = document.getElementById('messages-thread-body');
    if (!bodyEl) return true;
    return bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 90;
  }

  function scrollToBottom() {
    const bodyEl = document.getElementById('messages-thread-body');
    if (bodyEl) {
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }
  }

  function autoResizeComposeInput() {
    const inputEl = document.getElementById('messages-compose-input');
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(96, Math.max(36, inputEl.scrollHeight))}px`;
  }

  const typingPeersByConv = new Map();
  const typingEmitState = {
    convId: null,
    isTyping: false,
    lastSentAt: 0,
    stopTimer: null,
  };

  function emitSocketTyping(convId, isTyping) {
    const sock = window.geoSafeStore && window.geoSafeStore.socket;
    if (!sock || !sock.connected || !convId) return;
    sock.emit(isTyping ? 'conversation:typing-start' : 'conversation:typing-stop', {
      conversationId: Number(convId),
    });
  }

  function stopTypingSignal() {
    if (typingEmitState.stopTimer) {
      clearTimeout(typingEmitState.stopTimer);
      typingEmitState.stopTimer = null;
    }
    if (typingEmitState.isTyping && typingEmitState.convId) {
      emitSocketTyping(typingEmitState.convId, false);
    }
    typingEmitState.isTyping = false;
    typingEmitState.lastSentAt = 0;
  }

  function handleLocalTypingInput() {
    const convId = state.activeConversationId;
    const inputEl = document.getElementById('messages-compose-input');
    if (!convId || !inputEl) {
      stopTypingSignal();
      return;
    }
    if (!inputEl.value.trim()) {
      stopTypingSignal();
      return;
    }

    const now = Date.now();
    if (!typingEmitState.isTyping || typingEmitState.convId !== convId || now - typingEmitState.lastSentAt >= 1500) {
      typingEmitState.convId = convId;
      typingEmitState.isTyping = true;
      typingEmitState.lastSentAt = now;
      emitSocketTyping(convId, true);
    }

    if (typingEmitState.stopTimer) clearTimeout(typingEmitState.stopTimer);
    typingEmitState.stopTimer = setTimeout(() => {
      stopTypingSignal();
    }, 2500);
  }

  function clearPeerTyping(convId, userId = null) {
    const key = Number(convId);
    const entry = typingPeersByConv.get(key);
    if (!entry) return;
    if (userId !== null && Number(entry.userId) !== Number(userId)) return;
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    typingPeersByConv.delete(key);
    if (Number(state.activeConversationId) === key) {
      renderTypingIndicator();
    }
  }

  function clearAllPeerTyping() {
    typingPeersByConv.forEach((entry) => {
      if (entry && entry.timeoutId) clearTimeout(entry.timeoutId);
    });
    typingPeersByConv.clear();
    renderTypingIndicator();
  }

  function handleIncomingTyping(data) {
    if (!data || !data.conversationId) return;
    const convId = Number(data.conversationId);
    const senderId = Number(data.userId || 0);
    if (state.currentUser && senderId && Number(state.currentUser.id) === senderId) return;

    if (!data.isTyping) {
      clearPeerTyping(convId, senderId);
      return;
    }

    const existing = typingPeersByConv.get(convId);
    if (existing && existing.timeoutId) clearTimeout(existing.timeoutId);

    const timeoutId = setTimeout(() => {
      clearPeerTyping(convId, senderId);
    }, 3000);

    typingPeersByConv.set(convId, {
      userId: senderId,
      userName: data.userName || 'Participant',
      timeoutId,
    });

    if (Number(state.activeConversationId) === convId) {
      renderTypingIndicator();
    }
  }

  function renderTypingIndicator() {
    const wrapEl = document.getElementById('messages-typing-indicator');
    const textEl = document.getElementById('messages-typing-text');
    if (!wrapEl || !textEl) return;

    const convId = Number(state.activeConversationId || 0);
    const entry = convId ? typingPeersByConv.get(convId) : null;
    if (!entry) {
      wrapEl.classList.add('hidden');
      textEl.textContent = '';
      return;
    }

    const displayName = String(entry.userName || 'Participant').trim().split(/\s+/)[0] || 'Participant';
    textEl.textContent = `${displayName} is typing...`;
    wrapEl.classList.remove('hidden');
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      const inputEl = document.getElementById('messages-compose-input');
      if (inputEl) {
        inputEl.addEventListener('input', () => {
          autoResizeComposeInput();
          handleLocalTypingInput();
        });
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') stopTypingSignal();
      });
      window.addEventListener('pagehide', stopTypingSignal);
      window.addEventListener('beforeunload', stopTypingSignal);
    });
  }

  function handleInputKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendSubmit(e);
    }
  }

  async function handleSendSubmit(e) {
    if (e) e.preventDefault();
    if (!state.activeConversationId) return;

    const inputEl = document.getElementById('messages-compose-input');
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text) {
      window.GeoSafeToast?.flagInvalidField?.(inputEl, 'Please enter a message before sending.');
      return;
    }

    const clientMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    inputEl.value = '';
    autoResizeComposeInput();
    stopTypingSignal();

    const optimisticMsg = {
      id: null,
      conversationId: state.activeConversationId,
      senderUserId: state.currentUser ? state.currentUser.id : 0,
      senderName: state.currentUser ? state.currentUser.name : 'You',
      senderRole: state.role,
      clientMessageId,
      body: text,
      createdAt: new Date().toISOString(),
      isRead: false,
      _localStatus: 'sending',
    };

    state.messages.push(optimisticMsg);
    renderMessagesThread();
    scrollToBottom();

    await transmitMessage(optimisticMsg);
  }

  async function transmitMessage(msgObj) {
    try {
      const res = await window.geoSafeStore.request(
        `/messages/conversations/${msgObj.conversationId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            body: msgObj.body,
            clientMessageId: msgObj.clientMessageId,
          }),
        }
      );
      if (res && res.message) {
        upsertMessageInThread(res.message);
        await loadConversationsList({ silent: true });
      }
    } catch (err) {
      msgObj._localStatus = 'failed';
      renderMessagesThread();
      showErrorBanner(err.message || 'Message delivery failed. Check your connection and retry.');
    }
  }

  async function retryMessage(clientMessageId) {
    const msgObj = state.messages.find((m) => m.clientMessageId === clientMessageId);
    if (!msgObj) return;
    dismissErrorBanner();
    msgObj._localStatus = 'sending';
    renderMessagesThread();
    await transmitMessage(msgObj);
  }

  async function refreshAll() {
    dismissErrorBanner();
    await loadConversationsList();
    if (state.activeConversationId) {
      await loadConversationHistory(state.activeConversationId);
    }
  }

  window.GeoSafeMessages = {
    selectConversation,
    backToConversationList,
    handleSendSubmit,
    handleInputKeydown,
    retryMessage,
    refreshAll,
    dismissErrorBanner,
    getActiveConversationId: () => state.activeConversationId,
  };

  document.addEventListener('DOMContentLoaded', initMessagesPage);
})(window);
