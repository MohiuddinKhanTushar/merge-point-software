import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, 
    getDoc, 
    setDoc, 
    deleteDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let activeInvite = null;

/**
 * Runs on page load: Checks URL for ?invite=ID and validates it
 */
export async function initInvitePage() {
    const urlParams = new URLSearchParams(window.location.search);
    const inviteId = urlParams.get('invite');
    
    // Target the wrapper div instead of just the form
    const signupContent = document.getElementById('signup-content');
    const loader = document.getElementById('loader');
    const roleText = document.getElementById('role-text');
    const roleBadge = document.getElementById('role-badge');

    if (!inviteId) {
        showError("No invitation token found. Please check the link in your email.");
        loader.style.display = 'none';
        return;
    }

    try {
        const inviteRef = doc(db, "invites", inviteId);
        const inviteSnap = await getDoc(inviteRef);

        if (!inviteSnap.exists()) {
            showError("This invitation is invalid, expired, or has been revoked.");
            loader.style.display = 'none';
            return;
        }

        activeInvite = { id: inviteSnap.id, ...inviteSnap.data() };

        // 1. Pre-fill the email
        document.getElementById('signup-email').value = activeInvite.email || "";
        
        // 2. Update the UI Badge with the role
        if (roleText && roleBadge) {
            roleText.textContent = (activeInvite.role || 'member').toUpperCase();
            roleBadge.style.display = 'block';
        }
        
        // 3. Reveal the content and hide loader
        loader.style.display = 'none';
        signupContent.style.display = 'block';

    } catch (error) {
        console.error("Invite Verification Error:", error);
        showError("Error connecting to server. Please try again later.");
    }
}

/**
 * Handles account creation
 */
export async function handleSignup(e) {
    e.preventDefault();
    
    if (!activeInvite) {
        showError("Invitation not verified.");
        return;
    }

    const password = document.getElementById('signup-password').value;
    const errorBox = document.getElementById('error-box');
    if (errorBox) errorBox.style.display = 'none';

    try {
        // Create user
        const userCredential = await createUserWithEmailAndPassword(auth, activeInvite.email, password);
        const user = userCredential.user;

        // Update profile name
        await updateProfile(user, {
            displayName: activeInvite.name || "Member"
        });

        // Create permanent profile
        await setDoc(doc(db, "users", user.uid), {
            displayName: activeInvite.name || "Unnamed User",
            email: activeInvite.email,
            role: activeInvite.role || 'member',
            orgId: activeInvite.orgId,
            companyId: activeInvite.orgId,
            createdAt: serverTimestamp()
        });

        // Cleanup invite
        try {
            await deleteDoc(doc(db, "invites", activeInvite.id));
        } catch (cleanupErr) {
            console.warn("Invite cleanup skipped.");
        }

        window.location.href = 'index.html';

    } catch (error) {
        console.error("Signup Error:", error);
        let message = error.message;
        if (error.code === 'auth/email-already-in-use') message = "Account already exists.";
        showError(message);
    }
}

function showError(msg) {
    const errorBox = document.getElementById('error-box');
    const errorText = document.getElementById('error-message');
    if (errorBox && errorText) {
        errorText.textContent = msg;
        errorBox.style.display = 'block';
    }
}