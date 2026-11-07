/**
 * GeoSafe - Disaster Reporting & Emergency Assistance System (Resident Portal)
 * ============================================================================
 * FRESH SYSTEM INITIAL STATE & CONFIGURATION (Section 20)
 * 
 * STRICT COMPLIANCE:
 * - NO hardcoded application records.
 * - NO dummy or sample reports.
 * - NO dummy rescue requests.
 * - NO dummy hazard alerts.
 * - NO dummy family members.
 * - NO dummy evacuation centers.
 * - NO dummy notifications.
 * - NO pre-populated resident accounts.
 * 
 * The system starts 100% fresh and empty. All records are created dynamically
 * by actual user actions and backend database responses.
 * ============================================================================
 */

// Global API & System Configuration
window.GEOSAFE_CONFIG = {
  // When false, GeoSafeStore executes real HTTP fetch() calls to the Node.js/Express REST API
  USE_MOCK_DATA: false, // Default to real backend API mode
  API_BASE_URL: '/api/v1',
  TIMEOUT_MS: 10000,
  COMMUNITY: 'Barangay Bayanan, Muntinlupa City'
};

// Clean, fresh, unpopulated initial state
const FRESH_SYSTEM_INITIAL_STATE = {
  residentProfile: {
    id: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: {
      street: "",
      barangay: "Barangay Bayanan",
      city: "Muntinlupa City",
      province: "Metro Manila",
      postalCode: "1772"
    },
    verificationStatus: "Unverified Resident",
    barangayIdNumber: "",
    householdMembersCount: 0,
    emergencyContact: {
      name: "",
      relationship: "",
      phone: ""
    },
    medicalNotes: ""
  },
  reports: [],
  rescueRequests: [],
  hazardAlerts: [],
  evacuationCenters: [],
  familyMembers: [],
  notifications: [],
  tropicalCyclone: null,
  responderProfile: null,
  responderAssignments: [],
  emergencyContacts: [
    { name: "Barangay Bayanan Operations Center", phone: "(02) 8861-1234 / 0917-888-BYN", desc: "24/7 Barangay Hotlines" },
    { name: "Muntinlupa CDRRMO Rescue Dispatch", phone: "(02) 8925-HELP (4357)", desc: "City Disaster Operations" },
    { name: "Bureau of Fire Protection - Muntinlupa", phone: "(02) 8842-2201", desc: "Fire & Rescue Station" },
    { name: "Muntinlupa Police Station (Bayanan Substation)", phone: "(02) 8862-2611", desc: "Law Enforcement & Security" },
    { name: "Ospital ng Muntinlupa Emergency Room", phone: "(02) 8771-0457", desc: "Tertiary Hospital" }
  ]
};

// Expose on global window object
window.FRESH_SYSTEM_INITIAL_STATE = FRESH_SYSTEM_INITIAL_STATE;
window.INITIAL_MOCK_DATA = FRESH_SYSTEM_INITIAL_STATE;
window.TEMPORARY_DEVELOPMENT_MOCK_DATA = FRESH_SYSTEM_INITIAL_STATE;
