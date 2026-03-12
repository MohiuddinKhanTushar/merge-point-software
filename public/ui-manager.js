import { db, auth } from './firebase-config.js';
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc, orderBy, addDoc, deleteDoc, writeBatch, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * Injects required CSS for the notification system and mobile restriction
 */
function injectNotificationStyles() {
    if (document.getElementById('noti-styles')) return;
    const style = document.createElement('style');
    style.id = 'noti-styles';
    style.innerHTML = `
        .noti-action-btn {
            border: none;
            padding: 5px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        #mark-all-read {
            background: #eef2ff;
            color: #4f46e5;
        }
        #mark-all-read:hover {
            background: #e0e7ff;
            transform: translateY(-1px);
        }
        #clear-all-notis {
            background: #fff1f2;
            color: #ef4444;
        }
        #clear-all-notis:hover {
            background: #ffe4e6;
            transform: translateY(-1px);
        }
        .noti-item:hover {
            background-color: #f8fafc !important;
        }
        .delete-x-btn {
            position: absolute;
            top: 15px;
            right: 10px;
            color: #94a3b8;
            font-size: 18px;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: all 0.2s;
            background: transparent;
        }
        .delete-x-btn:hover {
            background: #fee2e2;
            color: #ef4444;
            transform: scale(1.1);
        }

        /* Mobile Restriction Styles */
        #mobile-restriction-overlay {
            display: none;
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: #ffffff;
            z-index: 100000;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            text-align: center;
        }

        @media (max-width: 1024px) {
            #mobile-restriction-overlay {
                display: flex;
            }
            body > *:not(#mobile-restriction-overlay) {
                display: none !important;
            }
        }
    `;
    document.head.appendChild(style);
}

/**
 * Initializes the sidebar and notifications
 */
export function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    
    injectNotificationStyles(); // Style injection must happen before overlay creation
    handleMobileRestriction();
    setupNotifications();
    initGlobalModals();

    if (!sidebar || !toggleBtn) return;

    const isCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('no-transition');
        sidebar.classList.add('collapsed');
        document.documentElement.classList.add('sidebar-is-collapsed');
        updateIcon(toggleBtn, true);
        setTimeout(() => sidebar.classList.remove('no-transition'), 100);
    }

    if (window.lucide) {
        window.lucide.createIcons();
    }

    toggleBtn.addEventListener('click', () => {
        const nowCollapsed = sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar-collapsed', nowCollapsed);
        document.documentElement.classList.toggle('sidebar-is-collapsed', nowCollapsed);
        updateIcon(toggleBtn, nowCollapsed);
        if (window.lucide) window.lucide.createIcons();
    });
}

/**
 * Global Modal System
 */
