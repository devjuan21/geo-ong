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
    activeBox: 'active',
    activeConversationId: null,
    activeConversation: null,
    messages: [],
    hasMoreOlder: false,
    oldestMessageId: null,
    newestMessageId: null,
    isLoadingList: false,
    isLoadingThread: false,
    isLoadingOlder: false,
  };

  let listFetchSeq = 0;
  let historyFetchSeq = 0;
  let historyAbortController = null;
  let olderAbortController = null;
  let listAbortController = null;
  let inFlightListPromise = null;
  let realtimeListenerBound = false;

  function isAbortError(err) {
    if (!err) return false;
    if (err.isAborted || err.name === 'AbortError') return true;
    const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
    return msg.includes('signal is aborted') || msg === 'request cancelled.';
  }

  if (typeof window !== 'undefined') {
    const abortActiveMessageFetches = () => {
      if (historyAbortController) {
        try { historyAbortController.abort(new DOMException('Page closed', 'AbortError')); } catch (_) {}
        historyAbortController = null;
      }
      if (olderAbortController) {
        try { olderAbortController.abort(new DOMException('Page closed', 'AbortError')); } catch (_) {}
        olderAbortController = null;
      }
      if (listAbortController) {
        try { listAbortController.abort(new DOMException('Page closed', 'AbortError')); } catch (_) {}
        listAbortController = null;
      }
    };
    window.addEventListener('pagehide', abortActiveMessageFetches);
    window.addEventListener('beforeunload', abortActiveMessageFetches);
  }

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
      return '<span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">Completed</span>';
    }
    if (s === 'Closed') {
      return '<span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">Closed</span>';
    }
    return '<span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>';
  }

  function syncUnreadHeaderBadges() {
    const totalUnread = (state.conversations || []).reduce((sum, c) => sum + Number(c.unreadCount || 0), 0);
    const unreadPill = document.getElementById('messages-unread-pill');
    if (unreadPill) {
      unreadPill.textContent = `${totalUnread} Unread`;
      unreadPill.classList.toggle('hidden', totalUnread <= 0);
    }
    const badgeSelector = state.role === 'Responder' ? '[data-resp-nav-unread="messages"]' : '[data-nav-unread="messages"]';
    document.querySelectorAll(badgeSelector).forEach((el) => {
      el.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
      el.classList.toggle('hidden', totalUnread <= 0);
    });
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

    if (!realtimeListenerBound) {
      realtimeListenerBound = true;
      window.addEventListener('geosafe:realtime-update', (ev) => {
        handleRealtimeUpdate(ev.detail || {});
      });
    }

    if (window.geoSafeStore) {
      state.currentUser = window.geoSafeStore.getCurrentUser();
      // Start socket connection in parallel instead of blocking the conversation list fetch
      window.geoSafeStore.initRealtimeSocket().then(() => {
        if (state.activeConversationId) {
          joinSocketConversation(state.activeConversationId);
        }
      }).catch(() => {});
    }

    await loadConversationsList();

    const params = new URLSearchParams(window.location.search || '');
    const reqConvId = params.get('conversationId');
    const reqRescueId = params.get('rescueId');

    if (reqConvId) {
      const targetId = Number(reqConvId);
      const isActiveMatch = (state.conversations || []).some((c) => Number(c.id) === targetId);
      const isArchivedMatch = (state.archivedConversations || []).some((c) => Number(c.id) === targetId);
      if (isArchivedMatch && typeof openArchiveDrawer === 'function') {
        openArchiveDrawer();
      }
      if (isActiveMatch || isArchivedMatch) {
        await selectConversation(targetId);
      } else if (window.GeoSafeToast) {
        window.GeoSafeToast.error('Unable to open this responder conversation.');
      }
    } else if (reqRescueId) {
      const match =
        state.conversations.find((c) => Number(c.rescueId) === Number(reqRescueId)) ||
        (state.archivedConversations || []).find((c) => Number(c.rescueId) === Number(reqRescueId));
      if (match) {
        if (match.isArchived && typeof openArchiveDrawer === 'function') {
          openArchiveDrawer();
        }
        await selectConversation(match.id);
      } else if (window.GeoSafeToast) {
        window.GeoSafeToast.error('No responder conversation is available for this rescue request yet.');
      }
    } else if (state.conversations.length > 0 && window.innerWidth >= 1024) {
      await selectConversation(state.conversations[0].id);
    }
  }

  async function handleRealtimeUpdate({ event, data }) {
    if (event === 'conversation:new-message' && data) {
      const msgConvId = Number(data.conversationId);
      clearPeerTyping(msgConvId, data.senderUserId);
      const isActive = Boolean(state.activeConversationId && msgConvId === Number(state.activeConversationId));
      const isOwnMsg = Boolean(state.currentUser && Number(data.senderUserId) === Number(state.currentUser.id));

      if (isActive) {
        const shouldScroll = isNearBottom() || isOwnMsg;
        upsertMessageInThread(data);
        if (shouldScroll) scrollToBottom();
        if (!isOwnMsg) {
          markActiveConversationRead();
        }
      }

      // Update conversation preview and unread count in-memory without a full list re-fetch
      const convItem = state.conversations.find((c) => Number(c.id) === msgConvId);
      if (convItem) {
        convItem.lastMessagePreview = data.body || convItem.lastMessagePreview;
        convItem.lastMessageAt = data.createdAt || convItem.lastMessageAt;
        convItem.lastMessageSenderId = Number(data.senderUserId || 0);
        if (!isActive && !isOwnMsg) {
          convItem.unreadCount = Number(convItem.unreadCount || 0) + 1;
        }
        if (convItem.isArchived) {
          convItem.isArchived = false;
          convItem.archivedAt = null;
        }
        state.conversations.sort((a, b) => {
          const ta = new Date(a.lastMessageAt || a.createdAt || 0).getTime();
          const tb = new Date(b.lastMessageAt || b.createdAt || 0).getTime();
          return tb - ta || Number(b.id) - Number(a.id);
        });
        renderConversationsList();
        syncUnreadHeaderBadges();
      } else {
        await loadConversationsList({ silent: true });
      }
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
      return;
    }

    if (event === 'conversation:typing' && data) {
      handleIncomingTyping(data);
      return;
    }

    if (event === 'conversation:archive-updated' && data) {
      const convId = Number(data.conversationId);
      const isArch = Boolean(data.isArchived);
      const item = state.conversations.find((c) => Number(c.id) === convId);
      if (item) {
        item.isArchived = isArch;
        if (state.activeConversation && Number(state.activeConversation.id) === convId) {
          state.activeConversation.isArchived = isArch;
          updateThreadArchiveButton(state.activeConversation);
        }
        renderConversationsList();
      } else {
        await loadConversationsList({ silent: true });
      }
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
          state.hasMoreOlder = false;
          renderActiveThreadState();
          showErrorBanner('Your access to that conversation has been updated.');
        } else if (event === 'reconnect-sync' && state.newestMessageId) {
          await loadConversationHistory(state.activeConversationId, {
            silent: true,
            afterId: state.newestMessageId,
          });
        } else if (event !== 'messages:unread-update') {
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
    if (inFlightListPromise && silent) {
      return inFlightListPromise;
    }

    const loadingEl = document.getElementById('messages-conversations-loading');
    const emptyEl = document.getElementById('messages-conversations-empty');
    const seq = ++listFetchSeq;

    const reqController = new AbortController();
    listAbortController = reqController;

    if (!silent && loadingEl && state.conversations.length === 0) {
      loadingEl.classList.remove('hidden');
    }
    if (!silent && emptyEl) emptyEl.classList.add('hidden');

    const run = (async () => {
      try {
        const data = await window.geoSafeStore.request('/messages/conversations', {
          method: 'GET',
          signal: reqController.signal,
        });
        if (seq !== listFetchSeq) return;
        dismissErrorBanner();

        state.conversations = Array.isArray(data && data.conversations) ? data.conversations : [];
        state.pendingRequests = Array.isArray(data && data.pendingRequests) ? data.pendingRequests : [];

        if (loadingEl) loadingEl.classList.add('hidden');

        syncUnreadHeaderBadges();
        renderPendingRequestsNotice();
        renderConversationsList();

        if (emptyEl) {
          emptyEl.classList.toggle('hidden', state.conversations.length > 0);
        }
      } catch (err) {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (isAbortError(err) || seq !== listFetchSeq) {
          return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');
        showErrorBanner(err.message || 'Unable to load conversations from server.');
      } finally {
        if (listAbortController === reqController) {
          listAbortController = null;
        }
        if (inFlightListPromise === run) {
          inFlightListPromise = null;
        }
      }
    })();

    inFlightListPromise = run;
    return run;
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
            <div class="p-3 rounded-md bg-white border border-[#FFE872] shadow-subtle flex flex-wrap items-center justify-between gap-2 text-xs">
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
          <div class="p-3 rounded-md bg-white border border-[#FFE872] shadow-subtle flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <span class="font-mono font-bold text-[#8A6800]">${escapeHtml(pr.rescueReference)}</span>
              <span class="font-bold text-[#202020] ml-1.5">${escapeHtml(pr.emergencyType)}</span>
              <span class="text-[#777777] block sm:inline sm:ml-2 text-[11px]">${escapeHtml(statusMsg)}</span>
            </div>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-[#8A6800] border border-[#FFE872]">
              Messaging Locked Until Accepted
            </span>
          </div>
        `;
      })
      .join('');
  }

  function openArchiveDrawer() {
    renderArchivedDrawerList();
    document.getElementById('messages-archive-drawer')?.classList.remove('hidden');
  }

  function closeArchiveDrawer() {
    document.getElementById('messages-archive-drawer')?.classList.add('hidden');
  }

  function updateThreadArchiveButton(conv) {
    const btn = document.getElementById('thread-archive-btn');
    const labelEl = document.getElementById('thread-archive-btn-label');
    if (!btn || !labelEl || !conv) return;
    btn.classList.remove('hidden');
    const isArch = Boolean(conv.isArchived);
    labelEl.textContent = isArch ? 'Unarchive' : 'Archive';
    btn.title = isArch ? 'Restore to active chats' : 'Archive conversation';
  }

  async function toggleArchiveConversation(conversationId, shouldArchive) {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0) return;
    dismissErrorBanner();

    const action = shouldArchive ? 'archive' : 'unarchive';
    try {
      const res = await window.geoSafeStore.request(
        `/messages/conversations/${convId}/${action}`,
        { method: 'PATCH' }
      );
      const nextArchived = res && typeof res.isArchived === 'boolean' ? res.isArchived : Boolean(shouldArchive);
      const item = state.conversations.find((c) => Number(c.id) === convId);
      if (item) {
        item.isArchived = nextArchived;
        item.archivedAt = res && res.archivedAt ? res.archivedAt : null;
      }
      if (state.activeConversation && Number(state.activeConversation.id) === convId) {
        state.activeConversation.isArchived = nextArchived;
        updateThreadArchiveButton(state.activeConversation);
      }
      renderConversationsList();
    } catch (err) {
      if (isAbortError(err)) return;
      showErrorBanner(err.message || `Unable to ${action} conversation.`);
    }
  }

  function toggleActiveConversationArchive() {
    if (!state.activeConversation) return;
    return toggleArchiveConversation(state.activeConversation.id, !state.activeConversation.isArchived);
  }

  function buildConversationRowHtml(c, { isArchivedView = false } = {}) {
    const isSelected = Number(c.id) === Number(state.activeConversationId);
    const counterpart = state.role === 'Resident' ? c.responder : c.resident;
    const preview = c.lastMessagePreview
      ? escapeHtml(c.lastMessagePreview)
      : 'No messages yet — start the conversation';
    const timeStr = c.lastMessageAt ? formatManilaTime(c.lastMessageAt) : formatManilaTime(c.createdAt);
    const unread = Number(c.unreadCount || 0);
    const isArch = Boolean(c.isArchived);
    const clickAction = isArchivedView
      ? `window.GeoSafeMessages.closeArchiveDrawer(); window.GeoSafeMessages.selectConversation(${c.id});`
      : `window.GeoSafeMessages.selectConversation(${c.id});`;

    return `
      <div class="w-full p-3.5 transition-colors flex items-start justify-between gap-2.5 ${
        isSelected && !isArchivedView ? 'bg-slate-50 border-l-4 border-l-slate-900' : 'hover:bg-slate-50'
      }">
        <button type="button" onclick="${clickAction}"
          class="min-w-0 flex-1 text-left space-y-1 focus:outline-none">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-semibold text-slate-900 truncate">${escapeHtml(counterpart.name)}</span>
            <span class="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 gs-tabular">${escapeHtml(c.rescueReference)}</span>
          </div>
          <p class="text-[11px] ${unread > 0 ? 'font-semibold text-slate-900' : 'text-slate-600'} truncate">${preview}</p>
          <div class="flex items-center gap-2 text-[10px] text-slate-500 gs-tabular">
            <span>${escapeHtml(c.emergencyType)}</span>
            <span>•</span>
            <span>${escapeHtml(timeStr)}</span>
          </div>
        </button>
        <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
          <div class="flex items-center gap-1.5">
            ${renderStatusBadge(c.conversationStatus)}
            <button type="button"
              onclick="event.stopPropagation(); window.GeoSafeMessages.toggleArchiveConversation(${c.id}, ${!isArch})"
              class="p-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
              title="${isArch ? 'Restore to active chats' : 'Archive conversation'}"
              aria-label="${isArch ? 'Restore to active chats' : 'Archive conversation'}">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                ${
                  isArch
                    ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path>'
                    : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path>'
                }
              </svg>
            </button>
          </div>
          ${
            unread > 0
              ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white gs-tabular">${unread}</span>`
              : ''
          }
        </div>
      </div>
    `;
  }

  function renderArchivedDrawerList() {
    const listEl = document.getElementById('messages-archived-list');
    const emptyEl = document.getElementById('messages-archived-empty');
    const archivedItems = state.conversations.filter((c) => Boolean(c.isArchived));

    if (emptyEl) {
      emptyEl.classList.toggle('hidden', archivedItems.length > 0);
    }
    if (!listEl) return;
    listEl.innerHTML = archivedItems.map((c) => buildConversationRowHtml(c, { isArchivedView: true })).join('');
  }

  function updateActiveConversationCountBadge() {
    const countBadge = document.getElementById('messages-active-count-badge');
    if (!countBadge) return;
    const activeCount = state.conversations.filter((c) => !c.isArchived).length;
    if (activeCount <= 0) {
      countBadge.classList.add('hidden');
      countBadge.textContent = '';
    } else {
      countBadge.classList.remove('hidden');
      countBadge.textContent = `${activeCount} Conversation${activeCount === 1 ? '' : 's'}`;
    }
  }

  function renderConversationsList() {
    const listEl = document.getElementById('messages-conversations-list');
    const emptyEl = document.getElementById('messages-conversations-empty');
    const activeItems = state.conversations.filter((c) => !c.isArchived);

    updateActiveConversationCountBadge();

    if (emptyEl) {
      emptyEl.classList.toggle('hidden', activeItems.length > 0);
    }

    if (listEl) {
      listEl.innerHTML = activeItems.map((c) => buildConversationRowHtml(c, { isArchivedView: false })).join('');
    }

    renderArchivedDrawerList();
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

  function exitMobileMessages() {
    stopTypingSignal();
    exitMobileFullscreenThread();
    const fallback = state.role === 'Responder' ? 'responder-dashboard.html' : 'index.html';
    try {
      if (document.referrer && new URL(document.referrer).origin === window.location.origin) {
        const refPath = new URL(document.referrer).pathname.toLowerCase();
        if (!refPath.endsWith('messages.html') && !refPath.endsWith('responder-messages.html')) {
          window.history.back();
          return;
        }
      }
    } catch (_) {}
    window.location.href = fallback;
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
        syncMobileThreadViewportHeight();
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
    state.hasMoreOlder = false;
    state.oldestMessageId = null;
    state.newestMessageId = null;
    state.isLoadingOlder = false;

    // Immediately show thread header from cached conversation list while messages load
    const cachedConv = state.conversations.find((c) => Number(c.id) === convId);
    if (cachedConv) {
      state.activeConversation = {
        ...cachedConv,
        canSend: !['Completed', 'Closed'].includes(cachedConv.conversationStatus),
      };
      state.messages = [];
      state.isLoadingThread = true;
      renderActiveThreadState();
    }

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
    if (loaded && Number(state.activeConversationId) === convId) {
      joinSocketConversation(convId);
      markActiveConversationRead();
    }
  }

  function backToConversationList() {
    stopTypingSignal();
    exitMobileFullscreenThread();
    if (historyAbortController) {
      try { historyAbortController.abort(new DOMException('Closed conversation', 'AbortError')); } catch (_) {}
      historyAbortController = null;
    }
    if (olderAbortController) {
      try { olderAbortController.abort(new DOMException('Closed conversation', 'AbortError')); } catch (_) {}
      olderAbortController = null;
    }
    if (state.activeConversationId) {
      leaveSocketConversation(state.activeConversationId);
    }
    state.activeConversationId = null;
    state.activeConversation = null;
    state.messages = [];
    state.hasMoreOlder = false;
    state.oldestMessageId = null;
    state.newestMessageId = null;
    state.isLoadingThread = false;
    state.isLoadingOlder = false;

    const params = new URLSearchParams(window.location.search || '');
    if (params.get('from') === 'report-rescue') {
      window.location.href = 'report-rescue.html';
      return;
    }
    renderActiveThreadState();
    renderConversationsList();
    const listPanel = document.getElementById('messages-list-panel');
    const threadPanel = document.getElementById('messages-thread-panel');
    if (listPanel && threadPanel) {
      listPanel.classList.remove('hidden');
      threadPanel.classList.add('hidden');
      threadPanel.classList.remove('flex');
    }
  }

  async function loadConversationHistory(conversationId, { silent = false, afterId = null } = {}) {
    const convId = Number(conversationId);
    if (!Number.isInteger(convId) || convId <= 0) return false;

    // Avoid cancelling an active foreground load with a duplicate silent refresh for the same thread
    if (silent && state.isLoadingThread && Number(state.activeConversationId) === convId) {
      return false;
    }

    const seq = ++historyFetchSeq;
    if (historyAbortController) {
      try { historyAbortController.abort(new DOMException('Switched conversation', 'AbortError')); } catch (_) {}
    }
    if (olderAbortController && !afterId) {
      try { olderAbortController.abort(new DOMException('Switched conversation', 'AbortError')); } catch (_) {}
      olderAbortController = null;
    }

    const reqController = new AbortController();
    historyAbortController = reqController;
    if (!silent) {
      state.isLoadingThread = true;
    }

    try {
      const qs = afterId
        ? `?limit=100&afterId=${encodeURIComponent(afterId)}`
        : '?limit=40';
      const data = await window.geoSafeStore.request(
        `/messages/conversations/${convId}/messages${qs}`,
        { method: 'GET', signal: reqController.signal }
      );
      if (seq !== historyFetchSeq || Number(state.activeConversationId) !== convId) {
        return false;
      }
      dismissErrorBanner();
      state.isLoadingThread = false;
      state.activeConversation = data.conversation;
      const serverMessages = Array.isArray(data.messages) ? data.messages : [];
      const pagination = data.pagination || {};

      if (afterId) {
        serverMessages.forEach((m) => upsertMessageInThread(m, { skipRender: true }));
        if (pagination.newestMessageId) {
          state.newestMessageId = Math.max(Number(state.newestMessageId || 0), Number(pagination.newestMessageId));
        }
        renderActiveThreadState();
        if (isNearBottom()) scrollToBottom();
      } else {
        // Preserve any local failed/sending optimistic messages not yet on server
        const serverClientIds = new Set(
          serverMessages.map((m) => m.clientMessageId).filter(Boolean)
        );
        const localPending = state.messages.filter(
          (m) =>
            Number(m.conversationId) === convId &&
            (m._localStatus === 'sending' || m._localStatus === 'failed') &&
            m.clientMessageId &&
            !serverClientIds.has(m.clientMessageId)
        );

        state.messages = [...serverMessages, ...localPending];
        state.hasMoreOlder = Boolean(pagination.hasMoreOlder);
        state.oldestMessageId = pagination.oldestMessageId || (serverMessages[0] ? serverMessages[0].id : null);
        state.newestMessageId =
          pagination.newestMessageId ||
          (serverMessages.length ? serverMessages[serverMessages.length - 1].id : null);
        renderActiveThreadState();
        if (!silent) scrollToBottom();
      }
      return true;
    } catch (err) {
      if (isAbortError(err) || seq !== historyFetchSeq || Number(state.activeConversationId) !== convId) {
        return false;
      }
      state.isLoadingThread = false;
      state.activeConversationId = null;
      state.activeConversation = null;
      state.messages = [];
      state.hasMoreOlder = false;
      renderActiveThreadState();
      renderConversationsList();
      showErrorBanner(err.message || 'You are not authorized to access this conversation.');
      return false;
    } finally {
      if (historyAbortController === reqController) {
        historyAbortController = null;
        state.isLoadingThread = false;
      }
    }
  }

  async function loadOlderMessages() {
    const convId = Number(state.activeConversationId);
    if (!convId || !state.hasMoreOlder || state.isLoadingOlder || !state.oldestMessageId) {
      return;
    }
    const bodyEl = document.getElementById('messages-thread-body');
    const prevScrollHeight = bodyEl ? bodyEl.scrollHeight : 0;
    const prevScrollTop = bodyEl ? bodyEl.scrollTop : 0;

    state.isLoadingOlder = true;
    renderMessagesThread();

    const reqController = new AbortController();
    olderAbortController = reqController;

    try {
      const data = await window.geoSafeStore.request(
        `/messages/conversations/${convId}/messages?limit=40&beforeId=${encodeURIComponent(state.oldestMessageId)}`,
        { method: 'GET', signal: reqController.signal }
      );
      if (Number(state.activeConversationId) !== convId) return;

      const older = Array.isArray(data && data.messages) ? data.messages : [];
      const pagination = (data && data.pagination) || {};
      const existingIds = new Set(state.messages.map((m) => Number(m.id)).filter(Boolean));
      const uniqueOlder = older.filter((m) => !existingIds.has(Number(m.id)));

      state.messages = [...uniqueOlder, ...state.messages];
      state.hasMoreOlder = Boolean(pagination.hasMoreOlder);
      if (pagination.oldestMessageId) {
        state.oldestMessageId = pagination.oldestMessageId;
      } else if (uniqueOlder.length) {
        state.oldestMessageId = uniqueOlder[0].id;
      }
      state.isLoadingOlder = false;
      renderMessagesThread();

      if (bodyEl) {
        const newScrollHeight = bodyEl.scrollHeight;
        bodyEl.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
      }
    } catch (err) {
      state.isLoadingOlder = false;
      if (!isAbortError(err)) {
        renderMessagesThread();
      }
    } finally {
      if (olderAbortController === reqController) {
        olderAbortController = null;
      }
    }
  }

  async function markActiveConversationRead() {
    if (!state.activeConversationId) return;
    const convId = Number(state.activeConversationId);
    try {
      await window.geoSafeStore.request(
        `/messages/conversations/${convId}/read`,
        { method: 'POST' }
      );
      const conv = state.conversations.find((c) => Number(c.id) === convId);
      if (conv) conv.unreadCount = 0;
      renderConversationsList();
      syncUnreadHeaderBadges();
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
    updateThreadArchiveButton(conv);

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

  function upsertMessageInThread(msg, { skipRender = false } = {}) {
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
      state.messages.sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (ta !== tb) return ta - tb;
        return Number(a.id || Number.MAX_SAFE_INTEGER) - Number(b.id || Number.MAX_SAFE_INTEGER);
      });
    }
    if (msg.id) {
      state.newestMessageId = Math.max(Number(state.newestMessageId || 0), Number(msg.id));
    }
    if (!skipRender) {
      renderMessagesThread();
    }
  }

  function renderMessagesThread() {
    const bodyEl = document.getElementById('messages-thread-body');
    if (!bodyEl) return;

    if (state.isLoadingThread && !state.messages.length) {
      bodyEl.innerHTML = `
        <div class="py-12 text-center">
          <div class="inline-block animate-spin rounded-full h-5 w-5 border-2 border-slate-300 border-t-slate-900 mb-2"></div>
          <p class="text-xs text-slate-500">Loading messages...</p>
        </div>
      `;
      return;
    }

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

    const loadOlderHtml = state.hasMoreOlder
      ? `<div class="pb-2 text-center">
           <button type="button" onclick="window.GeoSafeMessages.loadOlderMessages()"
             ${state.isLoadingOlder ? 'disabled' : ''}
             class="px-3 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-600 disabled:opacity-60">
             ${state.isLoadingOlder ? 'Loading older messages...' : 'Load older messages'}
           </button>
         </div>`
      : '';

    bodyEl.innerHTML = loadOlderHtml + state.messages
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
            <div class="max-w-[82%] sm:max-w-[72%] rounded-lg px-3.5 py-2 text-xs ${
              isMine
                ? 'bg-slate-900 text-white rounded-br-none'
                : 'bg-white border border-slate-200 text-slate-900 rounded-bl-none shadow-subtle'
            }">
              ${
                !isMine
                  ? `<span class="block text-[10px] font-semibold text-amber-700 mb-0.5">${escapeHtml(
                      m.senderName
                    )} (${escapeHtml(m.senderRole)})</span>`
                  : ''
              }
              <p class="whitespace-pre-line leading-relaxed break-words">${escapeHtml(m.body)}</p>
            </div>
            <div class="mt-1 px-1 text-[10px] text-slate-500 flex items-center gap-1 gs-tabular">
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
    const activeConv = state.activeConversation;
    const isClosed = Boolean(
      activeConv &&
      Number(activeConv.id) === convId &&
      (activeConv.canSend === false || ['Closed', 'Completed'].includes(String(activeConv.conversationStatus || '')))
    );
    if (isClosed && convId) {
      typingPeersByConv.delete(convId);
    }

    const entry = convId && !isClosed ? typingPeersByConv.get(convId) : null;
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
      const bodyEl = document.getElementById('messages-thread-body');
      if (bodyEl) {
        bodyEl.addEventListener('scroll', () => {
          if (bodyEl.scrollTop < 60 && state.hasMoreOlder && !state.isLoadingOlder && !state.isLoadingThread) {
            loadOlderMessages();
          }
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
        const convItem = state.conversations.find((c) => Number(c.id) === Number(msgObj.conversationId));
        if (convItem) {
          convItem.lastMessagePreview = res.message.body || convItem.lastMessagePreview;
          convItem.lastMessageAt = res.message.createdAt || convItem.lastMessageAt;
          convItem.lastMessageSenderId = Number(res.message.senderUserId || 0);
          renderConversationsList();
        }
      }
    } catch (err) {
      if (isAbortError(err)) return;
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
    exitMobileMessages,
    openArchiveDrawer,
    closeArchiveDrawer,
    toggleArchiveConversation,
    toggleActiveConversationArchive,
    loadOlderMessages,
    handleSendSubmit,
    handleInputKeydown,
    retryMessage,
    refreshAll,
    dismissErrorBanner,
    getActiveConversationId: () => state.activeConversationId,
  };

  document.addEventListener('DOMContentLoaded', initMessagesPage);
})(window);
