import { db, auth } from './firebase-config.js';
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc, orderBy, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * Initializes the sidebar and notifications
 */
export function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    
    // Call the notification setup here so it runs on every page
    setupNotifications();

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

function updateIcon(btn, isCollapsed) {
    const icon = btn.querySelector('i, svg');
    if (icon) {
        icon.setAttribute('data-lucide', isCollapsed ? 'menu' : 'chevron-left');
    }
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
    } catch (error) {
        console.error("Global UI Error:", error);
    }
}

function setupNotifications() {
    auth.onAuthStateChanged(user => {
        if (!user) return;

        // Find existing header or create a fallback top-right container
        let navRight = document.querySelector('.nav-right') || 
                       document.querySelector('.header-actions');
        
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
                    <div id="noti-dropdown" style="display:none; position: absolute; top: 40px; right: 0; width: 320px; background: white; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); z-index: 9999; max-height: 450px; overflow-y: auto;">
                        <div style="padding: 15px; font-weight: 700; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center;">
                            <span>Notifications</span>
                        </div>
                        <div id="noti-list">
                            <div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 14px;">No new notifications</div>
                        </div>
                    </div>
                </div>
            `;
            navRight.insertAdjacentHTML('afterbegin', bellHtml);
            if (window.lucide) lucide.createIcons();
        }

        const q = query(
            collection(db, "notifications"),
            where("recipientEmail", "==", user.email),
            orderBy("createdAt", "desc")
        );

        const q2 = query(
            collection(db, "notifications"),
            where("recipientId", "==", user.uid),
            orderBy("createdAt", "desc")
        );

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
        // Only show if count > 0, and as a red number (no background)
        badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }

    if (items.length === 0) {
        list.innerHTML = `<div style="padding: 20px; text-align: center; color: #94a3b8;">All caught up!</div>`;
        return;
    }

    list.innerHTML = items.map(n => `
        <div class="noti-item" onclick="handleNotiClick('${n.id}', '${n.bidId}', '${n.type}')" 
             style="padding: 15px; border-bottom: 1px solid #f1f5f9; font-size: 13px; transition: background 0.2s; background: ${n.read ? 'white' : '#f0f7ff'}; cursor: pointer;">
            <div style="font-weight: ${n.read ? '400' : '600'}; color: #1e293b; margin-bottom: 4px;">${n.message}</div>
            <div style="font-size: 11px; color: #94a3b8;">${n.createdAt?.toDate().toLocaleString() || 'Just now'}</div>
        </div>
    `).join('');
}

window.handleNotiClick = async (notiId, bidId, type) => {
    try {
        await updateDoc(doc(db, "notifications", notiId), { read: true });
        if (type === 'submission') {
            window.location.href = `team-hub.html`;
        } else {
            window.location.href = `workspace.html?id=${bidId}`;
        }
    } catch (e) {
        console.error("Error updating notification:", e);
    }
};

document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('noti-dropdown');
    const bell = document.getElementById('notification-bell');
    if (!dropdown || !bell) return;

    if (e.target.id === 'notification-bell' || bell.contains(e.target)) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    } else if (!dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});