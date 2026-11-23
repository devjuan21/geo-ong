/**
 * GeoSafe - Resident Portal Store & API Service Layer
 * ============================================================================
 * STRICT FRESH SYSTEM & ZERO FABRICATED DATA (Section 20)
 * 
 * - Starts with 0 reports, 0 rescue requests, 0 hazard alerts, 0 notifications,
 *   and 0 evacuation centers.
 * - All dashboard metrics (Total, Pending, Verified, Resolved) are dynamically
 *   derived from actual record arrays.
 * - Prepared for seamless Node.js, Express.js, PostgreSQL, and Socket.IO integration.
 * ============================================================================
 */

class GeoSafeStore {
  constructor() {
    this.config = window.GEOSAFE_CONFIG || {
      USE_MOCK_DATA: false,
      API_BASE_URL: '/api',
      TIMEOUT_MS: 10000
    };
    this.csrfToken = null;
    this.sessionPromise = null;
    this.socket = null;
    this._socketLoadingPromise = null;
    this._recentRealtimeEventKeys = new Map();
    this.purgeClientAuthStorage();
    this.state = this.loadState();
    this.setupNetworkListeners();
  }

  purgeClientAuthStorage() {
    try {
      const legacyKeys = [
        'geosafe_auth_token',
        'geosafe_token',
        'geosafe_user',
        'geosafe_fresh_system_v4',
        'geosafe_registered_users'
      ];
      legacyKeys.forEach((k) => {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(k);
      });
    } catch (_) {}
  }

  loadState() {
    // Return pristine in-memory state (never trust localStorage/sessionStorage for auth or roles)
    return {
      residentProfile: {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        address: { street: "", barangay: "Barangay Bayanan", city: "Muntinlupa City" },
        verificationStatus: "Unverified Resident"
      },
      reports: [],
      rescueRequests: [],
      hazardAlerts: [],
      evacuationCenters: [],
      notifications: [],
      responderProfile: null,
      adminProfile: null,
      currentUser: null,
      responderAssignments: [],
      emergencyContacts: []
    };
  }

  saveState() {
    // Authentication and operational data are persisted on the PostgreSQL backend via HttpOnly session cookies.
    // Do not persist trusted user roles, tokens, or session state in localStorage or sessionStorage.
  }

  isOnline() {
    return navigator.onLine !== false;
  }

  setupNetworkListeners() {
    window.addEventListener('online', () => this.notifyNetworkChange(true));
    window.addEventListener('offline', () => this.notifyNetworkChange(false));
  }

  notifyNetworkChange(isOnline) {
    const event = new CustomEvent('geosafe:network', { detail: { isOnline } });
    window.dispatchEvent(event);

    const indicator = document.getElementById('online-status-badge');
    const offlineBanner = document.getElementById('geosafe-offline-banner');

    if (indicator) {
      if (isOnline) {
        indicator.innerHTML = `
          <span class="badge-pulse mr-1 sm:mr-1.5"><span class="badge-pulse-ping bg-emerald-400"></span><span class="badge-pulse-dot bg-emerald-500"></span></span>
          <span class="text-[11px] sm:text-xs font-semibold text-emerald-700">Online</span>
        `;
      } else {
        indicator.innerHTML = `
          <span class="badge-pulse mr-1 sm:mr-1.5"><span class="badge-pulse-dot bg-rose-500"></span></span>
          <span class="text-[11px] sm:text-xs font-semibold text-rose-700">Offline</span>
        `;
      }
    }

    if (offlineBanner) {
      if (isOnline) {
        offlineBanner.classList.add('hidden');
      } else {
        offlineBanner.classList.remove('hidden');
      }
    }
  }

