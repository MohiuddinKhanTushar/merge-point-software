import { db, auth, app } from './firebase-config.js'; 
import { checkAuthState, logoutUser } from './auth.js';
import { 
    collection, 
    query, 
    where, 
    onSnapshot, 
    addDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// We don't need initializeFirestore here anymore because it's done in the config!
const firestore = db; 

// Protect the page
checkAuthState((user) => {
    console.log("Welcome, user:", user.uid);
    loadActiveBids(user.uid);
});

// Hook up that Logout button in your sidebar
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
        // Manual icon swap to avoid global flicker
        triggerBtn.innerHTML = '<i data-lucide="x"></i> Cancel Upload';
    } else {
        section.style.display = "none";
        triggerBtn.innerHTML = '<i data-lucide="sparkles"></i> Create New RFP Response';
    }
    
    // Target ONLY the button icons, not the whole page/sidebar
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
        console.log(`Found ${snapshot.size} bids for user ${userId}`);

        // 1. If no bids, update text and exit
        if (snapshot.empty) {
            bidsGrid.innerHTML = "<p>No active bids found. Try creating one!</p>";
            return;
        }

        // 2. Build the HTML in memory first to prevent multiple "paints"
        const tempContainer = document.createElement('div');
        let combinedHtml = "";

        snapshot.forEach((doc) => {
            const bid = doc.data();
            const bidId = doc.id;
            
            // Date Calculation
            let daysLeft = "TBD";
            try {
                if (bid.deadline && typeof bid.deadline.toDate === 'function') {
                    daysLeft = Math.ceil((bid.deadline.toDate() - new Date()) / (1000 * 60 * 60 * 24));
                }
            } catch (e) {
                console.error("Date error for bid:", bidId, e);
            }

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
                    <button class="btn-outline" onclick="window.location.href='/workspace.html?id=${bidId}'">Open Workspace</button>
                </div>
            `;
        });

        // 3. ATOMIC SWAP: replaceChildren clears AND adds in one single browser frame
        // This is the most efficient way to prevent flickering.
        tempContainer.innerHTML = combinedHtml;
        bidsGrid.replaceChildren(...tempContainer.childNodes);

        // 4. Scoped Icon Refresh
        if (window.lucide) {
            lucide.createIcons({
                root: bidsGrid
            });
        }
    });
}

async function createNewBid(fileName) {
    const user = auth.currentUser;
    if (!user) return alert("Please log in first!");

    try {
        const docRef = await addDoc(collection(firestore, "bids"), {
            bidName: fileName.split('.')[0], 
            client: "Awaiting Analysis...",
            deadline: serverTimestamp(), 
            status: "drafting",
            progress: 10, 
            ownerId: user.uid,
            createdAt: serverTimestamp()
        });

        console.log("Document written with ID: ", docRef.id);
        toggleUpload(); 
        
    } catch (e) {
        console.error("Error adding document: ", e);
    }
}