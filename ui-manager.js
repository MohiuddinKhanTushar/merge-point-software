export function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    
    if (!sidebar || !toggleBtn) return;

    const isCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
    
    // Apply state immediately
    if (isCollapsed) {
        sidebar.classList.add('no-transition');
        sidebar.classList.add('collapsed');
        document.documentElement.classList.add('sidebar-is-collapsed');
        updateIcon(toggleBtn, true);
        setTimeout(() => sidebar.classList.remove('no-transition'), 100);
    }

    // IMPORTANT: Force a re-render of icons inside the sidebar specifically
    if (window.lucide) {
        window.lucide.createIcons();
    }

    toggleBtn.addEventListener('click', () => {
        const nowCollapsed = sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar-collapsed', nowCollapsed);
        document.documentElement.classList.toggle('sidebar-is-collapsed', nowCollapsed);
        
        updateIcon(toggleBtn, nowCollapsed);
        
        if (window.lucide) {
            window.lucide.createIcons();
        }
    });
}

function updateIcon(btn, isCollapsed) {
    const icon = btn.querySelector('i, svg');
    if (icon) {
        icon.setAttribute('data-lucide', isCollapsed ? 'menu' : 'chevron-left');
    }
}

import { db, auth } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

            // 1. Update Name
            if (nameEl) nameEl.textContent = fullName;
            
            // 2. Update Role (Uppercase for style)
            if (roleEl) roleEl.textContent = role.toUpperCase();

            // 3. Update Avatar Initial
            if (avatarEl) {
                avatarEl.textContent = fullName.charAt(0).toUpperCase();
                // Optional: Give admins a different color circle
                if (role === 'admin') avatarEl.style.background = '#ef4444';
            }
        }
    } catch (error) {
        console.error("Global UI Error:", error);
    }
}