# GeoSafe – Resident Portal UI (Barangay Bayanan)

> **Disaster Reporting and Emergency Assistance System**
> Designed for the community of **Barangay Bayanan, Muntinlupa City, Metro Manila**

GeoSafe Resident Portal is a clean, modern, professional, mobile-first, and fully responsive web platform designed to provide residents with fast access to emergency reporting, rescue requests, verified hazard advisories, evacuation shelters, and family safety tracking during disasters.

---

## 🛡️ Strict Fresh & Empty Initial System (Section 20)

GeoSafe starts as a **completely fresh and unpopulated system**:
- **Zero Sample Records**: No fabricated incident reports, dummy rescue requests, fake hazard alerts, dummy notifications, sample evacuation centers, or fake family members.
- **Dynamic Initial Counters**:
  - Total Reports: `0`
  - Pending Reports: `0`
  - Verified Reports: `0`
  - Resolved Reports: `0`
  - Active Rescue Requests: `0`
- **Standardized Initial Empty States**:
  - **My Reports**: *"No reports submitted yet."*
  - **Rescue Requests**: *"No active rescue requests."*
  - **Hazard Alerts**: *"No alerts at the moment."*
  - **Family Safety**: *"No family members added yet."*
  - **Notifications**: *"No notifications available."*
  - **Evacuation Centers**: *"No evacuation centers registered yet."*
- **Live User-Driven Testing**: All data is generated strictly through real resident account creation, legitimate incident reporting, and verified dispatcher workflow across portals.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3, Tailwind CSS, Vanilla JavaScript (ES6+).
- **Target Backend Architecture**: Node.js, Express.js REST API (`/api/v1/...`).
- **Target Database**: MySQL.
- **Mapping**: Leaflet.js & OpenStreetMap (interactive location picker & shelter map).
- **Network Architecture**: Online-only system (`navigator.onLine` verification; no offline queues).

---

## 📱 Mobile-First Responsive Design & Navigation (Section 19)

### 1. Mobile Screens (< 768px): Fixed Bottom Navigation
On mobile devices, the desktop sidebar is completely hidden and replaced by a **Fixed Bottom Navigation Bar**:
- **Fixed & Persistent**: Stays fixed at the bottom of the viewport with safe-area inset support (`env(safe-area-inset-bottom)`).
- **5 Primary Navigation Items**:
  1. **Home** (`index.html`) – Resident Dashboard
  2. **Reports** (`my-reports.html`) – My Reports
  3. **Report** (`report-incident.html`) – Central emphasized action button (prominent floating circular button)
  4. **Alerts** (`hazard-alerts.html`) – Hazard Alerts
  5. **Profile** (`profile.html`) – My Profile
- **Safe Viewport Padding**: All page `<main>` containers feature `pb-28 md:pb-8` to guarantee that buttons, inputs, and content are never obstructed by the bottom navigation.
- **Secondary Pages**: Accessible via the compact mobile header's slide-out drawer:
  - Rescue Requests (with urgent indicator)
  - Evacuation Centers
  - Family Safety
  - Notifications
  - Settings & Privacy
  - 24/7 EOC Hotlines & Sign Out

### 2. Tablet Screens (768px – 1023px)
- Compact/collapsible left sidebar navigation (`md:w-20 lg:w-64`).
- Mobile bottom navigation is automatically hidden (`md:hidden`).

### 3. Desktop Screens (1024px+)
- Full left sidebar with logo branding, resident menu labels, quick hotlines card, and sign out button.
- Clean top header with live online/offline indicator, notification dropdown, and profile menu.

---

## 📂 Project Structure

```
Geosafee/
├── package.json                 # Build scripts & Tailwind CSS dependency
├── tailwind.config.js           # Theme configuration (Navy primary, Emergency red)
├── server.js                    # Zero-dependency local development server
├── README.md                    # Documentation & architecture guide
├── .gitignore                   # Standard ignore rules
├── src/
│   └── input.css                # Tailwind directives & base styles
├── assets/
│   ├── css/
│   │   └── style.css            # Compiled minified Tailwind CSS
│   └── js/
│       ├── mock-data.js         # Fresh initial state (0 records) & GEOSAFE_CONFIG
│       ├── store.js             # API service layer (REST API client + online checker)
│       ├── components.js        # Sidebar, mobile drawer, fixed bottom nav, toasts
│       ├── dashboard.js         # Dashboard controller & dynamic stats calculation
│       ├── report-incident.js   # Geolocation, draggable map marker, photo dropzone
│       ├── my-reports.js        # Search, status/type filters, detail modal & timeline
│       ├── rescue-requests.js   # Emergency rescue submission & live dispatch updates
│       ├── hazard-alerts.js     # Early warning advisories with severity filter tabs
│       ├── evacuation-centers.js# Shelter occupancy tracking & Leaflet interactive map
│       ├── family-safety.js     # Household safety check-ins & consent toggles
│       ├── notifications.js     # Notification center with read/unread tracking
│       ├── profile.js           # Resident profile credentials & medical notes
│       └── settings.js          # Password change & alert preferences
├── index.html                   # 1. Dashboard Page
├── report-incident.html         # 2. Report an Incident Page
├── my-reports.html              # 3. My Reports Page
├── rescue-requests.html         # 4. Rescue Requests Page
├── hazard-alerts.html           # 5. Hazard Alerts Page
├── evacuation-centers.html      # 6. Evacuation Centers Page
├── family-safety.html           # 7. Family Safety Page
├── notifications.html           # 8. Notifications Page
├── profile.html                 # 9. My Profile Page
└── settings.html                # 10. Settings Page
```

---

## 🚀 How to Run the Application

### 1. Build Tailwind CSS
```powershell
npm run build
```

### 2. Launch Development Server
```powershell
npm start
```
Open **`http://localhost:3000`** in your browser.
Test across mobile viewports (320px, 375px, 390px, 430px) using browser Developer Tools device emulation, as well as tablet (768px) and desktop (1024px+).
