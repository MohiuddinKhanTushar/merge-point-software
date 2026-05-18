import { auth } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- CONFIGURATION TIMERS (Testing Mode) ---
const TIMEOUT_LIMIT = 2 * 60 * 1000;  // 2 Minutes total tracking limit
const WARNING_BEFORE = 30 * 1000;     // 30 Seconds until warning appears

let inactivityTimer;
let warningTimer;
let isUserAuthenticated = false;
let isModalActive = false;             // Flag to lock mouse events when modal is open

// 1. Core Timer Logic
function resetInactivityTimeout() {
    // Only run timers if Firebase has verified the user is actually logged in
    if (!isUserAuthenticated) return;

    // CRITICAL: If the modal is open, ignore background mouse/keyboard activity
    if (isModalActive) return;

    clearTimeout(inactivityTimer);
    clearTimeout(warningTimer);
    
    // Remove warning modal if it's currently on screen
    const existingModal = document.getElementById('inactivity-warning');
    if (existingModal) existingModal.remove();

    // FIXED: Warning modal now fires exactly after 30 seconds of pure inactivity
    warningTimer = setTimeout(showInactivityWarning, WARNING_BEFORE);
    inactivityTimer = setTimeout(executeAutomaticLogout, TIMEOUT_LIMIT);
}

// 2. UI Warning Modal Injection
function showInactivityWarning() {
    if (document.getElementById('inactivity-warning')) return; // Prevent duplicate popups
    
    // Set flag to true so moving the mouse doesn't instantly dismiss the modal
    isModalActive = true;

    const modalHtml = `
        <div id="inactivity-warning" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 99999; font-family: sans-serif;">
            <div style="background: white; padding: 2rem; border-radius: 12px; max-width: 400px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; color: #1e293b; font-size: 1.25rem;">Are you still there?</h3>
                <p style="color: #64748b; margin-top: 0.5rem; line-height: 1.5;">You have been inactive for a while. For your security, you will be logged out shortly.</p>
                <button id="stay-logged-in-btn" style="background: #4f46e5; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; width: 100%; margin-top: 1.25rem; font-size: 1rem;">Stay Logged In</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    document.getElementById('stay-logged-in-btn').addEventListener('click', () => {
        // Clear the block flag, drop the modal element, and restart normal tracking loops
        isModalActive = false;
        const existingModal = document.getElementById('inactivity-warning');
        if (existingModal) existingModal.remove();
        resetInactivityTimeout();
    });
}

// 3. Automated Logout Execution
function executeAutomaticLogout() {
    console.log("Security Timeout reached. Logging out...");
    isModalActive = false;
    
    // Clean up local tracking states
    localStorage.removeItem('userDisplayName');
    localStorage.removeItem('userInitial');
    localStorage.removeItem('userRole');

    signOut(auth)
        .then(() => {
            window.location.href = 'login.html';
        })
        .catch((err) => {
            console.error("Auth signOut failed, forcing redirect:", err);
            window.location.href = 'login.html';
        });
}

// 4. Global Event Listeners for Activity Tracking
window.addEventListener('mousemove', resetInactivityTimeout);
window.addEventListener('keydown', resetInactivityTimeout);
window.addEventListener('mousedown', resetInactivityTimeout);
window.addEventListener('touchstart', resetInactivityTimeout);

// 5. Firebase Gatekeeper Initialization
onAuthStateChanged(auth, (user) => {
    if (user) {
        // User is confirmed logged in, unlock timers and start countdown
        isUserAuthenticated = true;
        resetInactivityTimeout();
    } else {
        // No authenticated user, ensure timers stay dead and redirect if sneaking in
        isUserAuthenticated = false;
        isModalActive = false;
        clearTimeout(inactivityTimer);
        clearTimeout(warningTimer);
        
        const path = window.location.pathname;
        if (!path.includes('login.html') && !path.includes('signup.html') && !path.includes('invite.html')) {
            window.location.href = 'login.html';
        }
    }
});