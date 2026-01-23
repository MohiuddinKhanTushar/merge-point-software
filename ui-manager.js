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