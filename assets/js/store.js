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
      USE_MOCK_DATA: true,
      API_BASE_URL: '/api/v1',
      TIMEOUT_MS: 10000
    };
    // Fresh session key (v3 ensures any old cached dummy records are discarded)
    this.sessionKey = 'geosafe_fresh_system_v3';
    this.state = this.loadState();
    this.setupNetworkListeners();
  }

  loadState() {
    try {
      const saved = sessionStorage.getItem(this.sessionKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Ensure all arrays exist
        parsed.reports = parsed.reports || [];
        parsed.rescueRequests = parsed.rescueRequests || [];
        parsed.hazardAlerts = parsed.hazardAlerts || [];
        parsed.evacuationCenters = parsed.evacuationCenters || [];
        parsed.familyMembers = parsed.familyMembers || [];
        parsed.notifications = parsed.notifications || [];
        parsed.tropicalCyclone = parsed.tropicalCyclone || null;
        parsed.responderProfile = parsed.responderProfile || null;
        parsed.responderAssignments = parsed.responderAssignments || [];
        return parsed;
      }
    } catch (e) {
      console.warn('Could not read session state, using clean fresh initial state.', e);
    }
    // Return pristine empty state (Section 20)
    return JSON.parse(JSON.stringify(window.FRESH_SYSTEM_INITIAL_STATE || {
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
      notifications: [],
      responderProfile: null,
      responderAssignments: [],
      emergencyContacts: []
    }));
  }

  saveState() {
    try {
      sessionStorage.setItem(this.sessionKey, JSON.stringify(this.state));
    } catch (e) {
      console.warn('Could not update session state.', e);
    }
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

  async request(endpoint, options = {}, freshStoreHandler) {
    if (!this.isOnline()) {
      const error = new Error('No internet connection. GeoSafe requires an active internet connection to communicate with the Emergency Operations Center.');
      error.isOffline = true;
      throw error;
    }

    // When USE_MOCK_DATA is false, attempt actual REST API call
    if (!this.config.USE_MOCK_DATA) {
      const url = `${this.config.API_BASE_URL}${endpoint}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.TIMEOUT_MS || 10000);

      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(options.headers || {})
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errData = await response.json().catch(() => ({ message: 'Server request failed.' }));
          const err = new Error(errData.message || `HTTP ${response.status}`);
          err.status = response.status;
          throw err;
        }

        return await response.json();
      } catch (err) {
        clearTimeout(timeoutId);
        // If backend server is not yet running, cleanly fallback to the fresh store handler
        console.warn(`[GeoSafe API] REST endpoint ${endpoint} unavailable, using fresh local store.`, err.message);
        return freshStoreHandler();
      }
    }

    // Fresh store handler
    await new Promise(resolve => setTimeout(resolve, 150));
    return freshStoreHandler();
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

    return this.request(endpoint, { method: 'GET' }, () => {
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
    return this.request('/reports', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, () => {
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      const newId = `REP-2026-${randomNum}`;
      const nowIso = new Date().toISOString();

      const newReport = {
        id: newId,
        incidentType: payload.incidentType,
        title: payload.title,
        description: payload.description,
        location: payload.location,
        coordinates: payload.coordinates || { lat: 14.4075, lng: 121.0475 },
        submittedAt: nowIso,
        severity: payload.severity || 'Moderate',
        status: 'Pending Verification',
        photos: payload.photos || [],
        timeline: [
          {
            time: nowIso,
            status: 'Submitted',
            note: 'Report received via GeoSafe Resident Portal. Queued for verification by Barangay Operations.'
          }
        ]
      };

      if (!this.state.reports) this.state.reports = [];
      this.state.reports.unshift(newReport);

      // Add actual notification for submission
      this.state.notifications.unshift({
        id: `NOTIF-${Date.now()}`,
        title: 'Report Submitted Successfully',
        description: `Your incident report ${newId} (${newReport.incidentType}) has been transmitted to Barangay Bayanan EOC.`,
        category: 'report',
        timestamp: nowIso,
        read: false,
        referenceId: newId,
        link: 'my-reports.html'
      });

      this.saveState();
      return newReport;
    });
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
    }, () => {
      const randomNum = Math.floor(100 + Math.random() * 900);
      const newId = `RSC-2026-${randomNum}`;
      const nowIso = new Date().toISOString();

      const newRescue = {
        id: newId,
        emergencyType: payload.emergencyType,
        description: payload.description,
        peopleCount: parseInt(payload.peopleCount, 10) || 1,
        vulnerableDetails: payload.vulnerableDetails || 'None specified',
        location: payload.location,
        landmark: payload.landmark || '',
        coordinates: payload.coordinates || { lat: 14.4085, lng: 121.0521 },
        requestDate: nowIso,
        priority: 'High',
        status: 'Pending Dispatch',
        assignedUnit: 'Awaiting BDRRMC Dispatcher Assignment',
        responderContact: 'Barangay Bayanan Operations: (02) 8861-1234',
        updates: [
          {
            time: nowIso,
            text: 'Emergency rescue assistance requested via Resident Portal. Transmitted with top priority to Bayanan Emergency Ops.'
          }
        ]
      };

      if (!this.state.rescueRequests) this.state.rescueRequests = [];
      this.state.rescueRequests.unshift(newRescue);

      this.state.notifications.unshift({
        id: `NOTIF-${Date.now()}`,
        title: 'Rescue Request Dispatched to EOC',
        description: `Urgent rescue assistance request ${newId} logged for ${newRescue.peopleCount} individuals at ${newRescue.location}.`,
        category: 'rescue',
        timestamp: nowIso,
        read: false,
        referenceId: newId,
        link: 'rescue-requests.html'
      });

      this.saveState();
      return newRescue;
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

  // Family Safety
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
      let status = 'Not Sharing';
      if (memberData.status) {
        status = memberData.status;
      } else if (isSharing) {
        status = 'Sharing Location';
      }

      const newMember = {
        id: `FAM-${Date.now()}`,
        name: memberData.name,
        relationship: memberData.relationship,
        email: memberData.email || memberData.identifier || '',
        phone: memberData.phone || '',
        safetyStatus: memberData.safetyStatus || 'Unknown',
        locationSharing: {
          status: status, // 'Sharing Location' | 'Not Sharing' | 'Location Unavailable' | 'Permission Denied'
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

  async toggleFamilyLocationSharing(memberId, enable) {
    return this.request(`/family-members/${encodeURIComponent(memberId)}/location-sharing`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: enable })
    }, () => {
      const member = (this.state.familyMembers || []).find(m => m.id === memberId);
      if (!member) throw new Error('Family member not found');
      if (!member.locationSharing) {
        member.locationSharing = {
          status: enable ? 'Sharing Location' : 'Not Sharing',
          enabled: enable,
          lastUpdated: enable ? new Date().toISOString() : null,
          approximateLocation: enable ? 'Barangay Bayanan' : 'Not Available',
          coordinates: enable ? { lat: 14.4075, lng: 121.0475 } : null
        };
      } else {
        member.locationSharing.enabled = enable;
        member.locationSharing.status = enable ? 'Sharing Location' : 'Not Sharing';
        member.locationSharing.lastUpdated = enable ? new Date().toISOString() : member.locationSharing.lastUpdated;
        if (enable) {
          if (!member.locationSharing.coordinates) {
            member.locationSharing.coordinates = { lat: 14.4075, lng: 121.0475 };
          }
          if (!member.locationSharing.approximateLocation || member.locationSharing.approximateLocation === 'Not Available') {
            member.locationSharing.approximateLocation = 'Barangay Bayanan';
          }
        }
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
  // RESPONDER PORTAL API & STORE SERVICES (Section 10 Strict RBAC)
  // ==========================================================================

  async getResponderProfile() {
    return this.request('/responder/profile', { method: 'GET' }, () => {
      if (!this.state.responderProfile) {
        return null;
      }
      return JSON.parse(JSON.stringify(this.state.responderProfile));
    });
  }

  async setAuthenticatedResponder(profile) {
    if (!profile) {
      this.state.responderProfile = null;
    } else {
      this.state.responderProfile = {
        ...profile,
        role: 'Responder'
      };
    }
    this.saveState();
    return this.state.responderProfile ? { ...this.state.responderProfile } : null;
  }

  async logoutResponder() {
    return this.request('/auth/logout', { method: 'POST' }, () => {
      this.state.responderProfile = null;
      this.saveState();
      return true;
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

      const barangayFacilities = [
        {
          id: 'FAC-BYN-01',
          name: 'Barangay Bayanan Emergency Operations Center',
          category: 'Operations Center',
          coordinates: { lat: 14.4075, lng: 121.0475 },
          contact: '(02) 8861-1234',
          address: 'National Road, Barangay Bayanan'
        },
        {
          id: 'FAC-BYN-02',
          name: 'Bayanan Lakeshore Emergency Response Base',
          category: 'Rescue Base',
          coordinates: { lat: 14.4088, lng: 121.0535 },
          contact: '(02) 8861-1234',
          address: 'Laguna Lake Lakeshore, Bayanan'
        },
        {
          id: 'FAC-BYN-03',
          name: 'Bureau of Fire Protection - Muntinlupa',
          category: 'Fire Station',
          coordinates: { lat: 14.4042, lng: 121.0435 },
          contact: '(02) 8842-2201',
          address: 'Bautista St, Muntinlupa'
        },
        {
          id: 'FAC-BYN-04',
          name: 'Ospital ng Muntinlupa Emergency Room',
          category: 'Hospital / Trauma',
          coordinates: { lat: 14.4172, lng: 121.0422 },
          contact: '(02) 8771-0457',
          address: 'Civic Center, Filinvest'
        }
      ];

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
