import { initSidebar } from './ui-manager.js';
import { db, auth, app } from './firebase-config.js'; 
import { checkAuthState, logoutUser } from './auth.js';
import { 
    collection, 
    query, 
    where, 
    onSnapshot, 
    addDoc, 
    doc, 
    getDoc, 
    deleteDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Start the sidebar logic
initSidebar();

const firestore = db; 

// Protect the page
checkAuthState((user) => {
    console.log("Welcome, user:", user.uid);
    loadActiveBids(user.uid);
});

// Hook up Logout
document.getElementById('logout-btn').addEventListener('click', logoutUser);

const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');

fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length > 0) {
        fileList.innerHTML = `<p><strong>Selected:</strong> ${files[0].name}</p>`;
        createNewBid(files[0].name);
    }
});

function toggleUpload() {
    const section = document.getElementById('upload-section');
    const triggerBtn = document.getElementById('main-upload-trigger');
    
    if (section.style.display === "none" || section.style.display === "") {
        section.style.display = "block";
        triggerBtn.innerHTML = '<i data-lucide="x"></i> Cancel Upload';
    } else {
        section.style.display = "none";
        triggerBtn.innerHTML = '<i data-lucide="sparkles"></i> Create New RFP Response';
    }
    
    lucide.createIcons({
        attrs: { class: 'lucide' },
        nameAttr: 'data-lucide',
        elements: [triggerBtn] 
    });
}
window.toggleUpload = toggleUpload;

function loadActiveBids(userId) {
    const bidsQuery = query(
        collection(firestore, "bids"), 
        where("ownerId", "==", userId),
        where("status", "in", ["drafting", "review"])
    );

    const bidsGrid = document.querySelector('.bids-grid');

    onSnapshot(bidsQuery, (snapshot) => {
        if (snapshot.empty) {
            bidsGrid.innerHTML = "<p>No active bids found. Try creating one!</p>";
            return;
        }

        const tempContainer = document.createElement('div');
        let combinedHtml = "";

        snapshot.forEach((doc) => {
            const bid = doc.data();
            const bidId = doc.id;
            
            let daysLeft = "TBD";
            try {
                if (bid.deadline && typeof bid.deadline.toDate === 'function') {
                    daysLeft = Math.ceil((bid.deadline.toDate() - new Date()) / (1000 * 60 * 60 * 24));
                }
            } catch (e) { console.error("Date error:", e); }

            combinedHtml += `
                <div class="bid-card" id="${bidId}">
                    <div class="bid-status-row">
                        <span class="status-tag ${bid.status}">${bid.status.replace('-', ' ')}</span>
                        <span class="deadline">Due in ${daysLeft} days</span>
                    </div>
                    <h3>${bid.bidName || 'Untitled Project'}</h3>
                    <p class="client-name">${bid.client || 'Unknown Client'}</p>
                    <div class="progress-container-mini">
                        <div class="progress-label">
                            <span>AI Content Ready</span>
                            <span>${bid.progress || 0}%</span>
                        </div>
                        <div class="progress-bar-mini">
                            <div class="fill" style="width: ${bid.progress || 0}%;"></div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 1rem;">
                        <button class="btn-outline" style="flex: 1;" onclick="window.location.href='/workspace.html?id=${bidId}'">Open Workspace</button>
                        <button class="btn-secondary-outline" title="Archive Bid" onclick="archiveBid('${bidId}')" style="width: 42px; padding: 0; display: flex; align-items: center; justify-content: center;">
                            <i data-lucide="archive" style="width: 18px; height: 18px;"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        tempContainer.innerHTML = combinedHtml;
        bidsGrid.replaceChildren(...tempContainer.childNodes);

        if (window.lucide) {
            lucide.createIcons({ root: bidsGrid });
        }
    });
}

// THE ARCHIVE LOGIC
async function archiveBid(bidId) {
    window.showCustomConfirm(
        "Archive Project?", 
        "This will move the project to your RFP Library and remove it from active bids.", 
        async () => {
            try {
                const bidRef = doc(firestore, "bids", bidId);
                const bidSnap = await getDoc(bidRef);

                if (bidSnap.exists()) {
                    const bidData = bidSnap.data();
                    await addDoc(collection(firestore, "archived_rfps"), {
                        ...bidData,
                        dateArchived: serverTimestamp(),
                        summary: `Archived on ${new Date().toLocaleDateString()}`
                    });
                    await deleteDoc(bidRef);
                }
            } catch (error) {
                console.error("Archive error:", error);
            }
        }
    );
}
window.archiveBid = archiveBid;

async function createNewBid(fileName) {
    const user = auth.currentUser;
    if (!user) return alert("Please log in first!");

    try {
        await addDoc(collection(firestore, "bids"), {
            bidName: fileName.split('.')[0], 
            client: "Awaiting Analysis...",
            deadline: serverTimestamp(), 
            status: "drafting",
            progress: 10, 
            ownerId: user.uid,
            createdAt: serverTimestamp()
        });
        toggleUpload(); 
    } catch (e) { console.error("Error adding document: ", e); }
}

// Utility to show our custom confirmation
window.showCustomConfirm = (title, message, onConfirm) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-message').innerText = message;
    
    const actionBtn = document.getElementById('confirm-action-btn');
    
    // We clone the button to strip old event listeners
    const newActionBtn = actionBtn.cloneNode(true);
    actionBtn.parentNode.replaceChild(newActionBtn, actionBtn);
    
    newActionBtn.addEventListener('click', () => {
        onConfirm();
        closeConfirmModal();
    });

    modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons({ root: modal });
};

window.closeConfirmModal = () => {
    document.getElementById('confirm-modal').style.display = 'none';
};