function initGlobalModals() {
    if (document.getElementById('custom-confirm-modal')) return;

    const modalHTML = `
        <div id="custom-confirm-modal" class="modal" style="display:none; position:fixed; z-index:10000; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter: blur(4px);">
            <div style="background: white; padding: 2rem; border-radius: 16px; max-width: 400px; width: 90%; margin: 15vh auto; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);">
                <h3 id="confirm-title" style="margin-bottom: 1rem; color: #1e293b; font-size: 1.25rem;">Confirm Action</h3>
                <p id="confirm-message" style="margin-bottom: 2rem; color: #64748b; font-size: 0.95rem; line-height: 1.5;">Are you sure?</p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="confirm-cancel" class="btn-outline" style="flex: 1; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; background: white; font-weight: 500; display: flex; align-items: center; justify-content: center; text-align: center;">Cancel</button>
                    <button id="confirm-proceed" class="btn-hero" style="flex: 1; padding: 0.75rem; border: none; border-radius: 8px; cursor: pointer; color: white; font-weight: 500; display: flex; align-items: center; justify-content: center; text-align: center;">Proceed</button>
                </div>
            </div>
        </div>

        <div id="custom-alert-modal" class="modal" style="display:none; position:fixed; z-index:10000; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter: blur(4px);">
            <div style="background: white; padding: 2rem; border-radius: 16px; max-width: 400px; width: 90%; margin: 15vh auto; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);">
                <h3 id="alert-title" style="margin-bottom: 1rem; color: #1e293b; font-size: 1.25rem;">Notification</h3>
                <p id="alert-message" style="margin-bottom: 2rem; color: #64748b; font-size: 0.95rem; line-height: 1.5;"></p>
                <div style="display: flex; justify-content: center;">
                    <button id="alert-close" class="btn-hero" style="width: 120px; padding: 0.75rem; border: none; border-radius: 8px; cursor: pointer; background: #4f46e5; color: white; font-weight: 500; display: flex; align-items: center; justify-content: center; text-align: center;">Got it</button>
                </div>
            </div>
        </div>

        <div id="custom-prompt-modal" class="modal" style="display:none; position:fixed; z-index:10000; left:0; top:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter: blur(4px);">
            <div style="background: white; padding: 2rem; border-radius: 16px; max-width: 450px; width: 90%; margin: 15vh auto; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); text-align: center;">
                <h3 id="prompt-title" style="margin-bottom: 0.5rem; color: #1e293b; font-size: 1.5rem;">Instructions</h3>
                <p id="prompt-message" style="margin-bottom: 1.5rem; color: #64748b; font-size: 0.95rem; line-height: 1.4;"></p>
                <textarea id="prompt-input" style="width: 100%; height: 120px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 1.5rem; font-family: inherit; font-size: 0.95rem; resize: none; box-sizing: border-box;" placeholder="Type your notes here..."></textarea>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="prompt-cancel" class="btn-outline" style="flex: 1; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer; background: white; font-weight: 500; display: flex; align-items: center; justify-content: center;">Cancel</button>
                    <button id="prompt-submit" class="btn-hero" style="flex: 1; padding: 0.75rem; border: none; border-radius: 8px; cursor: pointer; background: #4f46e5; color: white; font-weight: 500; display: flex; align-items: center; justify-content: center;">Submit</button>
                </div>
            </div>
        </div>`;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

export const showConfirm = (title, message, proceedText = "Delete") => {
    initGlobalModals();
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-confirm-modal');
        document.getElementById('confirm-title').innerText = title;
        document.getElementById('confirm-message').innerText = message;
        const proceedBtn = document.getElementById('confirm-proceed');
        proceedBtn.innerText = proceedText;
        const isDelete = proceedText.toLowerCase().includes('delete');
        proceedBtn.style.background = isDelete ? '#ff4d4d' : '#4f46e5';
        modal.style.display = 'block';

        document.getElementById('confirm-cancel').onclick = () => { modal.style.display = 'none'; resolve(false); };
        proceedBtn.onclick = () => { modal.style.display = 'none'; resolve(true); };
    });
};

export const showAlert = (title, message) => {
    initGlobalModals();
    const modal = document.getElementById('custom-alert-modal');
    document.getElementById('alert-title').innerText = title;
    document.getElementById('alert-message').innerText = message;
    modal.style.display = 'block';
    document.getElementById('alert-close').onclick = () => { modal.style.display = 'none'; };
};

export const showPrompt = (title, message) => {
    initGlobalModals();
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-prompt-modal');
        const input = document.getElementById('prompt-input');
        document.getElementById('prompt-title').innerText = title;
        document.getElementById('prompt-message').innerText = message;
        input.value = "";
        modal.style.display = 'block';
        input.focus();

        document.getElementById('prompt-cancel').onclick = () => { modal.style.display = 'none'; resolve(null); };
        document.getElementById('prompt-submit').onclick = () => {
            const val = input.value;
            modal.style.display = 'none';
            resolve(val);
        };
    });
};

function updateIcon(btn, isCollapsed) {
    const icon = btn.querySelector('i, svg');
    if (icon) icon.setAttribute('data-lucide', isCollapsed ? 'menu' : 'chevron-left');
}

