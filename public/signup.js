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
// Added Functions
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

const signupForm = document.getElementById('signup-form');
const submitBtn = document.getElementById('submit-btn');
const urlParams = new URLSearchParams(window.location.search);

const inviteToken = urlParams.get('token'); 
const sessionId = urlParams.get('session_id'); 
const planFromUrl = urlParams.get('plan') || 'starter';

let inviteData = null;

async function checkAccess() {
    try {
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
                alert("Invalid invitation link.");
                window.location.href = 'login.html';
            }
            return;
        }

        if (sessionId) {
            const sessionSnap = await getDoc(doc(db, "processed_sessions", sessionId));
            if (sessionSnap.exists()) {
                alert("This link has already been used.");
                window.location.href = 'login.html';
            }
        } else {
            window.location.href = 'https://www.mergepoint-software.com/pricing.html';
        }
    } catch (error) { console.error(error); }
}

function updateUIForInvite(data) {
    document.getElementById('signup-title').innerText = "Join " + (data.orgName || "your team");
    document.getElementById('company-field-group').style.display = "none";
    document.getElementById('email').value = data.email;
    document.getElementById('email').disabled = true;
}

checkAccess();

signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitBtn.innerText = "Creating Account...";
    submitBtn.disabled = true;

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const fullName = document.getElementById('user-name').value;
    const companyName = document.getElementById('company-name').value;

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        let finalOrgId = "";
        let finalRole = "";

        if (inviteData) {
            finalOrgId = inviteData.orgId;
            finalRole = inviteData.role; 
            await setDoc(doc(db, "invites", inviteToken), { status: 'used' }, { merge: true });
        } else {
            const orgRef = await addDoc(collection(db, "organizations"), {
                name: companyName,
                createdAt: serverTimestamp(),
                ownerUid: user.uid,
                stripeSessionId: sessionId,
                status: 'active',
                plan: planFromUrl,
                docCount: 0,
                usageMonth: { drafts: 0 }
            });
            finalOrgId = orgRef.id;
            finalRole = "admin";

            if (sessionId) {
                await setDoc(doc(db, "processed_sessions", sessionId), {
                    usedAt: serverTimestamp(),
                    userId: user.uid,
                    orgId: finalOrgId
                });
            }
        }

        await setDoc(doc(db, "users", user.uid), {
            displayName: fullName,
            email: email,
            role: finalRole,
            orgId: finalOrgId,
            createdAt: serverTimestamp()
        });

        // TRIGGER STRIPE ATTACHMENT
        if (sessionId && finalRole === "admin") {
            try {
                const functions = getFunctions(undefined, "us-east1");
                const attachStripeCustomer = httpsCallable(functions, "attachStripeCustomer");
                await attachStripeCustomer({ sessionId, orgId: finalOrgId });
            } catch (err) { console.error("Stripe link failed, safety net will catch it:", err); }
        }

        window.location.href = 'index.html';
    } catch (error) {
        alert(error.message);
        submitBtn.innerText = "Create Account";
        submitBtn.disabled = false;
    }
});