// Bring in the core React library to use JSX elements.
import React from "react";
// Import the ReactDOM client API to interact with the DOM in modern React apps.
import ReactDOM from "react-dom/client";
// Import the top-level App component that defines the UI routing.
import App from "./App";
// Load the global CSS styles that apply across the app.
import "./index.css";

// Create a React root bound to the DOM element whose id is "root".
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
// Render the App component tree inside the React root to display the UI.
root.render(<App />);