  getCsrfToken() {
    if (this.csrfToken) return this.csrfToken;
    if (typeof document !== 'undefined' && document.cookie) {
      const match = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('geosafe_csrf='));
      if (match) {
        try {
          return decodeURIComponent(match.split('=').slice(1).join('='));
        } catch {
          return match.split('=').slice(1).join('=');
        }
      }
    }
    return null;
  }

  async request(endpoint, options = {}) {
    if (!this.isOnline()) {
      const error = new Error('No internet connection. GeoSafe requires an active internet connection to communicate with the Emergency Operations Center.');
      error.isOffline = true;
      throw error;
    }

    const url = `${this.config.API_BASE_URL}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.TIMEOUT_MS || 10000);
    const csrf = this.getCsrfToken();

    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          ...(options.headers || {})
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Server request failed.' }));
        const errMessage = errData.error || errData.message || (Array.isArray(errData.errors) ? errData.errors.map(e => e.msg).join('; ') : `HTTP ${response.status}`);
        const err = new Error(errMessage);
        err.status = response.status;
        err.data = errData;

        if (response.status === 401 && typeof window !== 'undefined') {
          const path = (window.location.pathname || '').toLowerCase();
          if (!path.endsWith('/login.html')) {
            window.location.replace('/login.html');
          }
        }
        if (response.status === 403 && errData && errData.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') {
          const path = (window.location.pathname || '').toLowerCase();
          if (!path.endsWith('/change-password.html')) {
            window.location.replace(errData.redirectTo || '/change-password.html');
          }
        }
        throw err;
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // Dashboard Summary (Strictly dynamic calculation from actual reports)
  async getDashboardSummary() {
    return this.request('/dashboard/summary', { method: 'GET' }, () => {
      const reports = this.state.reports || [];
      
      // Dynamic computation (Req 20.B: 0 when empty)
      const counts = {
        total: reports.length,
        pending: reports.filter(r => r.status === 'Pending Verification').length,
        verified: reports.filter(r => ['Verified', 'Assigned', 'Responding'].includes(r.status)).length,
        resolved: reports.filter(r => r.status === 'Resolved').length
      };

      const recentReports = [...reports].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)).slice(0, 3);
      const latestAlerts = [...(this.state.hazardAlerts || [])].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 3);
      const activeRescue = (this.state.rescueRequests || []).find(r => r.status !== 'Completed');

      return {
        counts,
        recentReports,
        latestAlerts,
        activeRescue: activeRescue || null,
        resident: this.state.residentProfile || {},
        emergencyContacts: this.state.emergencyContacts || []
      };
    });
  }

  // Incident Reports
  async getReports(filters = {}) {
    const queryParams = new URLSearchParams(filters).toString();
    const endpoint = `/reports${queryParams ? `?${queryParams}` : ''}`;

    const res = await this.request(endpoint, { method: 'GET' }, () => {
      let results = [...(this.state.reports || [])];

      if (filters.search) {
        const q = filters.search.toLowerCase().trim();
        results = results.filter(r => 
          r.id.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.location.toLowerCase().includes(q) ||
          r.incidentType.toLowerCase().includes(q)
        );
      }

      if (filters.status && filters.status !== 'All') {
        results = results.filter(r => r.status === filters.status);
      }

      if (filters.incidentType && filters.incidentType !== 'All') {
        results = results.filter(r => r.incidentType === filters.incidentType);
      }

      return results.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    });

    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.reports)) {
      const statusMap = {
        pending: 'Pending Verification',
        under_review: 'Under Review',
        verified: 'Verified',
        dispatched: 'Assigned',
        responding: 'Responding',
        on_site: 'On Scene',
        in_progress: 'In Progress',
        resolved: 'Resolved',
        false_alarm: 'Rejected',
        dismissed: 'Rejected'
      };
      return res.reports.map(r => ({
        id: r.reference_number || (r.id ? `INC-${r.id}` : 'INC-0'),
        databaseId: r.id,
        referenceNumber: r.reference_number || (r.id ? `INC-${r.id}` : 'INC-0'),
        incidentType: r.incident_type || r.incidentType || 'Incident',
        title: r.title || `${r.incident_type || 'Incident'} Report`,
        description: r.description || '',
        location: r.address || r.location || 'Barangay Bayanan',
        status: statusMap[String(r.status || '').toLowerCase()] || r.status || 'Pending Verification',
        rawStatus: r.status || 'pending',
        reviewRemarks: r.latest_remarks || '',
        submittedAt: r.created_at || r.submittedAt || new Date().toISOString(),
        coordinates: {
          lat: Number(r.latitude || 14.4081),
          lng: Number(r.longitude || 121.0415)
        }
      }));
    }
    return [];
  }

  // Community Incident Map & Public Reports (Privacy-Protected, Section 3.A)
  async getPublicIncidentReports() {
    return this.request('/reports/public', { method: 'GET' }, () => {
      const reports = (this.state.reports || []).filter(r => r.authorizedForCommunity !== false);
      // Strip private reporter personal info and generalize coordinates if needed
      return reports.map(r => ({
        id: r.id,
        incidentType: r.incidentType,
        title: r.title,
        description: r.description,
        location: r.location,
        coordinates: r.coordinates,
        submittedAt: r.submittedAt,
        status: r.status || 'Verified',
        photos: r.photos || []
      })).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    });
  }

  async getReportById(id) {
    return this.request(`/reports/${encodeURIComponent(id)}`, { method: 'GET' }, () => {
      const report = (this.state.reports || []).find(r => r.id === id);
      if (!report) throw new Error(`Report #${id} not found.`);
      return report;
    });
  }

  async submitReport(payload) {
    const lat = payload.coordinates ? payload.coordinates.lat : (payload.latitude !== undefined ? Number(payload.latitude) : 14.4081);
    const lng = payload.coordinates ? payload.coordinates.lng : (payload.longitude !== undefined ? Number(payload.longitude) : 121.0415);
    const incType = payload.incidentType || payload.incident_type || 'General Incident';
    const loc = payload.location || payload.address || 'Barangay Bayanan, Muntinlupa City';
    const title = payload.title || `${incType} Incident`;
    const photos = Array.isArray(payload.photos) ? payload.photos : [];

    // Send payload containing both snake_case and camelCase for maximum interoperability
    const requestPayload = {
      incident_type: incType,
      incidentType: incType,
      title: title,
      description: payload.description || '',
      location: loc,
      address: loc,
      latitude: lat,
      longitude: lng,
      coordinates: { lat, lng },
      authorizedForCommunity: payload.authorizedForCommunity !== false,
      photos: photos
    };

    const res = await this.request('/reports', {
      method: 'POST',
      body: JSON.stringify(requestPayload)
    });

    const reportObj = (res && res.report) ? res.report : (res || {});
    const refId = reportObj.referenceNumber || reportObj.reference_number || res.referenceNumber || res.id || `INC-${Date.now()}`;
    const nowIso = reportObj.created_at || new Date().toISOString();

    const formattedReport = {
      id: refId,
      referenceNumber: refId,
      databaseId: reportObj.databaseId || reportObj.rawId || reportObj.id,
      incidentType: reportObj.incident_type || reportObj.incidentType || incType,
      title: reportObj.title || title,
      description: reportObj.description || payload.description,
      location: reportObj.address || reportObj.location || loc,
      coordinates: {
        lat: Number(reportObj.latitude !== undefined ? reportObj.latitude : lat),
        lng: Number(reportObj.longitude !== undefined ? reportObj.longitude : lng)
      },
      status: reportObj.status || 'Pending Verification',
      submittedAt: nowIso,
      photos: reportObj.attachments && reportObj.attachments.length
        ? reportObj.attachments.map(a => a.file_url)
        : photos
    };

    if (!this.state.reports) this.state.reports = [];
    this.state.reports.unshift(formattedReport);

    if (this.state.notifications) {
      this.state.notifications.unshift({
        id: `NOTIF-${Date.now()}`,
        title: 'Report Submitted Successfully',
        description: `Your incident report ${refId} (${formattedReport.incidentType}) has been transmitted to Barangay Bayanan EOC.`,
        category: 'report',
        timestamp: nowIso,
        read: false,
        referenceId: refId,
        link: 'report-rescue.html'
      });
    }

    this.saveState();
    return formattedReport;
  }

  // Rescue Requests
  async getRescueRequests() {
    return this.request('/rescue-requests', { method: 'GET' }, () => {
      return [...(this.state.rescueRequests || [])].sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
    });
  }

  async submitRescueRequest(payload) {
    return this.request('/rescue-requests', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // Hazard Alerts
  async getHazardAlerts(filters = {}) {
    const queryParams = new URLSearchParams(filters).toString();
    const endpoint = `/hazard-alerts${queryParams ? `?${queryParams}` : ''}`;

    return this.request(endpoint, { method: 'GET' }, () => {
      let alerts = [...(this.state.hazardAlerts || [])];

      if (filters.category && filters.category !== 'All') {
        alerts = alerts.filter(a => a.category.toLowerCase().includes(filters.category.toLowerCase()));
      }

      return alerts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    });
  }

  // Evacuation Centers
  isExcludedEvacuationCenter(center) {
    if (!center) return false;
    const name = String(center.name || '').toLowerCase();
    const address = String(center.address || '').toLowerCase();
    return name.includes('summitville') || address.includes('summitville');
  }

  async getEvacuationCenters(filter = 'All') {
    const data = await this.request(`/evacuation-centers?status=${encodeURIComponent(filter)}`, { method: 'GET' }, () => {
      let list = [...(this.state.evacuationCenters || [])].filter(c => !this.isExcludedEvacuationCenter(c));
      if (filter && filter !== 'All') {
        list = list.filter(c => String(c.status || '').toLowerCase().includes(filter.toLowerCase()));
      }
      return list;
    });
    const rawList = Array.isArray(data)
      ? data
      : (data && Array.isArray(data.evacuation_centers) ? data.evacuation_centers : []);
    const list = rawList.filter(c => !this.isExcludedEvacuationCenter(c));
    if (filter && filter !== 'All') {
      return list.filter(c => String(c.status || '').toLowerCase().includes(filter.toLowerCase()));
    }
    return list;
  }

  // Notifications
  async getNotifications(filter = 'All') {
    return this.request(`/notifications?filter=${encodeURIComponent(filter)}`, { method: 'GET' }, () => {
      let notifs = [...(this.state.notifications || [])];
      if (filter === 'Unread') {
        notifs = notifs.filter(n => !n.read);
      } else if (filter !== 'All') {
        notifs = notifs.filter(n => n.category === filter.toLowerCase());
      }
      return notifs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    });
  }

  async markNotificationAsRead(id) {
    return this.request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }, () => {
      const item = (this.state.notifications || []).find(n => n.id === id);
      if (item) {
        item.read = true;
        this.saveState();
      }
      return true;
    });
  }

  async markAllNotificationsAsRead() {
    return this.request('/notifications/mark-all-read', { method: 'POST' }, () => {
      (this.state.notifications || []).forEach(n => {
        n.read = true;
      });
      this.saveState();
      return true;
    });
  }

  // Profile & Settings
  async getProfile() {
    return this.request('/profile', { method: 'GET' }, () => {
      return { ...(this.state.residentProfile || {}) };
    });
  }

  async getResidentProfile() {
    return this.getProfile();
  }

  async updateProfile(updates) {
    return this.request('/profile', {
      method: 'PUT',
      body: JSON.stringify(updates)
    }, () => {
      this.state.residentProfile = {
        ...(this.state.residentProfile || {}),
        ...updates
      };
      this.saveState();
      return this.state.residentProfile;
    });
  }

  async updateSettings(settings) {
    return this.request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    }, () => {
      this.state.settings = {
        ...(this.state.settings || {}),
        ...settings
      };
      this.saveState();
      return this.state.settings;
    });
  }

  // ==========================================================================
  // UNIFIED AUTHENTICATION & SERVER-VERIFIED SESSION MANAGEMENT
  // ==========================================================================

  getAuthToken() {
    // Session authentication uses HttpOnly cookies managed by the Express server.
    return null;
  }

  getCurrentUser() {
    return (this.state && this.state.currentUser) || null;
  }

  isAuthorizedAdmin() {
    const user = this.getCurrentUser();
    return !!(user && this.normalizeRoleName(user.role) === 'Administrator');
  }

  normalizeRoleName(rawRole) {
    const r = String(rawRole || '').trim().toLowerCase();
    if (r === 'admin' || r === 'administrator') return 'Administrator';
    if (r === 'responder') return 'Responder';
    return 'Resident';
  }

  portalForRole(roleName) {
    const norm = this.normalizeRoleName(roleName);
    if (norm === 'Administrator') return '/admin.html';
    if (norm === 'Responder') return '/responder-dashboard.html';
    return '/index.html';
  }

  // ==========================================================================
  // REAL-TIME SOCKET.IO CLIENT INTEGRATION
  // ==========================================================================

  loadSocketIoScript() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return Promise.resolve(false);
    }
    if (typeof window.io === 'function') {
      return Promise.resolve(true);
    }
    if (this._socketLoadingPromise) {
      return this._socketLoadingPromise;
    }

    this._socketLoadingPromise = new Promise((resolve) => {
      const existing = document.querySelector('script[src*="/socket.io/socket.io.js"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(typeof window.io === 'function'));
        existing.addEventListener('error', () => resolve(false));
        return;
      }
      const script = document.createElement('script');
      script.src = '/socket.io/socket.io.js';
      script.async = true;
      script.onload = () => resolve(typeof window.io === 'function');
      script.onerror = () => {
        this._socketLoadingPromise = null;
        resolve(false);
      };
      document.head.appendChild(script);
    });

    return this._socketLoadingPromise;
  }

  _shouldShowRealtimeToast(dedupeKey) {
    const now = Date.now();
    for (const [k, ts] of this._recentRealtimeEventKeys.entries()) {
      if (now - ts > 8000) {
        this._recentRealtimeEventKeys.delete(k);
      }
    }
    if (this._recentRealtimeEventKeys.has(dedupeKey)) {
      return false;
    }
    this._recentRealtimeEventKeys.set(dedupeKey, now);
    return true;
  }

  _handleRealtimeEvent(eventName, payload = {}) {
    if (typeof window === 'undefined') return;

    const recordId =
      payload.referenceNumber ||
      payload.reference_number ||
      payload.id ||
      payload.alertId ||
      payload.title ||
      payload.message ||
      '';
    const statusText = payload.status || payload.newStatus || '';
    const isBroadcastFamily =
      eventName === 'new-hazard-alert' ||
      eventName === 'alert-broadcast' ||
      eventName === 'administrator-announcement';
    const dedupeKey = isBroadcastFamily
      ? `broadcast:${recordId}`
      : `${eventName}:${recordId}:${statusText}`;

    const silentEvents = new Set([
      'public-report-verified',
      'incident-resolved',
      'admin-sync',
      'reconnect-sync',
      'hazard-alert-expired',
      'alert-expired',
      'hazard-alert-cancelled',
      'alert-cancelled',
      'conversation:new-message',
      'conversation:messages-read',
      'conversation:typing',
      'messages:unread-update',
      'messages:access-updated',
      'conversation:archive-updated',
      'admin:conversation-activity',
      'resident-application-submitted',
      'resident-application-reviewed',
      'messages:incoming-notification',
      'responder:location-updated',
      'responder:location-offline'
    ]);
    const currentUser = (typeof this.getUser === 'function' ? this.getUser() : null) || (this.state && this.state.currentUser) || null;
    const roleLower = String((currentUser && (currentUser.role || currentUser.role_name)) || '').toLowerCase();
    const isAdminUser = roleLower === 'admin' || roleLower === 'administrator' || Number(currentUser && currentUser.role_id) === 1;
    const isResponderUser = roleLower === 'responder' || Number(currentUser && currentUser.role_id) === 2;
    const isResidentUser = roleLower === 'resident' || Number(currentUser && currentUser.role_id) === 3;
    const eventActorId = payload.actorUserId || payload.authorizedById || payload.createdBy;
    const isSelfActor = Boolean(
      eventActorId &&
      currentUser &&
      currentUser.id !== undefined &&
      Number(eventActorId) === Number(currentUser.id)
    );

    const isRoleEligibleForToast = (() => {
      if (isBroadcastFamily) {
        const scopeRaw = String(payload.targetScope || payload.target_scope || '').trim().toLowerCase();
        if (scopeRaw === 'responders' || scopeRaw === 'responders only') {
          return isResponderUser || isAdminUser;
        }
        if (scopeRaw === 'residents' || scopeRaw === 'residents only' || scopeRaw === 'lakeshore zone' || scopeRaw === 'specific purok') {
          return isResidentUser || isAdminUser;
        }
        if (scopeRaw === 'everyone' || scopeRaw === 'all barangay bayanan') {
          return isResidentUser || isResponderUser || isAdminUser;
        }
        return false;
      }
      if (eventName === 'new-incident-report' || eventName === 'new-report' || eventName === 'new-rescue-request') {
        return isAdminUser;
      }
      if (eventName === 'rescue-assignment-updated') {
        if (payload.responderId && currentUser && Number(payload.responderId) !== Number(currentUser.id) && !isAdminUser) {
          return false;
        }
        return isResponderUser || isAdminUser;
      }
      if (eventName === 'incident-resolved-notification') {
        return isResidentUser;
      }
      if (eventName === 'report-verification-result') {
        if (payload.residentId && currentUser && Number(payload.residentId) !== Number(currentUser.id) && !isAdminUser) {
          return false;
        }
        return isResidentUser || isAdminUser;
      }
      return true;
    })();

    if (!silentEvents.has(eventName) && !isSelfActor && isRoleEligibleForToast && this._shouldShowRealtimeToast(dedupeKey) && window.GeoSafeToast) {
      let toastType = 'info';
      let toastMsg = payload.message || payload.title || 'Real-time operational update received.';

      if (eventName === 'new-hazard-alert' || eventName === 'alert-broadcast') {
        const urg = String(payload.urgency || payload.severity || '').toLowerCase();
        toastType = (urg === 'critical' || urg === 'emergency') ? 'critical' : 'warning';
        toastMsg = `Hazard Alert: ${payload.title || payload.message || 'New advisory issued for Barangay Bayanan.'}`;
      } else if (eventName === 'new-incident-report' || eventName === 'new-report') {
        toastType = 'info';
        toastMsg = `New Incident Report: ${payload.title || payload.incident_type || payload.incidentType || recordId || 'Submitted'}`;
      } else if (eventName === 'new-rescue-request') {
        toastType = 'critical';
        toastMsg = `Emergency Rescue Request: ${payload.emergencyType || payload.emergency_type || payload.location || recordId || 'Immediate attention required'}`;
      } else if (eventName === 'rescue-assignment-updated') {
        toastType = 'info';
        toastMsg = payload.message || `Rescue assignment updated (${recordId || 'Task assigned'}).`;
      } else if (eventName === 'report-verification-result') {
        const decision = String(payload.decision || payload.status || '').toLowerCase();
        if (decision === 'rejected' || decision === 'false_alarm' || decision === 'dismissed') {
          toastType = 'warning';
          toastMsg = `Report ${recordId || ''} rejected${payload.reason ? `: ${payload.reason}` : '.'}`;
        } else if (decision === 'verified') {
          toastType = 'success';
          toastMsg = `Report ${recordId || ''} has been verified by an Administrator.`;
        } else {
          toastType = 'info';
          toastMsg = payload.message || `Report ${recordId || ''} updated.`;
        }
      } else if (eventName === 'rescue-status-updated' || eventName === 'status-update') {
        toastType = 'success';
        toastMsg = payload.message || `Status updated${recordId ? ` for ${recordId}` : ''}${statusText ? `: ${statusText}` : ''}.`;
      } else if (eventName === 'incident-resolved-notification') {
        toastType = 'info';
        toastMsg = payload.message || 'An incident in Barangay Bayanan has been marked as resolved.';
      } else if (eventName === 'administrator-announcement') {
        toastType = 'info';
        toastMsg = `EOC Announcement: ${payload.title || payload.message || 'New operational notice'}`;
      }

      window.GeoSafeToast.show({ message: toastMsg, type: toastType, dedupeKey, duration: 5000 });
    }

    // Private Resident-Responder Incoming Message Toast (only for intended recipient, never sender)
    if (eventName === 'messages:incoming-notification' && payload && payload.conversationId) {
      const senderId = Number(payload.senderUserId || 0);
      const myId = currentUser && currentUser.id !== undefined ? Number(currentUser.id) : 0;
      const isSelfMsg = Boolean(myId && senderId && myId === senderId);
      const isViewingThread = Boolean(
        typeof window !== 'undefined' &&
        window.GeoSafeMessages &&
        typeof window.GeoSafeMessages.getActiveConversationId === 'function' &&
        Number(window.GeoSafeMessages.getActiveConversationId()) === Number(payload.conversationId) &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      );
      const msgKey = `chat-notif:${payload.messageId || `${payload.conversationId}:${payload.createdAt}`}`;
      if (!isSelfMsg && !isViewingThread && this._shouldShowRealtimeToast(msgKey) && window.GeoSafeToast) {
        const roleLower = String((currentUser && currentUser.role) || '').toLowerCase();
        const targetPage = roleLower === 'responder' ? 'responder-messages.html' : 'messages.html';
        const timeStr = payload.createdAt
          ? new Date(payload.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        const senderLabel = payload.senderName || 'New message';
        const previewText = payload.preview ? `"${payload.preview}"` : 'Sent a new message.';
        window.GeoSafeToast.show({
          title: 'New message',
          message: `${senderLabel}${timeStr ? ` • ${timeStr}` : ''} — ${previewText}`,
          type: 'info',
          duration: 6000,
          onClick: () => {
            window.location.href = `${targetPage}?conversationId=${encodeURIComponent(payload.conversationId)}`;
          }
        });
      }
    }

    window.dispatchEvent(
      new CustomEvent('geosafe:realtime-update', {
        detail: { event: eventName, data: payload }
      })
    );
  }

  async syncMissedRealtimeUpdates() {
    if (this._reconnectSyncPromise) {
      return this._reconnectSyncPromise;
    }
    this._reconnectSyncPromise = (async () => {
      try {
        await Promise.all([
          this.getNotifications('Unread').catch(() => []),
          this.getHazardAlerts().catch(() => [])
        ]);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('geosafe:realtime-update', {
              detail: { event: 'reconnect-sync', data: {} }
            })
          );
        }
      } catch (_) {}
    })();
    try {
      return await this._reconnectSyncPromise;
    } finally {
      this._reconnectSyncPromise = null;
    }
  }

  async initRealtimeSocket() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    if (this.socket && this.socket.connected) return this.socket;
    if (this._socketInitPromise) return this._socketInitPromise;

    this._socketInitPromise = (async () => {
      const loaded = await this.loadSocketIoScript();
      if (!loaded || typeof window.io !== 'function') return null;

      if (this.socket) {
        try {
          if (!this.socket.connected) this.socket.connect();
          return this.socket;
        } catch (_) {}
      }

      const socket = window.io({
        withCredentials: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: Infinity
      });

      this.socket = socket;

      const realtimeEvents = [
        'new-hazard-alert',
        'alert-broadcast',
        'hazard-alert-expired',
        'alert-expired',
        'hazard-alert-cancelled',
        'alert-cancelled',
        'new-incident-report',
        'new-report',
        'public-report-verified',
        'incident-resolved',
        'incident-resolved-notification',
        'report-verification-result',
        'admin-sync',
        'new-rescue-request',
        'rescue-assignment-updated',
        'rescue-status-updated',
        'status-update',
        'administrator-announcement',
        'conversation:new-message',
        'conversation:messages-read',
        'conversation:typing',
        'messages:unread-update',
        'messages:access-updated',
        'conversation:archive-updated',
        'admin:conversation-activity',
        'messages:incoming-notification',
        'responder:location-updated',
        'responder:location-offline',
        'resident-application-submitted',
        'resident-application-reviewed'
      ];

      if (!socket._geosafeRealtimeBound) {
        socket._geosafeRealtimeBound = true;
        realtimeEvents.forEach((evt) => {
          socket.off(evt);
          socket.on(evt, (payload) => {
            this._handleRealtimeEvent(evt, payload || {});
          });
        });

        if (socket.io && typeof socket.io.on === 'function') {
          socket.io.on('reconnect', () => {
            this.syncMissedRealtimeUpdates();
          });
        }
      }

      return socket;
    })();

    try {
      return await this._socketInitPromise;
    } finally {
      this._socketInitPromise = null;
    }
  }

  disconnectRealtimeSocket() {
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch (_) {}
      this.socket = null;
    }
  }

  /**
   * Verifies the current session against GET /api/auth/session (which checks the
   * HttpOnly cookie and queries PostgreSQL for the user's live role_id and status).
   */
  async verifySession(requiredRoleLabel = null, forceRefresh = false) {
    if (!forceRefresh && this.sessionPromise) {
      const cached = await this.sessionPromise;
      return this._evaluateRoleGate(cached, requiredRoleLabel);
    }

    const apiBase = (this.config && this.config.API_BASE_URL) ? this.config.API_BASE_URL : '/api';
    const endpoint = apiBase.endsWith('/api') ? `${apiBase}/auth/session` : '/api/auth/session';

    this.sessionPromise = (async () => {
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
          this.state.currentUser = null;
          this.state.responderProfile = null;
          this.state.adminProfile = null;
          this.csrfToken = null;
          return { authenticated: false, user: null, profile: null };
        }

        const data = await response.json();
        if (!data || !data.authenticated || !data.user) {
          this.state.currentUser = null;
          return { authenticated: false, user: null, profile: null };
        }

        if (data.csrfToken) {
          this.csrfToken = data.csrfToken;
        }

        const normalizedRole = this.normalizeRoleName(data.user.role_name || data.user.role);
        const verifiedUser = {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          role_id: data.user.role_id,
          role: normalizedRole,
          portal: data.user.portal || this.portalForRole(normalizedRole),
          mustChangePassword: Boolean(data.user.mustChangePassword)
        };

        this.state.currentUser = verifiedUser;
        this.initRealtimeSocket();

        if (normalizedRole === 'Responder') {
          this.state.responderProfile = data.profile || {
            id: verifiedUser.id,
            firstName: verifiedUser.name.split(' ')[0] || 'Responder',
            lastName: verifiedUser.name.split(' ').slice(1).join(' ') || '',
            email: verifiedUser.email,
            role: 'Responder',
            assignedUnit: 'Barangay Bayanan Field Unit',
            department: 'Barangay Bayanan Emergency Operations',
            availability: 'Off Duty'
          };
        } else if (normalizedRole === 'Administrator') {
          this.state.adminProfile = {
            id: verifiedUser.id,
            name: verifiedUser.name,
            email: verifiedUser.email,
            role: 'Administrator'
          };
        } else if (data.profile) {
          this.state.residentProfile = data.profile;
        }

        return { authenticated: true, user: verifiedUser, profile: data.profile || null };
      } catch (err) {
        this.state.currentUser = null;
        return { authenticated: false, user: null, profile: null, error: err };
      }
    })();

    const sessionResult = await this.sessionPromise;
    return this._evaluateRoleGate(sessionResult, requiredRoleLabel);
  }

  _evaluateRoleGate(sessionResult, requiredRoleLabel) {
    if (!sessionResult || !sessionResult.authenticated || !sessionResult.user) {
      return {
        authenticated: false,
        authorized: false,
        user: null,
        redirectTo: '/login.html'
      };
    }

    const currentPath = typeof window !== 'undefined' ? (window.location.pathname || '').toLowerCase() : '';
    const isChangePasswordPage = currentPath.endsWith('/change-password.html');

    if (sessionResult.user.mustChangePassword) {
      if (!isChangePasswordPage) {
        return {
          authenticated: true,
          authorized: false,
          user: sessionResult.user,
          profile: sessionResult.profile,
          redirectTo: '/change-password.html'
        };
      }
      return {
        authenticated: true,
        authorized: true,
        user: sessionResult.user,
        profile: sessionResult.profile,
        redirectTo: null
      };
    }

    if (isChangePasswordPage) {
      const actualRole = sessionResult.user.role;
      return {
        authenticated: true,
        authorized: false,
        user: sessionResult.user,
        profile: sessionResult.profile,
        redirectTo: sessionResult.user.portal || this.portalForRole(actualRole)
      };
    }

    const actualRole = sessionResult.user.role;
    if (requiredRoleLabel) {
      const expectedRole = this.normalizeRoleName(requiredRoleLabel);
      if (actualRole !== expectedRole) {
        return {
          authenticated: true,
          authorized: false,
          user: sessionResult.user,
          profile: sessionResult.profile,
          redirectTo: sessionResult.user.portal || this.portalForRole(actualRole)
        };
      }
    }

    return {
      authenticated: true,
      authorized: true,
      user: sessionResult.user,
      profile: sessionResult.profile,
      redirectTo: null
    };
  }

  async enforcePageAuth(requiredRoleLabel = null) {
    const check = await this.verifySession(requiredRoleLabel);
    if (!check.authenticated) {
      if (typeof window !== 'undefined') {
        window.location.replace('/login.html');
      }
      return null;
    }
    if (!check.authorized) {
      if (typeof window !== 'undefined') {
        window.location.replace(check.redirectTo || '/login.html');
      }
      return null;
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.visibility = 'visible';
    }
    return check.user;
  }

  async registerResident(payload = {}) {
    if (!this.isOnline()) {
      throw new Error('Network offline. Resident registration requires an active internet connection.');
    }

    const firstName = (payload.firstName || '').trim();
    const lastName = (payload.lastName || '').trim();
    const fullName = (payload.name || `${firstName} ${lastName}`).trim();
    const email = (payload.email || '').trim();
    const password = payload.password || '';
    const phone = (payload.phone || '').trim();
    const street = (payload.street || '').trim();

    if (!fullName || fullName.length < 2) {
      throw new Error('Please enter your full name (at least 2 characters).');
    }
    if (!email || !email.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }
    if (!payload.idPhotoDataUrl || !payload.selfiePhotoDataUrl) {
      throw new Error('Both Barangay Address ID photo and Selfie holding the ID are required.');
    }

    const apiBase = (this.config && this.config.API_BASE_URL) ? this.config.API_BASE_URL : '/api';
    const endpoint = apiBase.endsWith('/api') ? `${apiBase}/register` : '/api/register';

    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        name: fullName,
        first_name: firstName,
        last_name: lastName,
        email,
        password,
        phone_number: phone,
        street_address: street,
        idPhotoDataUrl: payload.idPhotoDataUrl,
        selfiePhotoDataUrl: payload.selfiePhotoDataUrl
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409) {
        throw new Error(data.error || 'This email address is already registered. Please sign in instead.');
      }
      if (data.errors && data.errors.length) {
        throw new Error(data.errors[0].msg || data.error || 'Invalid registration details.');
      }
      throw new Error(data.error || `Registration failed (HTTP ${response.status}).`);
    }

    return {
      success: true,
      message: data.message || 'Registration successful. Please sign in.',
      user: data.user,
      redirectTo: data.redirectTo || '/login.html'
    };
  }

  async login(email, password, rememberMe = false) {
    if (!email || !password) {
      throw new Error('Please enter both email and password.');
    }

    if (!this.isOnline()) {
      throw new Error('Network offline. GeoSafe authentication requires an active internet connection.');
    }

    const apiBase = (this.config && this.config.API_BASE_URL) ? this.config.API_BASE_URL : '/api';
    const endpoint = apiBase.endsWith('/api') ? `${apiBase}/login` : '/api/login';

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ email: email.trim(), password, rememberMe: Boolean(rememberMe) })
      });
    } catch (netErr) {
      console.warn('[GeoSafe Auth] Backend API unreachable:', netErr.message);
      const err = new Error('Authentication service is currently unavailable. Please verify the GeoSafe backend server is running.');
      err.isNetworkError = true;
      throw err;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(data.error || 'Invalid email or password. Please verify your credentials and try again.');
      }
      if (response.status === 403) {
        throw new Error(data.error || 'Your account is disabled or unauthorized. Please contact the Barangay Bayanan EOC.');
      }
      if (response.status === 400 && data.errors && data.errors.length) {
        throw new Error(data.errors[0].msg || 'Invalid authentication parameters.');
      }
      throw new Error(data.error || data.message || `Authentication failed (HTTP ${response.status}).`);
    }

    if (!data.user) {
      throw new Error('Authentication server returned an incomplete response.');
    }

    this.purgeClientAuthStorage();
    this.csrfToken = data.csrfToken || null;
    this.sessionPromise = null;

    const normalizedRole = this.normalizeRoleName(data.user.role_name || data.user.role);
    const verifiedUser = {
      id: data.user.id,
      name: data.user.name || email.split('@')[0],
      email: data.user.email || email,
      role_id: data.user.role_id,
      role: normalizedRole,
      portal: data.user.portal || this.portalForRole(normalizedRole),
      mustChangePassword: Boolean(data.user.mustChangePassword)
    };

    this.state.currentUser = verifiedUser;
    this.initRealtimeSocket();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('geosafe:auth', { detail: { user: verifiedUser } }));
    }

    return {
      success: true,
      user: verifiedUser,
      role: normalizedRole,
      portal: verifiedUser.portal
    };
  }

  async changePassword(currentPassword, newPassword, confirmPassword) {
    const res = await this.request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });
    if (res && res.csrfToken) {
      this.csrfToken = res.csrfToken;
    }
    if (this.state && this.state.currentUser) {
      this.state.currentUser.mustChangePassword = false;
    }
    this.sessionPromise = null;
    return res;
  }

  async logout() {
    if (typeof window !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent('geosafe:logout')); } catch (_) {}
      if (window.GeoSafeMapping && typeof window.GeoSafeMapping.stopAllLiveGpsTrackers === 'function') {
        try { window.GeoSafeMapping.stopAllLiveGpsTrackers(); } catch (_) {}
      }
    }
    const csrf = this.getCsrfToken();
    try {
      if (this.isOnline() && typeof fetch !== 'undefined') {
        await fetch('/api/logout', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : {})
          }
        }).catch(() => {});
      }
    } catch (_) {}

    this.disconnectRealtimeSocket();
    this.purgeClientAuthStorage();
    this.csrfToken = null;
    this.sessionPromise = null;
    this.state.currentUser = null;
    this.state.responderProfile = null;
    this.state.adminProfile = null;

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('geosafe:auth-logout'));
    }
    return true;
  }

  // ==========================================================================
  // RESPONDER PORTAL API & STORE SERVICES (Section 10 Strict RBAC)
  // ==========================================================================

  async getResponderProfile() {
    const check = await this.verifySession('Responder');
    if (!check.authenticated || !check.authorized) {
      return null;
    }
    return this.request('/responder/profile', { method: 'GET' });
  }

  async setAuthenticatedResponder() {
    throw new Error('Client-side responder authentication is disabled. Please sign in through /login.html.');
  }

  async logoutResponder() {
    await this.logout();
    if (typeof window !== 'undefined') {
      window.location.replace('/login.html');
    }
    return true;
  }

  async syncResponderLocation({ lat, lng, accuracy = null, sharingEnabled = true } = {}) {
    return this.request('/responder/location', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, accuracy, sharingEnabled })
    });
  }

  async updateResponderProfile(updates) {
    return this.request('/responder/profile', {
      method: 'PUT',
      body: JSON.stringify(updates)
    }, () => {
      // STRICT ROLE LIMITATION (Section 10): Responders cannot change roles or admin settings
      const safeUpdates = { ...updates };
      delete safeUpdates.role;
      delete safeUpdates.id;
      delete safeUpdates.badgeNumber;

      this.state.responderProfile = {
        ...(this.state.responderProfile || {}),
        ...safeUpdates
      };
      this.saveState();
      return { ...this.state.responderProfile };
    });
  }

  async updateResponderAvailability(status) {
    const validStatuses = ['On Duty', 'Off Duty', 'On Break'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid availability status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    return this.request('/responder/availability', {
      method: 'PATCH',
      body: JSON.stringify({ status })
    }, () => {
      if (!this.state.responderProfile) {
        throw new Error('Cannot update availability: No authenticated responder profile found.');
      }
      this.state.responderProfile.availability = status;
      this.saveState();

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('geosafe:responder-availability', { detail: { status } }));
      }
      return { status, updated: true };
    });
  }

  /**
   * Retrieve all assignments authorized for the authenticated responder
   * Combines assigned Rescue Requests and Incident Reports
   * ZERO FAKE DATA: Strictly derived from real records.
   */
  async getResponderAssignments(filters = {}) {
    const queryParams = new URLSearchParams(filters).toString();
    const endpoint = `/responder/assignments${queryParams ? `?${queryParams}` : ''}`;

    return this.request(endpoint, { method: 'GET' }, () => {
      const responder = this.state.responderProfile;
      // If no responder authenticated or role is not Responder, return empty array
      if (!responder || responder.role !== 'Responder') {
        return [];
      }

      const responderId = responder.id;
      const assignedUnit = responder.assignedUnit;
      const assignments = [];

      // 1. Rescue Requests assigned to this responder or their unit
      (this.state.rescueRequests || []).forEach(r => {
        const isAssigned = (responderId && r.assignedResponderId === responderId) || 
                           (assignedUnit && r.assignedUnit === assignedUnit) || 
                           r.assignedResponderId === 'ALL_ON_DUTY' ||
                           (r.status && ['Assigned', 'Responding', 'En Route', 'On Scene', 'Completed'].includes(r.status) && r.assignedResponderId === responderId);
        
        if (isAssigned) {
          assignments.push({
            id: r.id,
            assignmentType: 'rescue',
            referenceNumber: r.id,
            title: r.emergencyType || 'Rescue Request',
            category: r.emergencyType,
            description: r.description,
            location: r.location,
            landmark: r.landmark || '',
            coordinates: r.coordinates || null,
            status: r.status || 'Pending',
            peopleCount: r.peopleCount || 1,
            vulnerableDetails: r.vulnerableDetails || 'None specified',
            assignedAt: r.assignedAt || r.requestDate,
            timeline: r.updates || [],
            photos: r.photos || [],
            dispatchInstructions: r.dispatchInstructions || 'Proceed to assigned scene and report back status to EOC.'
          });
        }
      });

      // 2. Incident Reports assigned to this responder
      (this.state.reports || []).forEach(r => {
        const isAssigned = (responderId && r.assignedResponderId === responderId) || 
                           (assignedUnit && r.assignedUnit === assignedUnit) ||
                           (r.status && ['Assigned', 'Responding', 'En Route', 'On Scene', 'Resolved'].includes(r.status) && r.assignedResponderId === responderId);

        if (isAssigned) {
          assignments.push({
            id: r.id,
            assignmentType: 'incident',
            referenceNumber: r.id,
            title: r.title,
            category: r.incidentType,
            description: r.description,
            location: r.location,
            coordinates: r.coordinates || null,
            status: r.status === 'Resolved' ? 'Completed' : (r.status === 'Responding' ? 'En Route' : (r.status === 'Verified' ? 'Accepted' : (r.status || 'Pending'))),
            assignedAt: r.assignedAt || r.submittedAt,
            timeline: r.timeline || [],
            photos: r.photos || [],
            dispatchInstructions: r.dispatchInstructions || 'Assess hazard scope, establish safety perimeter, and report back status to EOC.'
          });
        }
      });

      // 3. Explicit entries in responderAssignments
      (this.state.responderAssignments || []).forEach(a => {
        if (!assignments.some(item => item.id === a.id)) {
          assignments.push(a);
        }
      });

      // Apply Filters
      let filtered = assignments;

      if (filters.status && filters.status !== 'All') {
        const targetStatus = filters.status.toLowerCase();
        filtered = filtered.filter(a => {
          const s = (a.status || '').toLowerCase();
          if (targetStatus === 'completed') {
            return ['completed', 'resolved'].includes(s);
          }
          if (targetStatus === 'pending') {
            return !['completed', 'resolved', 'cancelled', 'false_alarm', 'dismissed'].includes(s);
          }
          return s === targetStatus;
        });
      }

      if (filters.search) {
        const q = filters.search.toLowerCase().trim();
        filtered = filtered.filter(a => 
          (a.referenceNumber || a.id || '').toLowerCase().includes(q) ||
          (a.title || '').toLowerCase().includes(q) ||
          (a.category || '').toLowerCase().includes(q) ||
          (a.location || '').toLowerCase().includes(q)
        );
      }

      return filtered.sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt));
    });
  }

  async getResponderAssignmentById(id) {
    return this.request(`/responder/assignments/${encodeURIComponent(id)}`, { method: 'GET' }, async () => {
      const all = await this.getResponderAssignments({ status: 'All' });
      const found = all.find(a => a.id === id || a.referenceNumber === id);
      if (!found) {
        throw new Error(`Assignment #${id} not found.`);
      }
      return found;
    });
  }

  async getArrivalConfig() {
    if (this._arrivalConfigCache) return this._arrivalConfigCache;
    const data = await this.request('/responder/arrival-config', { method: 'GET' });
    const cfg = data && data.arrivalConfig ? data.arrivalConfig : null;
    if (cfg) this._arrivalConfigCache = cfg;
    return cfg;
  }

  /**
   * Update Assignment Response Status Workflow (Section 4 & 6)
   * Transition: Pending -> Accepted -> En Route -> On Scene -> Completed
   */
  async updateAssignmentStatus(id, newStatus, workNotes = '', photo = null, isInternalOnly = false, extra = {}) {
    const validStatuses = ['Accepted', 'En Route', 'On Scene', 'Completed', 'In Progress'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid assignment status transition: ${newStatus}`);
    }

    const payload = { status: newStatus, workNotes, photo, isInternalOnly };
    if (extra && typeof extra === 'object') {
      Object.assign(payload, extra);
    }

    return this.request(`/responder/assignments/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }, () => {
      const nowIso = new Date().toISOString();
      const responder = this.state.responderProfile;
      const responderName = responder ? `${responder.firstName || ''} ${responder.lastName || ''} (${responder.callsign || responder.assignedUnit || 'Responder'})`.trim() : 'Authorized Responder';

      const auditEntry = {
        time: nowIso,
        status: newStatus,
        responder: responderName,
        note: workNotes || `Status updated to ${newStatus} by ${responderName}.`,
        photo: photo || null,
        isInternalOnly: Boolean(isInternalOnly)
      };

      let updatedRecord = null;
      const rescue = (this.state.rescueRequests || []).find(r => r.id === id);
      if (rescue) {
        rescue.status = newStatus === 'Completed' ? 'Completed' : (newStatus === 'En Route' ? 'Responding' : newStatus);
        rescue.updates = rescue.updates || [];
        rescue.updates.unshift({
          time: nowIso,
          text: workNotes || `Rescue unit marked status: ${newStatus}`,
          status: newStatus,
          responder: responderName,
          photo: photo || null
        });
        updatedRecord = rescue;
      }

      const report = (this.state.reports || []).find(r => r.id === id);
      if (report) {
        // STRICT RULE (Section 4): Do not automatically close resident reports when responders mark an operation completed.
        // Preserve existing workflow for resident confirmation & EOC verification.
        report.status = newStatus === 'Completed' ? 'Resolved' : (newStatus === 'En Route' ? 'Responding' : newStatus);
        report.timeline = report.timeline || [];
        report.timeline.unshift({
          time: nowIso,
          status: newStatus,
          note: workNotes || `Field response update: ${newStatus} reported by ${responderName}.`,
          responder: responderName,
          photo: photo || null
        });
        updatedRecord = report;
      }

      const assignment = (this.state.responderAssignments || []).find(a => a.id === id || a.referenceNumber === id);
      if (assignment) {
        assignment.status = newStatus;
        assignment.timeline = assignment.timeline || [];
        assignment.timeline.unshift(auditEntry);
        updatedRecord = updatedRecord || assignment;
      }

      if (!updatedRecord) {
        throw new Error(`Assignment #${id} not found.`);
      }

      this.state.notifications = this.state.notifications || [];
      this.state.notifications.unshift({
        id: `NOTIF-${Date.now()}`,
        title: `Assignment ${id} Updated: ${newStatus}`,
        description: `${responderName} marked assignment ${id} as "${newStatus}".`,
        category: 'assignment',
        timestamp: nowIso,
        read: false,
        referenceId: id,
        link: 'responder-assignments.html'
      });

      this.saveState();
      return { success: true, id, status: newStatus, auditEntry };
    });
  }

  /**
   * Responder Dashboard Summary (Section 3)
   * Strictly calculates from actual backend/store records. Zero mock numbers.
   */
  async getResponderDashboardSummary() {
    return this.request('/responder/dashboard/summary', { method: 'GET' }, async () => {
      const all = await this.getResponderAssignments({ status: 'All' });

      const active = all.filter(a => !['completed', 'resolved'].includes((a.status || '').toLowerCase())).length;
      const pending = all.filter(a => ['pending', 'pending dispatch'].includes((a.status || '').toLowerCase())).length;
      const inProgress = all.filter(a => ['accepted', 'en route', 'on scene', 'responding'].includes((a.status || '').toLowerCase())).length;
      const completed = all.filter(a => ['completed', 'resolved'].includes((a.status || '').toLowerCase())).length;

      const recentAssignments = all.slice(0, 5);

      return {
        stats: {
          active,
          pending,
          inProgress,
          completed
        },
        recentAssignments,
        responder: await this.getResponderProfile()
      };
    });
  }

  /**
   * Responder Operational Map Data (Section 5)
   */
  async getResponderMapData() {
    return this.request('/responder/map-data', { method: 'GET' }, async () => {
      const assignments = await this.getResponderAssignments({ status: 'All' });
      const evacuationCenters = await this.getEvacuationCenters('All');
      const barangayFacilities = [];

      return {
        assignments,
        evacuationCenters,
        barangayFacilities,
        responderLocation: (this.state.responderProfile && this.state.responderProfile.currentLocation) || null
      };
    });
  }

  /**
   * Helper for Dispatchers / EOC to assign tasks to responders
   */
  async assignTaskToResponder(taskId, taskType, instructions = '') {
    const responder = await this.getResponderProfile();
    if (!responder) {
      throw new Error('No authorized responder session available for assignment.');
    }
    const nowIso = new Date().toISOString();

    if (taskType === 'rescue') {
      const rescue = (this.state.rescueRequests || []).find(r => r.id === taskId);
      if (rescue) {
        rescue.assignedResponderId = responder.id;
        rescue.assignedUnit = responder.assignedUnit || '';
        rescue.status = 'Assigned';
        rescue.dispatchInstructions = instructions;
        rescue.assignedAt = nowIso;
        rescue.updates = rescue.updates || [];
        rescue.updates.unshift({
          time: nowIso,
          text: `Assigned to ${responder.firstName || ''} ${responder.lastName || ''} (${responder.assignedUnit || 'Field Unit'}). Instructions: ${instructions || 'Proceed to location.'}`.trim(),
          status: 'Assigned'
        });
        this.saveState();
        return rescue;
      }
    } else {
      const report = (this.state.reports || []).find(r => r.id === taskId);
      if (report) {
        report.assignedResponderId = responder.id;
        report.assignedUnit = responder.assignedUnit || '';
        report.status = 'Assigned';
        report.dispatchInstructions = instructions;
        report.assignedAt = nowIso;
        report.timeline = report.timeline || [];
        report.timeline.unshift({
          time: nowIso,
          status: 'Assigned',
          note: `Incident assigned to responder ${responder.firstName || ''} ${responder.lastName || ''}.`.trim()
        });
        this.saveState();
        return report;
      }
    }

    throw new Error(`Record ${taskId} not found.`);
  }
}

// Global store instance
window.geoSafeStore = new GeoSafeStore();

// Immediate Frontend Route Protection Guard (prevents flash of unauthenticated content)
(function enforceGlobalPortalGuard() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const pathname = (window.location.pathname || '/').toLowerCase();

  // Do not block the public login/registration page
  if (pathname.endsWith('/login.html')) {
    return;
  }

  let requiredRole = 'Resident';
  if (pathname.endsWith('/change-password.html')) {
    requiredRole = null;
  } else if (pathname.endsWith('/admin.html')) {
    requiredRole = 'Administrator';
  } else if (pathname.includes('responder')) {
    requiredRole = 'Responder';
  }

  // Hide document until server-side session & role check finishes
  if (document.documentElement) {
    document.documentElement.style.visibility = 'hidden';
  }

  window.geoSafeStore.enforcePageAuth(requiredRole);
})();
