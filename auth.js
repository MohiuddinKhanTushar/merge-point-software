import { auth, db } from './firebase-config.js'; 
import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    GoogleAuthProvider,
    OAuthProvider,
    signInWithPopup 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, 
    getDoc, 
    setDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- 1. INTERNAL HELPER: SYNC USER PROFILE ---
async function syncUserProfile(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        const domain = user.email.split('@')[1];
        await setDoc(userRef, {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || "User",
            role: "admin", 
            companyId: domain, 
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp()
        });
    } else {
        await setDoc(userRef, { 
            lastLogin: serverTimestamp() 
        }, { merge: true });
    }
}

// --- 2. INTERNAL HELPER: UPDATE SIDEBAR UI ---
function updateSidebarUI(user, profile) {
    const nameEl = document.getElementById('display-name');
    const avatarEl = document.getElementById('avatar-circle');
    const roleEl = document.getElementById('display-role');

    const fullName = profile?.displayName || user.displayName || user.email.split('@')[0];
    const role = profile?.role || "Member";
    const initial = fullName.charAt(0).toUpperCase();

    // Persist to localStorage to prevent "flicker" on next page load
    localStorage.setItem('userDisplayName', fullName);
    localStorage.setItem('userInitial', initial);
    localStorage.setItem('userRole', role);

    if (nameEl) nameEl.textContent = fullName;
    if (roleEl) roleEl.textContent = role.toUpperCase();
    
    if (avatarEl) {
        avatarEl.textContent = initial;
        // Visual cue: Admins get a distinct color
        if (role === 'admin') {
            avatarEl.style.background = '#ef4444'; // Red for Admin
        } else if (role === 'manager') {
            avatarEl.style.background = '#f59e0b'; // Amber for Manager
        } else {
            avatarEl.style.background = '#2563eb'; // Blue for Standard
        }
    }
}

// --- 3. LOGIN LOGIC ---
export async function loginUser(email, password) {
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        await syncUserProfile(result.user);
        window.location.href = 'index.html';
    } catch (error) {
        throw error;
    }
}

export async function loginWithGoogle() {
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        await syncUserProfile(result.user);
        window.location.href = 'index.html';
    } catch (error) {
        throw error;
    }
}

export async function loginWithMicrosoft() {
    const provider = new OAuthProvider('microsoft.com');
    try {
        const result = await signInWithPopup(auth, provider);
        await syncUserProfile(result.user);
        window.location.href = 'index.html';
    } catch (error) {
        throw error;
    }
}

// --- 4. LOGOUT LOGIC ---
export async function logoutUser() {
    try {
        // CLEAN UP ALL STORAGE
        localStorage.removeItem('sidebar-collapsed');
        localStorage.removeItem('userDisplayName');
        localStorage.removeItem('userInitial');
        localStorage.removeItem('userRole');
        
        await signOut(auth);
        window.location.href = 'login.html';
    } catch (error) {
        console.error("Logout failed", error);
    }
}

// --- 5. THE GATEKEEPER ---
export function checkAuthState(callback) {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Fetch the latest profile data
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);
            const profile = userSnap.exists() ? userSnap.data() : null;

            // Update the Global Sidebar UI & update localStorage
            updateSidebarUI(user, profile);

            // GLOBAL LOGOUT ATTACHMENT
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.onclick = async (e) => {
                    e.preventDefault();
                    await logoutUser();
                };
            }

            callback({ ...user, profile });
        } else {
            // Clear storage if no user is found
            localStorage.removeItem('userDisplayName');
            localStorage.removeItem('userInitial');
            localStorage.removeItem('userRole');

            const path = window.location.pathname;
            if (!path.includes('login.html') && !path.includes('signup.html')) {
                window.location.href = 'login.html';
            }
        }
    });
}