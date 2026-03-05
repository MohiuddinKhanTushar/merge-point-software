import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, 
    getDoc, 
    setDoc, 
    addDoc, 
    collection, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"; 

const signupForm = document.getElementById('signup-form');
const submitBtn = document.getElementById('submit-btn');
const urlParams = new URLSearchParams(window.location.search);

// Capture parameters from URL
const inviteToken = urlParams.get('token'); 
const sessionId = urlParams.get('session_id'); 
const planFromUrl = urlParams.get('plan') || 'starter'; // Default to starter if not specified

let inviteData = null;

// 1. Gatekeeper: Check for Invitation or Stripe Payment on Load
async function checkAccess() {
    try {
        // SCENARIO A: Employee Invite
        if (inviteToken) {
            const inviteRef = doc(db, "invites", inviteToken);
            const inviteSnap = await getDoc(inviteRef);

            if (inviteSnap.exists()) {
                inviteData = inviteSnap.data();
                if (inviteData.status === 'used') {
                    alert("This invitation has already been used.");
                    window.location.href = 'login.html';
                    return;
                }
                updateUIForInvite(inviteData);
            } else {
                alert("This invitation link is invalid or has expired.");
                window.location.href = 'login.html';
            }
            return;
        }

        // SCENARIO B: Stripe Payment (Admin)
        if (sessionId) {
            // SECURITY: Check if this session has already been used
            const sessionRef = doc(db, "processed_sessions", sessionId);
            const sessionSnap = await getDoc(sessionRef);

            if (sessionSnap.exists()) {
                alert("This signup link has already been used. Please log in instead.");
                window.location.href = 'login.html';
                return;
            }
            console.log(`Verified: Unused ${planFromUrl} session.`);
        } else {
            // No credentials found
            console.warn("No session ID or invite token found. Redirecting to pricing.");
            window.location.href = 'https://www.mergepoint-software.com/pricing.html';
        }
    } catch (error) {
        console.error("Access Check Error:", error);
    }
}

function updateUIForInvite(data) {
    document.getElementById('signup-title').innerText = "Join " + (data.orgName || "your team");
    document.getElementById('signup-subtitle').innerText = "Set up your personal account";
    document.getElementById('company-field-group').style.display = "none";
    if(submitBtn) submitBtn.innerText = "Join Workspace";
    document.getElementById('email').value = data.email;
    document.getElementById('email').disabled = true;
}

// Run access check
checkAccess();

// 2. Handle Registration
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // UI Feedback: Prevent multiple clicks
    const originalBtnText = submitBtn.innerText;
    submitBtn.innerText = "Creating Account...";
    submitBtn.disabled = true;

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const fullName = document.getElementById('user-name').value;
    const companyName = document.getElementById('company-name').value;

    try {
        // A. Create Authentication User
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        let finalOrgId = "";
        let finalRole = "";

        if (inviteData) {
            // SCENARIO: Joining Existing Org
            finalOrgId = inviteData.orgId;
            finalRole = inviteData.role; 

            // Mark invite as used
            await setDoc(doc(db, "invites", inviteToken), { status: 'used' }, { merge: true });
        } else {
            // SCENARIO: Creating New Org (Admin via Stripe)
            if (!companyName) throw new Error("Company Name is required for new accounts.");
            
            // Create Organization document
            const orgRef = await addDoc(collection(db, "organizations"), {
                name: companyName,
                createdAt: serverTimestamp(),
                ownerUid: user.uid,
                stripeSessionId: sessionId,
                status: 'active',
                plan: planFromUrl, // FIXED: Now uses the plan captured from the URL
                docCount: 0,
                usageMonth: { drafts: 0 }
            });
            
            finalOrgId = orgRef.id;
            finalRole = "admin";

            // BURN THE TICKET: Mark session as used
            if (sessionId) {
                await setDoc(doc(db, "processed_sessions", sessionId), {
                    usedAt: serverTimestamp(),
                    userId: user.uid,
                    email: email,
                    orgId: finalOrgId,
                    planApplied: planFromUrl
                });
            }
        }

        // B. Create User Profile
        await setDoc(doc(db, "users", user.uid), {
            displayName: fullName,
            email: email,
            role: finalRole,
            orgId: finalOrgId,
            stripeSessionId: sessionId || null,
            createdAt: serverTimestamp()
        });

        // SUCCESS: Redirect to app dashboard
        window.location.href = 'index.html';

    } catch (error) {
        console.error("Signup Error:", error);
        alert(error.message);
        
        // Re-enable button on error
        submitBtn.innerText = originalBtnText;
        submitBtn.disabled = false;
    }
});