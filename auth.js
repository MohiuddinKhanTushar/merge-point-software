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
// This ensures every login creates or updates a Firestore user document
async function syncUserProfile(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        // First time login: Create the profile
        const domain = user.email.split('@')[1];
        await setDoc(userRef, {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || "User",
            role: "admin", // Default role for new signups
            companyId: domain, // Groups users by their email domain
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp()
        });
    } else {
        // Returning user: Update the last login timestamp
        await setDoc(userRef, { 
            lastLogin: serverTimestamp() 
        }, { merge: true });
    }
}

// --- 2. LOGIN LOGIC (EMAIL/PASSWORD) ---
export async function loginUser(email, password) {
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        await syncUserProfile(result.user);
        window.location.href = 'index.html';
    } catch (error) {
        throw error;
    }
}

// --- 3. SSO LOGIC (GOOGLE) ---
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

// --- 4. SSO LOGIC (MICROSOFT) ---
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

// --- 5. LOGOUT LOGIC ---
export async function logoutUser() {
    try {
        localStorage.removeItem('sidebar-collapsed');
        await signOut(auth);
        window.location.href = 'login.html';
    } catch (error) {
        console.error("Logout failed", error);
    }
}

// --- 6. THE GATEKEEPER ---
export function checkAuthState(callback) {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);
            const profile = userSnap.exists() ? userSnap.data() : null;

            // GLOBAL LOGOUT ATTACHMENT
            // This looks for any element with id 'logout-btn' and attaches the logic
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.onclick = async (e) => {
                    e.preventDefault();
                    await logoutUser();
                };
            }

            callback({ ...user, profile });
        } else {
            if (!window.location.pathname.includes('login.html')) {
                window.location.href = 'login.html';
            }
        }
    });
}