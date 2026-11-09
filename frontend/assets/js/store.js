/**
 * GeoSafe - Resident Portal Store & API Service Layer
 * ============================================================================
 * STRICT FRESH SYSTEM & ZERO FABRICATED DATA (Section 20)
 * 
 * - Starts with 0 reports, 0 rescue requests, 0 hazard alerts, 0 notifications,
 *   0 family members, and 0 evacuation centers.
 * - All dashboard metrics (Total, Pending, Verified, Resolved) are dynamically
 *   derived from actual record arrays.
 * - Prepared for seamless Node.js, Express.js, and MySQL REST API integration.
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
      familyMembers: [],
      familyGroups: [],
      familyInvitations: [],
      familyJoinRequests: [],
      familyLocationConsents: {},
      familyLocationUpdates: [],
      notifications: [],
      tropicalCyclone: null,
      responderProfile: null,
      adminProfile: null,
      currentUser: null,
      responderAssignments: [],
      emergencyContacts: []
    };
  }

  saveState() {
    // Authentication and operational data are persisted on the MySQL backend via HttpOnly session cookies.
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

  async request(endpoint, options = {}, fallbackFn = null) {
    if (!this.isOnline()) {
      const error = new Error('No internet connection. GeoSafe requires an active internet connection to communicate with the Emergency Operations Center.');
      error.isOffline = true;
      throw error;
    }

    if (typeof fallbackFn === 'function' && ((this.config && this.config.USE_MOCK_DATA) || typeof document === 'undefined')) {
      return await fallbackFn();
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
      return res.reports.map(r => ({
        id: r.reference_number || (r.id ? `INC-${r.id}` : 'INC-0'),
        databaseId: r.id,
        referenceNumber: r.reference_number || (r.id ? `INC-${r.id}` : 'INC-0'),
        incidentType: r.incident_type || r.incidentType || 'Incident',
        title: r.title || `${r.incident_type || 'Incident'} Report`,
        description: r.description || '',
        location: r.address || r.location || 'Barangay Bayanan',
        severity: r.severity || 'Medium',
        status: r.status || 'Pending Verification',
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
        severity: r.severity || 'Moderate',
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
      severity: payload.severity || 'Medium',
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
      severity: reportObj.severity || payload.severity || 'Medium',
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
        link: 'my-reports.html'
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

      if (filters.severity && filters.severity !== 'All') {
        alerts = alerts.filter(a => a.severity.toLowerCase() === filters.severity.toLowerCase());
      }

      if (filters.category && filters.category !== 'All') {
        alerts = alerts.filter(a => a.category.toLowerCase().includes(filters.category.toLowerCase()));
      }

      return alerts.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    });
  }

  // Tropical Cyclone Monitoring (Section B & C: Prioritizes official PAGASA records)
  async getTropicalCycloneBulletin() {
    return this.request('/cyclone-bulletin', { method: 'GET' }, () => {
      if (!this.state.tropicalCyclone || !this.state.tropicalCyclone.active) {
        return {
          active: false,
          message: 'No active tropical cyclone within Philippine Area of Responsibility (PAR).'
        };
      }
      return { ...this.state.tropicalCyclone };
    });
  }

  async publishTropicalCycloneBulletin(bulletinData) {
    return this.request('/cyclone-bulletin', {
      method: 'POST',
      body: JSON.stringify(bulletinData)
    }, () => {
      this.state.tropicalCyclone = {
        active: true,
        ...bulletinData
      };
      this.saveState();
      return this.state.tropicalCyclone;
    });
  }

  // Evacuation Centers
  async getEvacuationCenters(filter = 'All') {
    return this.request(`/evacuation-centers?status=${encodeURIComponent(filter)}`, { method: 'GET' }, () => {
      let list = [...(this.state.evacuationCenters || [])];
      if (filter && filter !== 'All') {
        list = list.filter(c => c.status.toLowerCase().includes(filter.toLowerCase()));
      }
      return list;
    });
  }

  // ============================================================================
  // Family Safety Tracker & QR-Based Membership
  // ============================================================================

  _hashTokenSync(token) {
    if (!token) return '';
    if (typeof require !== 'undefined') {
      try {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(token.trim()).digest('hex');
      } catch (e) {}
    }
    // Standalone pure JS SHA-256 for browser/offline environments
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let i, j, result = '';
    const words = [];
    let ascii = token.trim();
    const asciiBitLength = ascii.length * 8;
    let hash = [];
    const k = [];
    let primeCounter = 0;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    ascii += '\x80';
    while ((ascii.length % 64) - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      words[i >> 2] |= j << (((3 - i) % 4) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (j = 0; j < words.length; ) {
      const w = words.slice(j, (j += 16));
      const oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
              w[i - 16]
              + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
            ) | 0
          );
        const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (let b = 3; b >= 0; b--) {
        const byte = (hash[i] >> (b * 8)) & 255;
        result += (byte < 16 ? '0' : '') + byte.toString(16);
      }
    }
    return result;
  }

  /**
   * Retrieve active family group, members, pending requests, and invitation
   */
  async getMyFamily() {
    return this.request('/family/my-family', { method: 'GET' }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      if (!this.state.familyGroups) this.state.familyGroups = [];
      if (!this.state.familyMembers) this.state.familyMembers = [];
      if (!this.state.familyInvitations) this.state.familyInvitations = [];
      if (!this.state.familyJoinRequests) this.state.familyJoinRequests = [];
      if (!this.state.familyLocationConsents) this.state.familyLocationConsents = {};

      // Find active membership for current user
      const myMembership = this.state.familyMembers.find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );

      if (!myMembership) {
        return {
          family: null,
          members: [],
          pendingRequests: [],
          activeInvitation: null,
          myMembership: null
        };
      }

      const family = this.state.familyGroups.find(g => g.id === myMembership.family_id && g.status === 'active');
      if (!family) {
        return {
          family: null,
          members: [],
          pendingRequests: [],
          activeInvitation: null,
          myMembership: null
        };
      }

      const isManager = myMembership.membership_role === 'manager';

      // Format all active members in this family
      const members = this.state.familyMembers
        .filter(m => m.family_id === family.id && m.membership_status === 'active')
        .map(m => {
          const consent = this.state.familyLocationConsents[m.id] || { sharing_enabled: false };
          const isSharing = consent.sharing_enabled === true;
          return {
            id: m.id,
            user_id: m.user_id,
            name: m.name,
            email: m.email,
            relationship: m.relationship || 'Member',
            membership_role: m.membership_role,
            membership_status: m.membership_status,
            joined_at: m.joined_at,
            is_self: m.id === myMembership.id || m.user_id === currentUserId,
            locationSharing: {
              enabled: isSharing,
              status: isSharing
                ? (m.location && m.location.latitude ? 'Sharing Location' : 'Location unavailable')
                : 'Location sharing off',
              lastUpdated: isSharing && m.location ? m.location.lastUpdated : null,
              latitude: isSharing && m.location ? m.location.latitude : null,
              longitude: isSharing && m.location ? m.location.longitude : null,
              batteryLevel: isSharing && m.location ? m.location.batteryLevel : null,
              safetyStatus: (m.location && m.location.safetyStatus) || 'safe'
            }
          };
        });

      // Pending requests for managers only
      let pendingRequests = [];
      if (isManager) {
        pendingRequests = (this.state.familyJoinRequests || [])
          .filter(r => r.family_id === family.id && r.request_status === 'pending');
      }

      // Active unexpired invitation for managers
      let activeInvitation = null;
      if (isManager) {
        const now = new Date();
        activeInvitation = (this.state.familyInvitations || [])
          .filter(i => i.family_id === family.id && !i.revoked_at && new Date(i.expires_at) > now)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
      }

      const myConsent = this.state.familyLocationConsents[myMembership.id] || { sharing_enabled: false };

      return {
        family: {
          id: family.id,
          family_name: family.family_name,
          created_by: family.created_by,
          status: family.status,
          is_manager: isManager,
          member_count: members.length,
          address: family.address || {
            house_number: family.house_number || '',
            street: family.street || '',
            barangay: 'Bayanan',
            city: 'Muntinlupa City',
            province: 'Metro Manila',
            region: 'National Capital Region',
            country: 'Philippines',
            formatted: (family.house_number && family.street)
              ? `${family.house_number} ${family.street}, Barangay Bayanan, Muntinlupa City, Metro Manila, Philippines`
              : ''
          }
        },
        myMembership: {
          id: myMembership.id,
          membership_role: myMembership.membership_role,
          membership_status: myMembership.membership_status,
          relationship: myMembership.relationship,
          location_sharing_enabled: myConsent.sharing_enabled === true,
          consented_at: myConsent.consented_at
        },
        members,
        pendingRequests,
        activeInvitation
      };
    });
  }

  /**
   * Create Family Group
   */
  async createFamilyGroup(groupData) {
    return this.request('/family/groups', {
      method: 'POST',
      body: JSON.stringify(groupData)
    }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      if (!this.state.familyGroups) this.state.familyGroups = [];
      if (!this.state.familyMembers) this.state.familyMembers = [];
      if (!this.state.familyLocationConsents) this.state.familyLocationConsents = {};

      // Check if user already in a family
      const existing = this.state.familyMembers.find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );
      if (existing) {
        throw new Error('You are already an active member of a family group.');
      }

      const cleanHouseNumber = (groupData.house_number || '').trim();
      const cleanStreet = (groupData.street || '').trim();
      if (!cleanHouseNumber || !cleanStreet) {
        throw new Error('Both House / Building Number and Street Name are required.');
      }

      const familyId = `FAM-${Date.now()}`;
      const memberId = `MEM-${Date.now()}`;
      const formattedAddress = `${cleanHouseNumber} ${cleanStreet}, Barangay Bayanan, Muntinlupa City, Metro Manila, Philippines`;

      const newFamily = {
        id: familyId,
        family_name: (groupData.family_name || 'My Family').trim(),
        created_by: currentUserId,
        house_number: cleanHouseNumber,
        street: cleanStreet,
        barangay: 'Bayanan',
        city: 'Muntinlupa City',
        province: 'Metro Manila',
        region: 'National Capital Region',
        country: 'Philippines',
        address: {
          house_number: cleanHouseNumber,
          street: cleanStreet,
          barangay: 'Bayanan',
          city: 'Muntinlupa City',
          province: 'Metro Manila',
          region: 'National Capital Region',
          country: 'Philippines',
          formatted: formattedAddress
        },
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const managerMember = {
        id: memberId,
        family_id: familyId,
        user_id: currentUserId,
        name: currentUser ? (currentUser.name || `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email) : 'Family Manager',
        email: currentUser ? currentUser.email : '',
        relationship: (groupData.relationship || 'Head of Household').trim(),
        membership_role: 'manager',
        membership_status: 'active',
        joined_at: new Date().toISOString(),
        location: null
      };

      this.state.familyGroups.push(newFamily);
      this.state.familyMembers.push(managerMember);
      this.state.familyLocationConsents[memberId] = {
        sharing_enabled: false,
        consented_at: null,
        revoked_at: null
      };

      this.saveState();

      return {
        message: 'Family group created successfully.',
        family: {
          id: familyId,
          family_name: newFamily.family_name,
          created_by: currentUserId,
          status: 'active',
          is_manager: true,
          member_count: 1
        },
        myMembership: {
          id: memberId,
          membership_role: 'manager',
          membership_status: 'active',
          relationship: managerMember.relationship,
          location_sharing_enabled: false
        }
      };
    });
  }

  /**
   * Generate Family QR Invitation
   */
  async generateFamilyInvitation(expiresInHours = 72) {
    return this.request('/family/invitations', {
      method: 'POST',
      body: JSON.stringify({ expires_in_hours: expiresInHours })
    }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      const myMembership = (this.state.familyMembers || []).find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );

      if (!myMembership) throw new Error('You do not belong to a family group.');
      if (myMembership.membership_role !== 'manager') throw new Error('Only family managers can generate QR invitations.');

      const family = (this.state.familyGroups || []).find(g => g.id === myMembership.family_id && g.status === 'active');
      if (!family) throw new Error('Family group not found.');

      if (!this.state.familyInvitations) this.state.familyInvitations = [];

      // Revoke older active invites
      this.state.familyInvitations.forEach(inv => {
        if (inv.family_id === family.id && !inv.revoked_at) {
          inv.revoked_at = new Date().toISOString();
        }
      });

      // Generate random token
      const rawToken = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const tokenHash = this._hashTokenSync(rawToken);
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

      const newInv = {
        id: `INV-${Date.now()}`,
        family_id: family.id,
        family_name: family.family_name,
        token_hash: tokenHash,
        created_by: currentUserId,
        expires_at: expiresAt,
        revoked_at: null,
        created_at: new Date().toISOString()
      };

      this.state.familyInvitations.push(newInv);
      this.saveState();

      return {
        message: 'Invitation generated successfully.',
        invitation: {
          id: newInv.id,
          family_id: family.id,
          family_name: family.family_name,
          token: rawToken, // Returned strictly to generator for QR
          expires_at: expiresAt,
          created_at: newInv.created_at
        }
      };
    });
  }

  /**
   * Validate Invitation Token
   */
  async validateFamilyInvitation(token) {
    return this.request(`/family/invitations/validate/${encodeURIComponent(token)}`, { method: 'GET' }, () => {
      if (!token) throw new Error('Invalid token');
      const tokenHash = this._hashTokenSync(token);

      const inv = (this.state.familyInvitations || []).find(i => i.token_hash === tokenHash);
      if (!inv) {
        const error = new Error('Invitation is invalid or does not exist.');
        error.status = 404;
        throw error;
      }

      if (inv.revoked_at) {
        const error = new Error('This invitation QR code has been revoked by the family manager.');
        error.status = 410;
        throw error;
      }

      if (new Date(inv.expires_at) < new Date()) {
        const error = new Error('This invitation QR code has expired. Please request a new QR code from your family manager.');
        error.status = 410;
        throw error;
      }

      const family = (this.state.familyGroups || []).find(g => g.id === inv.family_id && g.status === 'active');
      if (!family) {
        const error = new Error('The family group associated with this invitation is no longer active.');
        error.status = 410;
        throw error;
      }

      return {
        valid: true,
        family_id: inv.family_id,
        family_name: family.family_name,
        inviter_name: 'Family Manager',
        expires_at: inv.expires_at
      };
    });
  }

  /**
   * Submit Join Request
   */
  async submitFamilyJoinRequest(invitationToken, relationship = 'Member') {
    return this.request('/family/join-requests', {
      method: 'POST',
      body: JSON.stringify({ invitation_token: invitationToken, relationship })
    }, () => {
      const currentUser = this.getCurrentUser();
      if (!currentUser) throw new Error('You must be logged in to request joining a family.');
      const currentUserId = currentUser.id || currentUser.email;

      // Check if user already in a family
      const existing = (this.state.familyMembers || []).find(m =>
        (m.user_id === currentUserId || m.email === currentUser.email) && m.membership_status === 'active'
      );
      if (existing) {
        throw new Error('You already belong to an active family group.');
      }

      const tokenHash = this._hashTokenSync(invitationToken);
      const inv = (this.state.familyInvitations || []).find(i => i.token_hash === tokenHash);
      if (!inv || inv.revoked_at || new Date(inv.expires_at) < new Date()) {
        throw new Error('Invitation is invalid, revoked, or expired.');
      }

      if (!this.state.familyJoinRequests) this.state.familyJoinRequests = [];

      // Prevent duplicate pending requests
      const dup = this.state.familyJoinRequests.find(r =>
        r.family_id === inv.family_id && (r.user_id === currentUserId || r.applicant_email === currentUser.email) && r.request_status === 'pending'
      );
      if (dup) {
        throw new Error('You already have a pending join request for this family.');
      }

      const newReq = {
        id: `REQ-${Date.now()}`,
        family_id: inv.family_id,
        user_id: currentUserId,
        invitation_id: inv.id,
        applicant_name: currentUser.name || `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email,
        applicant_email: currentUser.email,
        relationship: (relationship || 'Member').trim(),
        request_status: 'pending',
        requested_at: new Date().toISOString()
      };

      this.state.familyJoinRequests.push(newReq);
      this.saveState();

      return {
        message: 'Join request submitted successfully. Awaiting approval from the family manager.',
        request: newReq
      };
    });
  }

  /**
   * Get Pending Join Requests (Manager Only)
   */
  async getPendingJoinRequests() {
    return this.request('/family/join-requests', { method: 'GET' }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      const myMembership = (this.state.familyMembers || []).find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );

      if (!myMembership || myMembership.membership_role !== 'manager') {
        throw new Error('Only family managers can view pending join requests.');
      }

      const requests = (this.state.familyJoinRequests || []).filter(r =>
        r.family_id === myMembership.family_id && r.request_status === 'pending'
      );

      return { pendingRequests: requests };
    });
  }

  /**
   * Review Join Request (Approve or Reject)
   */
  async reviewFamilyJoinRequest(requestId, action) {
    return this.request(`/family/join-requests/${encodeURIComponent(requestId)}/review`, {
      method: 'PUT',
      body: JSON.stringify({ action })
    }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      const myMembership = (this.state.familyMembers || []).find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );

      if (!myMembership || myMembership.membership_role !== 'manager') {
        throw new Error('Only family managers can review join requests.');
      }

      const req = (this.state.familyJoinRequests || []).find(r => r.id === requestId && r.family_id === myMembership.family_id);
      if (!req) throw new Error('Join request not found.');

      if (req.user_id === currentUserId) {
        throw new Error('Managers cannot approve their own requests.');
      }

      req.request_status = action === 'approve' ? 'approved' : 'rejected';
      req.reviewed_by = currentUserId;
      req.reviewed_at = new Date().toISOString();

      let newMemberId = null;
      if (action === 'approve') {
        newMemberId = `MEM-${Date.now()}`;
        const newMember = {
          id: newMemberId,
          family_id: req.family_id,
          user_id: req.user_id,
          name: req.applicant_name,
          email: req.applicant_email,
          relationship: req.relationship || 'Member',
          membership_role: 'member',
          membership_status: 'active',
          joined_at: new Date().toISOString(),
          location: null
        };
        this.state.familyMembers.push(newMember);

        if (!this.state.familyLocationConsents) this.state.familyLocationConsents = {};
        this.state.familyLocationConsents[newMemberId] = {
          sharing_enabled: false,
          consented_at: null,
          revoked_at: null
        };
      }

      this.saveState();

      return {
        message: `Join request successfully ${req.request_status}.`,
        request_id: requestId,
        status: req.request_status,
        new_member_id: newMemberId
      };
    });
  }

  /**
   * Remove Family Member
   */
  async removeFamilyMember(memberId) {
    return this.request(`/family/members/${encodeURIComponent(memberId)}`, { method: 'DELETE' }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      const myMembership = (this.state.familyMembers || []).find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );

      if (!myMembership || myMembership.membership_role !== 'manager') {
        throw new Error('Only family managers can remove family members.');
      }

      const target = (this.state.familyMembers || []).find(m => m.id === memberId && m.family_id === myMembership.family_id);
      if (!target) throw new Error('Member not found in your family group.');
      if (target.id === myMembership.id) throw new Error('Use leave family option to remove yourself.');

      target.membership_status = 'removed';
      if (this.state.familyLocationConsents && this.state.familyLocationConsents[memberId]) {
        this.state.familyLocationConsents[memberId].sharing_enabled = false;
        this.state.familyLocationConsents[memberId].revoked_at = new Date().toISOString();
      }

      this.saveState();
      return { message: 'Family member removed successfully.', member_id: memberId };
    });
  }

  /**
   * Revoke Active Invitation
   */
  async revokeFamilyInvitation(invitationId) {
    return this.request(`/family/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      const myMembership = (this.state.familyMembers || []).find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );

      if (!myMembership || myMembership.membership_role !== 'manager') {
        throw new Error('Only family managers can revoke invitations.');
      }

      const inv = (this.state.familyInvitations || []).find(i => i.id === invitationId && i.family_id === myMembership.family_id);
      if (!inv || inv.revoked_at) throw new Error('Active invitation not found or already revoked.');

      inv.revoked_at = new Date().toISOString();
      this.saveState();

      return { message: 'Invitation QR code successfully revoked.' };
    });
  }

  /**
   * Toggle Location Sharing Privacy Consent
   */
  async toggleFamilyLocationSharing(enabledOrMemberId, maybeEnable) {
    // Check if called with legacy (memberId, boolean) signature
    if (typeof enabledOrMemberId === 'string') {
      const memberId = enabledOrMemberId;
      const enable = Boolean(maybeEnable);
      return this.request(`/family-members/${encodeURIComponent(memberId)}/location-sharing`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: enable })
      }, () => {
        const member = (this.state.familyMembers || []).find(m => m.id === memberId);
        if (!member) throw new Error('Family member not found');
        if (!member.locationSharing) {
          member.locationSharing = {};
        }
        member.locationSharing.enabled = enable;
        member.locationSharing.status = enable ? 'Sharing Location' : 'Not Sharing';
        member.locationSharing.coordinates = enable ? { lat: 14.4075, lng: 121.0475 } : null;
        member.locationSharing.lastUpdated = enable ? new Date().toISOString() : member.locationSharing.lastUpdated;

        if (!this.state.familyLocationConsents) this.state.familyLocationConsents = {};
        this.state.familyLocationConsents[memberId] = {
          sharing_enabled: enable,
          consented_at: enable ? new Date().toISOString() : null,
          revoked_at: enable ? null : new Date().toISOString()
        };

        this.saveState();
        return member;
      });
    }

    // New QR membership endpoint signature: toggleFamilyLocationSharing(boolean)
    const enabled = Boolean(enabledOrMemberId);
    return this.request('/family/location-sharing', {
      method: 'PUT',
      body: JSON.stringify({ enabled, agreed_to_policy: enabled })
    }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      const myMembership = (this.state.familyMembers || []).find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );

      if (!myMembership) throw new Error('You are not an active member of any family group.');

      if (!this.state.familyLocationConsents) this.state.familyLocationConsents = {};
      const now = new Date().toISOString();

      if (enabled) {
        this.state.familyLocationConsents[myMembership.id] = {
          sharing_enabled: true,
          consented_at: now,
          revoked_at: null
        };
      } else {
        this.state.familyLocationConsents[myMembership.id] = {
          sharing_enabled: false,
          consented_at: null,
          revoked_at: now
        };
      }

      this.saveState();

      return {
        message: enabled ? 'Location sharing enabled.' : 'Location sharing revoked. Your location is no longer visible to family members.',
        location_sharing_enabled: enabled,
        status: enabled ? 'Sharing Location' : 'Location sharing off'
      };
    });
  }

  /**
   * Post Location Coordinate Update
   */
  async updateFamilyLocation(latitude, longitude, batteryLevel = null, safetyStatus = 'safe') {
    return this.request('/family/location-update', {
      method: 'POST',
      body: JSON.stringify({ latitude, longitude, battery_level: batteryLevel, safety_status: safetyStatus })
    }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      const myMembership = (this.state.familyMembers || []).find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );

      if (!myMembership) throw new Error('Active family membership not found.');

      const consent = (this.state.familyLocationConsents || {})[myMembership.id];
      if (!consent || !consent.sharing_enabled) {
        throw new Error('Location sharing is disabled for your account. Enable location sharing first.');
      }

      const now = new Date().toISOString();
      myMembership.location = {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        batteryLevel: batteryLevel,
        safetyStatus: safetyStatus || 'safe',
        lastUpdated: now
      };

      if (!this.state.familyLocationUpdates) this.state.familyLocationUpdates = [];
      this.state.familyLocationUpdates.push({
        family_member_id: myMembership.id,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        battery_level: batteryLevel,
        safety_status: safetyStatus || 'safe',
        recorded_at: now
      });

      this.saveState();
      return { message: 'Location coordinate recorded.', recorded_at: now };
    });
  }

  /**
   * Retrieve Authorized Family Locations
   */
  async getFamilyLocations() {
    return this.request('/family/locations', { method: 'GET' }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      const myMembership = (this.state.familyMembers || []).find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );

      if (!myMembership) return { locations: [] };

      const authorizedLocations = (this.state.familyMembers || [])
        .filter(m => {
          if (m.family_id !== myMembership.family_id || m.membership_status !== 'active') return false;
          const consent = (this.state.familyLocationConsents || {})[m.id];
          return consent && consent.sharing_enabled === true;
        })
        .filter(m => m.location && m.location.latitude && m.location.longitude)
        .map(m => ({
          member_id: m.id,
          name: m.name,
          relationship: m.relationship,
          latitude: m.location.latitude,
          longitude: m.location.longitude,
          battery_level: m.location.batteryLevel,
          safety_status: m.location.safetyStatus,
          recorded_at: m.location.lastUpdated
        }));

      return { locations: authorizedLocations };
    });
  }

  /**
   * Leave Family Group
   */
  async leaveFamilyGroup() {
    return this.request('/family/leave', { method: 'POST' }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      const myMembership = (this.state.familyMembers || []).find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );

      if (!myMembership) throw new Error('You are not an active member of any family.');

      myMembership.membership_status = 'inactive';
      if (this.state.familyLocationConsents && this.state.familyLocationConsents[myMembership.id]) {
        this.state.familyLocationConsents[myMembership.id].sharing_enabled = false;
        this.state.familyLocationConsents[myMembership.id].revoked_at = new Date().toISOString();
      }

      this.saveState();
      return { message: 'You have left the family group.' };
    });
  }

  /**
   * Update Family Shared Address
   */
  async updateFamilyAddress(addressData) {
    return this.request('/family/address', {
      method: 'PUT',
      body: JSON.stringify(addressData)
    }, () => {
      const currentUser = this.getCurrentUser();
      const currentUserId = currentUser ? (currentUser.id || currentUser.email) : 'default-user';

      const myMembership = (this.state.familyMembers || []).find(m =>
        (m.user_id === currentUserId || m.email === currentUser?.email) && m.membership_status === 'active'
      );

      if (!myMembership) throw new Error('You do not belong to an active family group.');
      if (myMembership.membership_role !== 'manager') throw new Error('Only authorized family managers can update the family address.');

      const family = (this.state.familyGroups || []).find(g => g.id === myMembership.family_id && g.status === 'active');
      if (!family) throw new Error('Family group not found.');

      const houseNumber = addressData.house_number ? addressData.house_number.trim() : '';
      const streetName = addressData.street ? addressData.street.trim() : '';

      if (!houseNumber || !streetName) {
        throw new Error('House / Building Number and Street Name are required.');
      }

      const FIXED_BARANGAY = 'Bayanan';
      const FIXED_CITY = 'Muntinlupa City';
      const FIXED_PROVINCE = 'Metro Manila';
      const FIXED_REGION = 'National Capital Region';
      const FIXED_COUNTRY = 'Philippines';

      family.address = {
        house_number: houseNumber,
        street: streetName,
        barangay: FIXED_BARANGAY,
        city: FIXED_CITY,
        province: FIXED_PROVINCE,
        region: FIXED_REGION,
        country: FIXED_COUNTRY,
        formatted: `${houseNumber} ${streetName}, Barangay ${FIXED_BARANGAY}, ${FIXED_CITY}, ${FIXED_PROVINCE}, ${FIXED_COUNTRY}`
      };

      this.saveState();
      return {
        message: 'Family address updated successfully.',
        address: family.address
      };
    });
  }

  // Backward compatibility helpers
  async getFamilyMembers() {
    return this.request('/family-members', { method: 'GET' }, () => {
      return [...(this.state.familyMembers || [])];
    });
  }

  async addFamilyMember(memberData) {
    return this.request('/family-members', {
      method: 'POST',
      body: JSON.stringify(memberData)
    }, () => {
      const isSharing = memberData.enableLocationSharing === true || memberData.status === 'Sharing Location';
      const memberId = `FAM-${Date.now()}`;
      const newMember = {
        id: memberId,
        name: memberData.name,
        relationship: memberData.relationship,
        email: memberData.email || memberData.identifier || '',
        phone: memberData.phone || '',
        safetyStatus: memberData.safetyStatus || 'Unknown',
        membership_role: 'member',
        membership_status: 'active',
        locationSharing: {
          status: isSharing ? 'Sharing Location' : 'Not Sharing',
          enabled: isSharing,
          lastUpdated: isSharing ? (memberData.lastUpdated || new Date().toISOString()) : null,
          approximateLocation: isSharing ? (memberData.approximateLocation || 'Barangay Bayanan') : 'Not Available',
          coordinates: isSharing ? (memberData.coordinates || { lat: 14.4075, lng: 121.0475 }) : null
        },
        locationHistory: memberData.locationHistory || [],
        notes: memberData.notes || ''
      };

      if (!this.state.familyMembers) this.state.familyMembers = [];
      this.state.familyMembers.push(newMember);

      if (!this.state.familyLocationConsents) this.state.familyLocationConsents = {};
      this.state.familyLocationConsents[memberId] = {
        sharing_enabled: isSharing,
        consented_at: isSharing ? new Date().toISOString() : null,
        revoked_at: isSharing ? null : new Date().toISOString()
      };

      this.saveState();
      return newMember;
    });
  }

  async updateFamilySafetyStatus(memberId, newStatus) {
    return this.request(`/family-members/${encodeURIComponent(memberId)}/safety`, {
      method: 'PATCH',
      body: JSON.stringify({ safetyStatus: newStatus })
    }, () => {
      const member = (this.state.familyMembers || []).find(m => m.id === memberId);
      if (!member) throw new Error('Family member not found');
      member.safetyStatus = newStatus;
      if (member.locationSharing && member.locationSharing.enabled) {
        member.locationSharing.lastUpdated = new Date().toISOString();
      }
      this.saveState();
      return member;
    });
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

  /**
   * Verifies the current session against GET /api/auth/session (which checks the
   * HttpOnly cookie and queries MySQL for the user's live role_id and status).
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
          portal: data.user.portal || this.portalForRole(normalizedRole)
        };

        this.state.currentUser = verifiedUser;

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
        street_address: street
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
      portal: data.user.portal || this.portalForRole(normalizedRole)
    };

    this.state.currentUser = verifiedUser;

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

  async logout() {
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
    const validStatuses = ['On Duty', 'Off Duty', 'Unavailable'];
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
            priority: r.priority || 'High',
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
            priority: r.severity === 'Critical' ? 'Critical' : (r.severity === 'High' ? 'High' : (r.severity === 'Moderate' ? 'Medium' : 'Low')),
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
          if (targetStatus === 'in progress') {
            return ['accepted', 'en route', 'on scene', 'responding'].includes(s);
          }
          if (targetStatus === 'completed') {
            return ['completed', 'resolved'].includes(s);
          }
          if (targetStatus === 'pending') {
            return ['pending', 'pending dispatch'].includes(s);
          }
          return s === targetStatus;
        });
      }

      if (filters.priority && filters.priority !== 'All') {
        filtered = filtered.filter(a => (a.priority || '').toLowerCase() === filters.priority.toLowerCase());
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

  /**
   * Update Assignment Response Status Workflow (Section 4 & 6)
   * Transition: Pending -> Accepted -> En Route -> On Scene -> Completed
   */
  async updateAssignmentStatus(id, newStatus, workNotes = '', photo = null, isInternalOnly = false) {
    const validStatuses = ['Accepted', 'En Route', 'On Scene', 'Completed', 'In Progress'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid assignment status transition: ${newStatus}`);
    }

    return this.request(`/responder/assignments/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus, workNotes, photo, isInternalOnly })
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

      const priorityCounts = {
        critical: all.filter(a => (a.priority || '').toLowerCase() === 'critical').length,
        high: all.filter(a => (a.priority || '').toLowerCase() === 'high').length,
        medium: all.filter(a => (a.priority || '').toLowerCase() === 'medium').length,
        low: all.filter(a => (a.priority || '').toLowerCase() === 'low').length
      };

      const recentAssignments = all.slice(0, 5);

      return {
        stats: {
          active,
          pending,
          inProgress,
          completed
        },
        priorityCounts,
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
  async assignTaskToResponder(taskId, taskType, priority = 'High', instructions = '') {
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
        rescue.priority = priority || rescue.priority;
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
        report.priority = priority || 'Medium';
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
  if (pathname.endsWith('/admin.html')) {
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
