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
    serverTimestamp,
    Timestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Start the sidebar logic
initSidebar();

const firestore = db; 
let selectedFile = null; 

// Protect the page
checkAuthState((user) => {
    console.log("Welcome, user:", user.uid);
    loadActiveBids(user.uid);
});

// Hook up Logout
document.getElementById('logout-btn').addEventListener('click', logoutUser);

// 1. Handle File Selection UI
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');

if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            selectedFile = files[0];
            fileList.innerHTML = `<p><strong>Selected:</strong> ${selectedFile.name}</p>`;
        }
    });
}

// 2. Main Creation Logic
async function handleCreateBid() {
    const user = auth.currentUser;
    const buyerName = document.getElementById('buyer-name')?.value;
    const deadlineValue = document.getElementById('tender-deadline-input')?.value;

    if (!user) return alert("Please log in first!");
    if (!selectedFile) return alert("Please select a tender document first.");
    if (!buyerName) return alert("Please enter the Buyer Organisation.");

    const progressContainer = document.getElementById('progress-container');
    const statusText = document.getElementById('status-text');
    if (progressContainer) progressContainer.style.display = 'block';
    if (statusText) statusText.innerText = "Initializing AI Analysis...";

    try {
        const deadlineDate = deadlineValue ? Timestamp.fromDate(new Date(deadlineValue)) : serverTimestamp();

        await addDoc(collection(firestore, "bids"), {
            bidName: selectedFile.name.split('.')[0], 
            client: buyerName,
            deadline: deadlineDate, 
            status: "drafting",
            progress: 10, 
            ownerId: user.uid,
            createdAt: serverTimestamp(),
            fileName: selectedFile.name
        });

        if (statusText) statusText.innerText = "Project Created!";
        setTimeout(() => {
            resetUploadForm();
            toggleUpload();
        }, 1000);

    } catch (e) { 
        console.error("Error adding document: ", e); 
    }

    const hasMasterDoc = await checkMasterDocument(user.uid);
    if (!hasMasterDoc) {
        alert("Action Required: Please upload your Company Master Document in the Knowledge Base before creating an RFP response.");
        window.location.href = 'knowledge.html';
        return;
    }
}
window.handleCreateBid = handleCreateBid;

function resetUploadForm() {
    selectedFile = null;
    if (document.getElementById('file-input')) document.getElementById('file-input').value = "";
    if (document.getElementById('file-list')) document.getElementById('file-list').innerHTML = "";
    if (document.getElementById('buyer-name')) document.getElementById('buyer-name').value = "";
    if (document.getElementById('tender-deadline-input')) document.getElementById('tender-deadline-input').value = "";
    const pc = document.getElementById('progress-container');
    if (pc) pc.style.display = 'none';
}

function toggleUpload() {
    const section = document.getElementById('upload-section');
    const triggerBtn = document.getElementById('main-upload-trigger');
    if (!section || !triggerBtn) return;

    if (section.style.display === "none" || section.style.display === "") {
        section.style.display = "block";
        triggerBtn.innerHTML = '<i data-lucide="x"></i> Cancel Upload';
    } else {
        section.style.display = "none";
        triggerBtn.innerHTML = '<i data-lucide="sparkles"></i> Create New RFP Response';
        resetUploadForm();
    }
    if (window.lucide) lucide.createIcons();
}
window.toggleUpload = toggleUpload;

// 3. Load Active Bids - FIXED VERSION
function loadActiveBids(userId) {
    const bidsGrid = document.querySelector('.bids-grid');
    
    // Safety check: If the grid doesn't exist, stop here to avoid the crash
    if (!bidsGrid) {
        console.error("Critical Error: .bids-grid not found in HTML. Check index.html for <div class='bids-grid'></div>");
        return;
    }

    const bidsQuery = query(
        collection(firestore, "bids"), 
        where("ownerId", "==", userId),
        where("status", "in", ["drafting", "review"])
    );

    onSnapshot(bidsQuery, (snapshot) => {
        if (snapshot.empty) {
            bidsGrid.innerHTML = "<p>No active bids found. Try creating one!</p>";
            return;
        }

        let combinedHtml = "";

        snapshot.forEach((doc) => {
            const bid = doc.data();
            const bidId = doc.id;
            
            let daysLeft = "TBD";
            try {
                if (bid.deadline && typeof bid.deadline.toDate === 'function') {
                    const diff = bid.deadline.toDate() - new Date();
                    daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
                }
            } catch (e) { console.error("Date error:", e); }

            combinedHtml += `
                <div class="bid-card" id="${bidId}">
                    <div class="bid-status-row">
                        <span class="status-tag ${bid.status}">${bid.status.replace('-', ' ')}</span>
                        <span class="deadline">${daysLeft === "TBD" ? "No Deadline" : "Due in " + daysLeft + " days"}</span>
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

        // Simplified way to update the HTML to avoid reference errors
        bidsGrid.innerHTML = combinedHtml;

        if (window.lucide) {
            lucide.createIcons({ root: bidsGrid });
        }
    });
}

// 4. Archive Logic
async function archiveBid(bidId) {
    window.showCustomConfirm(
        "Archive Project?", 
        "This will move the project to your RFP Library.", 
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

async function checkMasterDocument(userId) {
    const q = query(
        collection(db, "knowledge"), 
        where("ownerId", "==", userId),
        where("status", "==", "processing") // or "ready" if you update it later
    );
    const snap = await getDocs(q);
    return !snap.empty; // Returns true if a document exists
}

// 5. Custom Confirmation Modal
window.showCustomConfirm = (title, message, onConfirm) => {
    const modal = document.getElementById('confirm-modal');
    if (!modal) return;
    
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-message').innerText = message;
    
    const actionBtn = document.getElementById('confirm-action-btn');
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
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.style.display = 'none';
};