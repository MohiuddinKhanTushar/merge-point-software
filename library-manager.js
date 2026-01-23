import { db, auth } from './firebase-config.js';
import { initSidebar } from './ui-manager.js';
import { logoutUser } from './auth.js';
import { 
    collection, 
    query, 
    where, 
    onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let allArchiveData = []; // Local cache for searching/filtering

/**
 * Main entry point for the RFP Library Page
 * Replaces the roles of script.js for this specific page
 */
export function initLibrary() {
    // 1. Initialize Global UI (Sidebar collapse logic)
    initSidebar();

    // 2. Setup Global Logout Button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logoutUser();
        });
    }

    const tableBody = document.getElementById('library-body');
    if (!tableBody) return;

    // 3. Auth State & Data Fetching
    auth.onAuthStateChanged((user) => {
        if (user) {
            console.log("Library authenticated for:", user.uid);
            fetchArchivedBids(user.uid);
        } else {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center; padding:2rem;">
                        Please log in to view the library.
                    </td>
                </tr>`;
        }
    });

    // 4. Setup Search and Filter UI listeners
    setupListeners();
}

/**
 * Fetch data from the 'archived_rfps' collection in Firestore
 */
function fetchArchivedBids(userId) {
    const archiveQuery = query(
        collection(db, "archived_rfps"),
        where("ownerId", "==", userId)
    );

    onSnapshot(archiveQuery, (snapshot) => {
        allArchiveData = [];
        snapshot.forEach((doc) => {
            allArchiveData.push({ id: doc.id, ...doc.data() });
        });
        
        console.log(`Library loaded ${allArchiveData.length} documents.`);
        renderLibrary(allArchiveData);
    }, (error) => {
        console.error("Firestore Archive Error:", error);
    });
}

function setupListeners() {
    const searchInput = document.getElementById('library-search');
    const industryFilter = document.getElementById('filter-industry');

    searchInput?.addEventListener('input', () => performFilter());
    industryFilter?.addEventListener('change', () => performFilter());
}

function performFilter() {
    const queryStr = document.getElementById('library-search').value.toLowerCase();
    const industry = document.getElementById('filter-industry').value;

    const filtered = allArchiveData.filter(item => {
        const matchesSearch = (item.bidName || "").toLowerCase().includes(queryStr) || 
                             (item.client || "").toLowerCase().includes(queryStr);
        const matchesIndustry = industry === 'all' || item.industry === industry;
        return matchesSearch && matchesIndustry;
    });

    renderLibrary(filtered);
}

/**
 * Render rows into the table and refresh Lucide icons
 */
function renderLibrary(data) {
    const tableBody = document.getElementById('library-body');
    if (!tableBody) return;

    if (data.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center; padding:2rem; color: #94a3b8;">
                    No archived documents found.
                </td>
            </tr>`;
        return;
    }

    tableBody.innerHTML = data.map(item => {
        // Format the Firebase Timestamp
        const dateDisplay = item.dateArchived?.toDate 
            ? item.dateArchived.toDate().toLocaleDateString() 
            : 'No Date';

        return `
            <tr>
                <td><strong>${item.bidName || 'Untitled'}</strong></td>
                <td>${item.client || 'N/A'}</td>
                <td><span class="badge">${item.industry || 'General'}</span></td>
                <td>${dateDisplay}</td>
                <td style="text-align: right;">
                    <button class="btn-secondary-outline" style="padding: 4px 8px;" onclick="window.viewProject('${item.id}')">
                    <i data-lucide="eye" style="width:14px; height:14px;"></i> View
                </button>
                </td>
            </tr>
        `;
    }).join('');
    
    // Refresh icons for the newly injected "View" buttons
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Function to Open the Modal and fill it with data
window.viewProject = (id) => {
    const project = allArchiveData.find(p => p.id === id);
    if (!project) return;

    // Fill the modal with content
    document.getElementById('modal-project-name').innerText = project.bidName || 'Untitled Project';
    document.getElementById('modal-client').innerText = project.client || 'N/A';
    document.getElementById('modal-industry').innerText = project.industry || 'General';
    document.getElementById('modal-text').innerText = project.summary || "No summary text available for this archive.";

    // Check if summary exists, otherwise provide a placeholder
    const summaryContent = project.summary || "No archived text available for this entry. You can add a 'summary' field to this document in the Firebase Console to see it here.";
    document.getElementById('modal-text').innerText = summaryContent;

    // Show the modal
    const modal = document.getElementById('archive-modal');
    modal.style.display = 'flex';

    // Refresh icons inside the modal (like the X button)
    if (window.lucide) window.lucide.createIcons();
};

// Function to Close the Modal
window.closeArchiveModal = () => {
    document.getElementById('archive-modal').style.display = 'none';
};

// Optional: Close modal if user clicks the dark background area
window.onclick = function(event) {
    const modal = document.getElementById('archive-modal');
    if (event.target === modal) {
        modal.style.display = "none";
    }
};