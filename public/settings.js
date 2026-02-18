import { db } from './firebase-config.js';
import { checkAuthState } from './auth.js';
import { 
    doc, 
    getDoc, 
    updateDoc, 
    collection, 
    query, 
    where, 
    onSnapshot, 
    setDoc,
    addDoc,
    deleteDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export function initSettings() {
    console.log("Settings initialization started...");

    checkAuthState(async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }

        try {
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);
            
            if (!userSnap.exists()) {
                alert("User profile not found.");
                return;
            }

            const userData = userSnap.data();

            if (userData.role !== 'admin') {
                const cancelBtn = document.getElementById('modal-cancel');
                if (cancelBtn) cancelBtn.style.display = 'none';

                await showConfirmModal(
                    "Access Denied", 
                    "You do not have administrative permissions to view this page.",
                    "OK"
                );

                if (cancelBtn) cancelBtn.style.display = 'block';
                window.location.href = 'index.html';
                return;
            }

            const pageContent = document.getElementById('settings-page-content');
            if (pageContent) pageContent.style.display = 'flex';

            const orgId = userData.orgId || 'default-org';
            setupReviewToggle(orgId);
            loadUsers(orgId, user.uid); 
            loadPendingInvites(orgId);
            // Pass the Admin's name so the email feels personal
            setupInviteForm(orgId, userData.displayName || user.email); 

        } catch (error) {
            console.error("Settings Error:", error);
        }
    });
}

// --- USER MANAGEMENT LOGIC ---

function loadUsers(orgId, currentUserUid) {
    const userList = document.getElementById('user-list');
    if (!userList) return;

    const q = query(collection(db, "users"), where("orgId", "==", orgId));

    onSnapshot(q, (snapshot) => {
        userList.innerHTML = '';
        snapshot.forEach((uDoc) => {
            const data = uDoc.data();
            const row = document.createElement('tr');
            row.style.borderBottom = "1px solid #f1f5f9";
            
            const isSelf = uDoc.id === currentUserUid;

            row.innerHTML = `
                <td style="padding: 16px 12px; width: 40%;">
                    <div style="font-weight: 600; color: #1e293b;">${data.displayName || 'Unnamed User'}</div>
                    <div style="font-size: 0.75rem; color: #64748b;">${data.email} ${isSelf ? '(You)' : ''}</div>
                </td>
                <td style="padding: 16px 12px; width: 30%; text-align: left;">
                    <select class="role-changer" style="padding: 6px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #f8fafc; font-size: 0.8rem; min-width: 110px;" ${isSelf ? 'disabled' : ''}>
                        <option value="standard" ${data.role === 'standard' ? 'selected' : ''}>STANDARD</option>
                        <option value="manager" ${data.role === 'manager' ? 'selected' : ''}>MANAGER</option>
                        <option value="admin" ${data.role === 'admin' ? 'selected' : ''}>ADMIN</option>
                    </select>
                </td>
                <td style="padding: 16px 12px; width: 30%; text-align: right;">
                    ${isSelf ? '' : `<button class="remove-user-btn" style="color: #dc2626; background: none; border: 1px solid #fecaca; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 500;">Remove</button>`}
                </td>
            `;

            const selector = row.querySelector('.role-changer');
            if (selector) selector.onchange = (e) => updateUserRole(uDoc.id, e.target.value);

            const removeBtn = row.querySelector('.remove-user-btn');
            if (removeBtn) {
                removeBtn.onclick = async () => {
                    const confirmed = await showConfirmModal(
                        "Remove User", 
                        `Are you sure you want to remove ${data.email}?`,
                        "Remove User"
                    );
                    if (confirmed) await removeUser(uDoc.id);
                };
            }
            userList.appendChild(row);
        });
    });
}

async function removeUser(uid) {
    try {
        await deleteDoc(doc(db, "users", uid));
    } catch (e) {
        console.error("Remove User Error:", e);
    }
}