export async function updateGlobalUserProfile(user) {
    if (!user) return;
    try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        const nameEl = document.getElementById('display-name');
        const avatarEl = document.getElementById('avatar-circle');
        const roleEl = document.getElementById('display-role');

        if (userSnap.exists()) {
            const userData = userSnap.data();
            const fullName = userData.displayName || user.email.split('@')[0];
            const role = userData.role || 'Member';
            if (nameEl) nameEl.textContent = fullName;
            if (roleEl) roleEl.textContent = role.toUpperCase();
            if (avatarEl) {
                avatarEl.textContent = fullName.charAt(0).toUpperCase();
                if (role === 'admin') avatarEl.style.background = '#ef4444';
            }
        }
    } catch (error) { console.error("Global UI Error:", error); }
}

function setupNotifications() {
    auth.onAuthStateChanged(user => {
        if (!user) return;
        let navRight = document.querySelector('.nav-right') || document.querySelector('.header-actions');
        if (!navRight) {
            navRight = document.createElement('div');
            navRight.id = 'manual-nav-right';
            navRight.style.cssText = "position: absolute; top: 20px; right: 30px; z-index: 1000; display: flex; align-items: center;";
            document.body.appendChild(navRight);
        }
        if (!document.getElementById('notification-bell')) {
            const bellHtml = `
                <div class="noti-wrapper" style="position: relative; margin: 0 15px; cursor: pointer; display: flex; align-items: center;">
                    <i data-lucide="bell" id="notification-bell" style="color: #64748b;"></i>
                    <span id="noti-badge" style="display:none; position: absolute; top: -8px; right: -8px; color: #ef4444; font-size: 11px; font-weight: bold; align-items: center; justify-content: center;">0</span>
                    <div id="noti-dropdown" style="display:none; position: absolute; top: 45px; right: 0; width: 340px; background: white; border: 1px solid #e2e8f0; border-radius: 14px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); z-index: 9999; max-height: 500px; overflow: hidden; flex-direction: column;">
                        <div style="padding: 16px; font-weight: 700; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; background: #f8fafc;">
                            <span style="color: #1e293b; font-size: 14px;">Notifications</span>
                            <div style="display: flex; gap: 8px;">
                                <button id="mark-all-read" class="noti-action-btn">Mark all read</button>
                                <button id="clear-all-notis" class="noti-action-btn">Clear all</button>
                            </div>
                        </div>
                        <div id="noti-list" style="overflow-y: auto; flex: 1;">
                            <div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 14px;">No new notifications</div>
                        </div>
                    </div>
                </div>`;
            navRight.insertAdjacentHTML('afterbegin', bellHtml);
            
            document.getElementById('clear-all-notis').onclick = (e) => {
                e.stopPropagation();
                handleBulkAction(user.uid, user.email, 'delete');
            };

            document.getElementById('mark-all-read').onclick = (e) => {
                e.stopPropagation();
                handleBulkAction(user.uid, user.email, 'read');
            };

            if (window.lucide) lucide.createIcons();
        }
        const q = query(collection(db, "notifications"), where("recipientEmail", "==", user.email), orderBy("createdAt", "desc"));
        const q2 = query(collection(db, "notifications"), where("recipientId", "==", user.uid), orderBy("createdAt", "desc"));
        
        onSnapshot(q, (snap) => renderNotis(snap));
        onSnapshot(q2, (snap) => renderNotis(snap));
    });
}

