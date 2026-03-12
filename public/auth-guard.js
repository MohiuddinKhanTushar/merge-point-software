import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Keep track of active listeners so we can kill them on redirect
let detachUserListener = null;
let detachOrgListener = null;

onAuthStateChanged(auth, (user) => {
    const path = window.location.pathname;
    const isPublicPage = path.includes("login.html") || path.includes("signup.html") || path.includes("invite.html");

    if (!user) {
        if (!isPublicPage) {
            window.location.href = "login.html";
        }
        return;
    }

    // 1. Monitor User Profile
    if (detachUserListener) detachUserListener(); // Clean up existing if any
    detachUserListener = onSnapshot(doc(db, "users", user.uid), (userSnap) => {
        if (!userSnap.exists()) return;

        const userData = userSnap.data();
        const orgId = userData.orgId;

        if (!orgId) return;

        // 2. Monitor Organization Status
        if (detachOrgListener) detachOrgListener(); // Clean up existing if any
        detachOrgListener = onSnapshot(doc(db, "organizations", orgId), (orgSnap) => {
            const orgData = orgSnap.data();
            const isAtRiskPage = !path.includes("redirect.html") && !path.includes("settings.html");

            // 3. The Redirect Logic
            if (orgData && orgData.isActive === false && isAtRiskPage) {
                console.log("Subscription inactive. Cleaning up listeners and redirecting...");
                
                // CRITICAL: Stop listening to Firestore before redirecting 
                // to prevent "Missing or insufficient permissions" errors in the console.
                if (detachUserListener) detachUserListener();
                if (detachOrgListener) detachOrgListener();

                window.location.href = "redirect.html";
            }
        }, (error) => {
            // Silently handle permission errors on the org doc during transitions
            if (error.code !== 'permission-denied') {
                console.error("Org Snapshot Error:", error);
            }
        });
    }, (error) => {
        if (error.code !== 'permission-denied') {
            console.error("User Snapshot Error:", error);
        }
    });
});