function loadPendingInvites(orgId) {
    const inviteList = document.getElementById('pending-invite-list');
    if (!inviteList) return;

    const q = query(collection(db, "invites"), where("orgId", "==", orgId));

    onSnapshot(q, (snapshot) => {
        inviteList.innerHTML = '';
        if (snapshot.empty) {
            inviteList.innerHTML = '<tr><td colspan="3" style="padding: 12px; color: #94a3b8; text-align: center;">No pending invites</td></tr>';
            return;
        }

        snapshot.forEach((iDoc) => {
            const data = iDoc.data();
            const row = document.createElement('tr');
            row.style.borderBottom = "1px solid #f1f5f9";
            
            row.innerHTML = `
                <td style="padding: 16px 12px; width: 40%; color: #1e293b; font-weight: 500;">${data.email}</td>
                <td style="padding: 16px 12px; width: 30%; text-align: left;">
                    <span class="role-badge" style="text-transform: uppercase; font-size: 0.75rem;">${data.role}</span>
                </td>
                <td style="padding: 16px 12px; width: 30%; text-align: right;">
                    <button class="revoke-btn" style="color: #dc2626; background: none; border: 1px solid #fecaca; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 500;">Revoke</button>
                </td>
            `;

            row.querySelector('.revoke-btn').onclick = async () => {
                const confirmed = await showConfirmModal(
                    "Revoke Invitation", 
                    `Are you sure you want to revoke the invitation for ${data.email}?`,
                    "Revoke"
                );
                if (confirmed) {
                    try {
                        await deleteDoc(doc(db, "invites", iDoc.id));
                    } catch (e) {
                        console.error("Error revoking invite:", e);
                    }
                }
            };
            inviteList.appendChild(row);
        });
    });
}

function showConfirmModal(title, message, confirmText = "Confirm") {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        const titleEl = document.getElementById('modal-title');
        const bodyEl = document.getElementById('modal-body');
        const confirmBtn = document.getElementById('modal-confirm');
        const cancelBtn = document.getElementById('modal-cancel');

        titleEl.textContent = title;
        bodyEl.textContent = message;
        confirmBtn.textContent = confirmText;

        modal.style.display = 'flex';

        const close = (result) => {
            modal.style.display = 'none';
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
            modal.onclick = null;
            resolve(result);
        };

        confirmBtn.onclick = () => close(true);
        cancelBtn.onclick = () => close(false);
        modal.onclick = (e) => { if(e.target === modal) close(false); };
    });
}

/**
 * UPDATED: Creates an invite record AND triggers the Firebase Email Extension
 */
function setupInviteForm(orgId, adminName) {
    const inviteForm = document.getElementById('invite-form');
    if (!inviteForm) return;

    inviteForm.onsubmit = async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('invite-name');
        const emailInput = document.getElementById('invite-email');
        const roleInput = document.getElementById('invite-role');

        const guestName = nameInput.value.trim();
        const guestEmail = emailInput.value.toLowerCase().trim();
        const guestRole = roleInput.value;

        try {
            // 1. Create the Invite document (internal record)
            const inviteRef = await addDoc(collection(db, "invites"), {
                name: guestName,
                email: guestEmail,
                role: guestRole,
                orgId: orgId,
                invitedBy: adminName,
                status: 'pending',
                createdAt: serverTimestamp()
            });

            // 2. Build the link using the new domain logic
            // We use window.location.origin to handle local vs production automatically
            const inviteLink = `${window.location.origin}/invite.html?invite=${inviteRef.id}`;

            // 3. TRIGGER THE EXTENSION
            // We write a doc to the 'mail' collection. The extension listens for this.
            await addDoc(collection(db, "mail"), {
                to: guestEmail,
                message: {
                    subject: `Join ${adminName} on MergePoint`,
                    html: `
                        <div style="font-family: sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
                            <h2 style="color: #1e293b; margin-bottom: 16px;">Welcome to MergePoint</h2>
                            <p style="color: #475569; line-height: 1.6;">
                                Hello ${guestName},<br><br>
                                <strong>${adminName}</strong> has invited you to join their team on <strong>MergePoint</strong>.
                            </p>
                            <div style="margin: 32px 0; text-align: center;">
                                <a href="${inviteLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
                                    Accept Invitation
                                </a>
                            </div>
                            <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                                This invitation was sent for the MergePoint workspace. If you weren't expecting this, you can safely ignore this email.
                            </p>
                        </div>
                    `
                }
            });

            alert(`Invitation successfully sent to ${guestEmail}!`);
            inviteForm.reset();
        } catch (error) {
            console.error("Invite Error:", error);
            alert("Error sending invitation. Check the console for details.");
        }
    };
}

async function setupReviewToggle(orgId) {
    const toggle = document.getElementById('review-toggle');
    if (!toggle) return;
    const orgRef = doc(db, "organizations", orgId);
    try {
        const orgSnap = await getDoc(orgRef);
        if (!orgSnap.exists()) {
            await setDoc(orgRef, { reviewRequired: true });
            toggle.checked = true;
        } else {
            toggle.checked = orgSnap.data().reviewRequired ?? true;
        }
    } catch (e) {}

    toggle.onchange = async () => {
        try {
            await updateDoc(orgRef, { reviewRequired: toggle.checked });
        } catch (e) {}
    };
}

async function updateUserRole(uid, newRole) {
    try {
        const userRef = doc(db, "users", uid);
        await updateDoc(userRef, { role: newRole });
    } catch (e) {}
}