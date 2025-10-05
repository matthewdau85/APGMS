// src/App.tsx
// Import the base React library so we can write JSX components.
import React from "react";
// Pull in the Router, Routes, and Route components to define page navigation.
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
// Import the shared layout that wraps every page view.
import AppLayout from "./components/AppLayout";

// Import the dashboard page component rendered at the root path.
import Dashboard from "./pages/Dashboard";
// Import the BAS page component for the Business Activity Statement route.
import BAS from "./pages/BAS";
// Import the settings page where configuration lives.
import Settings from "./pages/Settings";
// Import the wizard page that guides users through setup flows.
import Wizard from "./pages/Wizard";
// Import the audit page to review transaction activity.
import Audit from "./pages/Audit";
// Import the fraud page dedicated to fraud detection tools.
import Fraud from "./pages/Fraud";
// Import the integrations page showing third-party connections.
import Integrations from "./pages/Integrations";
// Import the help page that provides support resources.
import Help from "./pages/Help";

// Declare the root App component that defines all top-level routes.
export default function App() {
  // Return the router tree that tells React Router how to render pages.
  return (
    // Wrap the entire application in a Router component so routing works.
    <Router>
      {/* Declare the collection of routes supported by the application. */}
      <Routes>
        {/* Use AppLayout to provide a consistent layout wrapper around all pages. */}
        <Route element={<AppLayout />}>
          {/* Map the root URL to the Dashboard page component. */}
          <Route path="/" element={<Dashboard />} />
          {/* Map the /bas URL to the BAS page component. */}
          <Route path="/bas" element={<BAS />} />
          {/* Map the /settings URL to the Settings page component. */}
          <Route path="/settings" element={<Settings />} />
          {/* Map the /wizard URL to the Wizard page component. */}
          <Route path="/wizard" element={<Wizard />} />
          {/* Map the /audit URL to the Audit page component. */}
          <Route path="/audit" element={<Audit />} />
          {/* Map the /fraud URL to the Fraud page component. */}
          <Route path="/fraud" element={<Fraud />} />
          {/* Map the /integrations URL to the Integrations page component. */}
          <Route path="/integrations" element={<Integrations />} />
          {/* Map the /help URL to the Help page component. */}
          <Route path="/help" element={<Help />} />
        </Route>
      </Routes>
    </Router>
  );
}
