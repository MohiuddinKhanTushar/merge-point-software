import { auth, db } from './firebase-config.js'; 
import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    GoogleAuthProvider,
    OAuthProvider,
    signInWithPopup,
    sendPasswordResetEmail // Added for forgot password functionality
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

    localStorage.setItem('userDisplayName', fullName);
    localStorage.setItem('userInitial', initial);
    localStorage.setItem('userRole', role);

    if (nameEl) nameEl.textContent = fullName;
    if (roleEl) roleEl.textContent = role.toUpperCase();
    
    if (avatarEl) {
        avatarEl.textContent = initial;
        if (role === 'admin') {
            avatarEl.style.background = '#ef4444';
        } else if (role === 'manager') {
            avatarEl.style.background = '#f59e0b';
        } else {
            avatarEl.style.background = '#2563eb';
        }
    }
}

// --- 3. LOGIN & RESET LOGIC ---
export async function loginUser(email, password) {
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        await syncUserProfile(result.user);
        window.location.href = 'index.html';
    } catch (error) {
        throw error;
    }
}

// New Reset Password Function
export async function resetPassword(email) {
    try {
        await sendPasswordResetEmail(auth, email);
        return true;
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
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);
            
            if (!userSnap.exists()) {
                console.warn("User profile not found in Firestore. Revoking session...");
                await logoutUser();
                return;
            }

            const profile = userSnap.data();
            updateSidebarUI(user, profile);

            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.onclick = async (e) => {
                    e.preventDefault();
                    await logoutUser();
                };
            }

            callback({ ...user, profile });
        } else {
            localStorage.removeItem('userDisplayName');
            localStorage.removeItem('userInitial');
            localStorage.removeItem('userRole');

            const path = window.location.pathname;
            if (!path.includes('login.html') && !path.includes('signup.html') && !path.includes('invite.html')) {
                window.location.href = 'login.html';
            }
        }
    });
}