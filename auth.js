import { auth } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- 1. LOGIN LOGIC ---
export async function loginUser(email, password) {
    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'index.html'; // Go to dashboard
    } catch (error) {
        throw error; // Pass error to the UI to show an alert
    }
}

// --- 2. LOGOUT LOGIC ---
export async function logoutUser() {
    try {
        // Clear the sidebar state so it's fresh for the next login
        localStorage.removeItem('sidebar-collapsed');
        
        await signOut(auth);
        window.location.href = 'login.html';
    } catch (error) {
        console.error("Logout failed", error);
    }
}

// --- 3. THE GATEKEEPER ---
// This prevents unauthenticated users from seeing your data
export function checkAuthState(callback) {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            callback(user);
        } else {
            // If not logged in and not already on the login page, redirect
            if (!window.location.pathname.includes('login.html')) {
                window.location.href = 'login.html';
            }
        }
    });
}