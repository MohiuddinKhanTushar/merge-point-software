import { initSidebar } from './ui-manager.js';
// ... your other imports ...

// Start the sidebar logic
initSidebar();

// ... the rest of your firebase code ...

import { storage, db, auth } from './firebase-config.js'; 
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { collection, addDoc, onSnapshot, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// 1. Selectors
const libraryGrid = document.getElementById('library-grid');
const fileInput = document.getElementById('knowledge-file-input');
const progressContainer = document.getElementById('knowledge-progress-container');
const progressFill = document.getElementById('knowledge-progress-fill');
const statusText = document.getElementById('knowledge-status-text');
const uploadTrigger = document.getElementById('knowledge-upload-trigger');
const uploadSection = document.getElementById('knowledge-upload-section');

// 2. Auth Guard
auth.onAuthStateChanged((user) => {
    if (user) {
        loadLibrary(user.uid);
        setupUpload(user.uid);
    } else {
        window.location.href = 'login.html';
    }
});

// 3. Toggle Upload Section
if (uploadTrigger && uploadSection) {
    uploadSection.style.display = 'none'; // Ensure hidden on load
    uploadTrigger.addEventListener('click', () => {
        if (uploadSection.style.display === 'none' || uploadSection.style.display === '') {
            uploadSection.style.display = 'block';
        } else {
            uploadSection.style.display = 'none';
        }
    });
}

// 4. Handle Upload Logic
function setupUpload(userId) {
    if (!fileInput) return;

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        progressContainer.style.display = 'block';
        statusText.innerText = "Uploading to Knowledge Base...";

        try {
            const storageRef = ref(storage, `knowledge/${userId}/${file.name}`);
            const uploadTask = uploadBytesResumable(storageRef, file);

            uploadTask.on('state_changed', 
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    progressFill.style.width = progress + '%';
                }, 
                (error) => {
                    console.error("Upload error:", error);
                    alert("Upload failed.");
                }, 
                async () => {
                    const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

                    // Uses 'db' from imports
                    await addDoc(collection(db, "knowledge"), {
                        ownerId: userId,
                        fileName: file.name,
                        fileUrl: downloadURL,
                        type: "master-document",
                        uploadedAt: serverTimestamp()
                    });

                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                        progressFill.style.width = '0%';
                        uploadSection.style.display = 'none'; 
                        alert("Master Document added successfully!");
                    }, 1000);
                }
            );
        } catch (error) {
            console.error("Setup error:", error);
        }
    });
}

// 5. Load Library (The fixed function)
function loadLibrary(userId) {
    if (!libraryGrid) return;

    // Fixed the variable reference to 'db'
    const q = query(collection(db, "knowledge"), where("ownerId", "==", userId));

    onSnapshot(q, (snapshot) => {
        libraryGrid.innerHTML = ''; // Clear the "Loading..." text

        if (snapshot.empty) {
            libraryGrid.innerHTML = `
                <div class="loading-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
                    <p>Your library is empty. Upload a master document to get started.</p>
                </div>`;
            return;
        }

        snapshot.forEach((doc) => {
            const data = doc.data();
            const dateStr = data.uploadedAt?.toDate() 
                ? data.uploadedAt.toDate().toLocaleDateString() 
                : 'Just now';

            const cardHtml = `
                <div class="bid-card">
                    <div class="bid-status-row">
                        <span class="status-tag drafting">Master Doc</span>
                        <span class="deadline">${dateStr}</span>
                    </div>
                    <div class="bid-info">
                        <h3>${data.fileName}</h3>
                        <p class="client-name">Company Reference Material</p>
                    </div>
                    <div class="bid-footer" style="margin-top: 1.5rem;">
                        <button class="btn-outline" style="width: 100%;" onclick="window.open('${data.fileUrl}', '_blank')">
                            <i data-lucide="external-link" style="width: 16px; height: 16px; margin-right: 8px;"></i>
                            View Document
                        </button>
                    </div>
                </div>
            `;
            libraryGrid.insertAdjacentHTML('beforeend', cardHtml);
        });

        if (window.lucide) {
            lucide.createIcons({ root: libraryGrid });
        }
    });
}