import { auth, db, functions } from "./firebase-config.js"; 
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Keep track of listeners to stop them on logout
let unsubscribeUser = null;
let unsubscribeOrg = null;

onAuthStateChanged(auth, (user) => {
    if (!user) {
        // Clean up listeners if they exist
        if (unsubscribeUser) unsubscribeUser();
        if (unsubscribeOrg) unsubscribeOrg();
        
        window.location.href = "login.html";
        return;
    }

    // 1. Get User Data to find Org
    const userRef = doc(db, "users", user.uid);
    unsubscribeUser = onSnapshot(userRef, (userSnap) => {
        if (userSnap.exists()) {
            const orgId = userSnap.data().orgId;
            if (!orgId) return;
            
            const orgRef = doc(db, "organizations", orgId);

            // 2. Real-time listener for the "isActive" flag
            if (unsubscribeOrg) unsubscribeOrg(); // prevent multiple listeners
            unsubscribeOrg = onSnapshot(orgRef, (orgSnap) => {
                if (orgSnap.exists() && orgSnap.data().isActive === true) {
                    console.log("Subscription active! Redirecting...");
                    window.location.href = "index.html";
                }
            }, (error) => {
                if (error.code !== 'permission-denied') {
                    console.error("Org Listener Error:", error);
                }
            });
        }
    });
});

// 3. Handle Stripe Portal Button
const portalBtn = document.getElementById('portal-btn');
if (portalBtn) {
    portalBtn.addEventListener('click', async () => {
        portalBtn.innerText = "Connecting to Stripe...";
        portalBtn.disabled = true;

        try {
            // This calls your 'createPortalSession' Cloud Function
            const createPortalSession = httpsCallable(functions, 'createPortalSession');
            const result = await createPortalSession();
            
            if (result.data && result.data.url) {
                window.location.href = result.data.url;
            } else {
                throw new Error("No URL returned from portal session.");
            }
        } catch (error) {
            console.error("Portal Error:", error);
            alert("Unable to open billing portal. Please contact support or try again later.");
            portalBtn.innerText = "Update Payment Method";
            portalBtn.disabled = false;
        }
    });
}

// 4. Handle Logout
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        try {
            // Clear any lingering local data if you use it (like sidebar state)
            localStorage.removeItem('userRole'); 
            
            await signOut(auth);
            // The onAuthStateChanged above will handle the redirect to login.html
        } catch (err) {
            console.error("Logout error:", err);
        }
    });
}