function renderNotis(snapshot) {
    const list = document.getElementById('noti-list');
    const badge = document.getElementById('noti-badge');
    if (!list) return;
    let unreadCount = 0;
    const items = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        if (!data.read) unreadCount++;
        items.push({ id: doc.id, ...data });
    });
    if (badge) {
        badge.innerText = unreadCount;
        badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }
    if (items.length === 0) {
        list.innerHTML = `<div style="padding: 30px; text-align: center; color: #94a3b8; font-size: 13px;">All caught up!</div>`;
        return;
    }

    list.innerHTML = items.map(n => `
        <div class="noti-item" onclick="handleNotiClick('${n.id}', '${n.bidId}', '${n.type}')" 
             style="position: relative; padding: 16px; border-bottom: 1px solid #f1f5f9; font-size: 13px; transition: background 0.2s; background: ${n.read ? 'white' : '#f0f7ff'}; cursor: pointer;">
            <div style="font-weight: ${n.read ? '400' : '600'}; color: #1e293b; margin-bottom: 6px; padding-right: 30px; line-height: 1.4;">${n.message}</div>
            <div style="font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 4px;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: ${n.read ? '#cbd5e1' : '#4f46e5'};"></span>
                ${n.createdAt?.toDate().toLocaleString() || 'Just now'}
            </div>
            <div onclick="handleDeleteNoti(event, '${n.id}')" class="delete-x-btn">&times;</div>
        </div>`).join('');
}

window.handleDeleteNoti = async (event, notiId) => {
    event.stopPropagation();
    try {
        await deleteDoc(doc(db, "notifications", notiId));
    } catch (e) {
        console.error("Error deleting notification:", e);
    }
};

async function handleBulkAction(uid, email, actionType) {
    if (actionType === 'delete') {
        const confirmed = await showConfirm("Clear All Notifications", "This will permanently remove all notifications from your list. Continue?", "Clear All");
        if (!confirmed) return;
    }

    try {
        const batch = writeBatch(db);
        const q1 = query(collection(db, "notifications"), where("recipientEmail", "==", email));
        const q2 = query(collection(db, "notifications"), where("recipientId", "==", uid));

        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        
        const processSnap = (snap) => {
            snap.forEach(document => {
                if (actionType === 'delete') {
                    batch.delete(document.ref);
                } else if (actionType === 'read' && !document.data().read) {
                    batch.update(document.ref, { read: true });
                }
            });
        };

        processSnap(snap1);
        processSnap(snap2);

        await batch.commit();
    } catch (e) {
        console.error(`Error during ${actionType} all notifications:`, e);
    }
}

window.handleNotiClick = async (notiId, bidId, type) => {
    try {
        await updateDoc(doc(db, "notifications", notiId), { read: true });
        window.location.href = (type === 'submission') ? `team-hub.html` : `workspace.html?id=${bidId}`;
    } catch (e) { console.error("Error updating notification:", e); }
};

document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('noti-dropdown');
    const bell = document.getElementById('notification-bell');
    if (!dropdown || !bell) return;
    
    // Check if the click was on the bell or the dropdown
    const isBellClick = e.target.id === 'notification-bell' || bell.contains(e.target);
    const isInsideDropdown = dropdown.contains(e.target);

    if (isBellClick) {
        // Toggle between none and flex
        const isHidden = window.getComputedStyle(dropdown).display === 'none';
        dropdown.style.display = isHidden ? 'flex' : 'none';
    } else if (!isInsideDropdown) {
        // Close if clicking outside
        dropdown.style.display = 'none';
    }
});

function handleMobileRestriction() {
    if (document.getElementById('mobile-restriction-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'mobile-restriction-overlay';
    

    overlay.innerHTML = `
        <div style="max-width: 320px; width: 100%; margin: 0 auto; text-align: center;">
            <div style="background: #eff6ff; width: 64px; height: 64px; border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem;">
                <i data-lucide="monitor" style="color: #3b82f6; width: 32px; height: 32px;"></i>
            </div>
            <h2 style="color: #1e293b; font-size: 1.5rem; margin-bottom: 1rem; font-weight: 700; line-height: 1.2;">
                Desktop Version Required
            </h2>
            <p style="color: #64748b; line-height: 1.6; margin-bottom: 2rem; font-size: 0.95rem;">
                This workspace is optimized for professional use on large screens. Please switch to a PC or Mac browser to continue.
            </p>
            <div style="font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 1.5rem;">
                Mobile support is currently in development.
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    if (window.lucide) window.lucide.createIcons();
}