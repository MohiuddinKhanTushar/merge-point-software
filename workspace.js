import { initSidebar } from './ui-manager.js';
import { db, auth, app } from './firebase-config.js';
import { checkAuthState } from './auth.js'; 
import { doc, onSnapshot, updateDoc, collection, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

initSidebar();

const urlParams = new URLSearchParams(window.location.search);
const bidId = urlParams.get('id');
const functions = getFunctions(app, "us-east1"); 

let activeSectionIndex = null;
let currentBidData = null;

checkAuthState((user) => {
    if (user && bidId) {
        const docRef = doc(db, "bids", bidId);
        onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                currentBidData = data;
                
                document.getElementById('bid-title').innerText = data.bidName || "Untitled Project";
                document.getElementById('bid-status').innerText = (data.status || "DRAFTING").toUpperCase();
                document.getElementById('client-name').innerHTML = `<strong>Client:</strong> ${data.client || "Not Specified"}`;
                
                if (data.deadline) {
                    document.getElementById('bid-deadline').innerHTML = `<strong>Due:</strong> ${data.deadline.toDate().toLocaleDateString()}`;
                }

                renderSectionsList(data.sections || []);
                updateGlobalProgress(data.sections || []);

                if (activeSectionIndex !== null && document.activeElement !== document.getElementById('ai-content-editor')) {
                    const activeSection = data.sections[activeSectionIndex];
                    document.getElementById('ai-content-editor').value = activeSection.draftAnswer || activeSection.aiResponse || "";
                    updateMetrics(activeSection.draftAnswer || activeSection.aiResponse || "", activeSection.confidence);
                    displayManagerFeedback(activeSection);
                }
            }
        });
        
        loadReviewerDropdown();

        // ATTACH BUTTON LISTENER
        const saveBtn = document.getElementById('save-bid-btn');
        if (saveBtn) {
            saveBtn.onclick = saveActiveSection;
        }
    }
});

// Helper to show/hide the red feedback box
function displayManagerFeedback(section) {
    const container = document.getElementById('manager-feedback-box');
    if (!container) return;

    // Only show if status is flagged AND notes exist
    if (section.status === 'flagged' && section.managerNotes) {
        container.innerHTML = `
            <div id="active-feedback-card" style="background: #fff1f2; border: 1px solid #fda4af; border-left: 5px solid #ef4444; padding: 15px; margin-bottom: 20px; border-radius: 8px; animation: slideIn 0.3s ease-out;">
                <div style="display: flex; align-items: center; gap: 8px; color: #9f1239; font-weight: 800; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
                    <i data-lucide="message-square" style="width:16px; height:16px;"></i> Manager Revision Notes
                </div>
                <p style="color: #be123c; margin: 0; font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap;">${section.managerNotes}</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    } else {
        container.innerHTML = "";
    }
}

function renderSectionsList(sections) {
    const sectionsList = document.getElementById('sections-list');
    if (!sectionsList) return;

    sectionsList.innerHTML = "";
    sections.forEach((section, index) => {
        const item = document.createElement('div');
        item.className = `section-item ${activeSectionIndex === index ? 'active' : ''}`;
        
        let statusText = "EMPTY";
        let statusClass = "status-empty";

        if (section.status === 'flagged') {
            statusText = "ACTION REQ.";
            statusClass = "status-flagged"; 
        } else if ((section.aiResponse && section.aiResponse.trim().length > 0) || (section.draftAnswer && section.draftAnswer.trim().length > 0)) {
            statusText = "COMPLETED";
            statusClass = "status-ready";
        }

        item.innerHTML = `
            <div class="section-info">
                <span class="badge ${statusClass}">${statusText}</span>
                <p class="section-q">${section.question.substring(0, 60)}...</p>
            </div>
        `;

        item.onclick = () => {
            activeSectionIndex = index;
            document.querySelectorAll('.section-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            document.getElementById('current-section-name').innerText = section.question;
            const editor = document.getElementById('ai-content-editor');
            editor.value = section.draftAnswer || section.aiResponse || "";
            updateMetrics(editor.value, section.confidence);
            displayManagerFeedback(section);
            setupMagicButton(section.question);
        };
        sectionsList.appendChild(item);
    });
}

// Logic to Save and specifically clear the manager flag
async function saveActiveSection() {
    if (activeSectionIndex === null || !currentBidData) {
        return showToast("Select a section first", "error");
    }

    const saveBtn = document.getElementById('save-bid-btn');
    const originalContent = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Saving...`;
    if (window.lucide) lucide.createIcons();

    const editorValue = document.getElementById('ai-content-editor').value;
    const updatedSections = [...currentBidData.sections];
    
    // Update content and RESET status/notes
    updatedSections[activeSectionIndex].draftAnswer = editorValue;
    updatedSections[activeSectionIndex].status = 'completed'; // This turns the badge GREEN
    updatedSections[activeSectionIndex].managerNotes = "";    // This hides the RED box via displayManagerFeedback

    try {
        await updateDoc(doc(db, "bids", bidId), { sections: updatedSections });
        showToast("Changes saved & feedback dismissed.");
    } catch (e) {
        showToast("Error saving changes", "error");
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalContent;
        if (window.lucide) lucide.createIcons();
    }
}

// Keyboard Shortcut (Ctrl+S / Cmd+S)
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActiveSection();
    }
});

// --- REST OF YOUR EXISTING UTILITIES (UNCHANGED) ---
async function updateGlobalProgress(sections) {
    if (!sections || sections.length === 0) return;
    const completedCount = sections.filter(s => 
        (s.aiResponse && s.aiResponse.trim().length > 0) || 
        (s.draftAnswer && s.draftAnswer.trim().length > 0)
    ).length;
    const percentage = Math.round((completedCount / sections.length) * 100);
    const bar = document.getElementById('overall-progress-bar');
    const text = document.getElementById('progress-text');
    const submitBtn = document.getElementById('submit-review-btn');
    if (bar && text) {
        bar.style.width = `${percentage}%`;
        text.innerText = `${percentage}% Done`;
    }
    if (submitBtn) {
        submitBtn.disabled = percentage < 100;
        submitBtn.style.opacity = percentage < 100 ? "0.5" : "1";
    }
    try {
        const bidRef = doc(db, "bids", bidId);
        await updateDoc(bidRef, { progress: percentage });
    } catch (e) { console.error("Sync error:", e); }
}

async function loadReviewerDropdown() {
    const existingDropdown = document.getElementById('reviewer-select');
    if (existingDropdown) return;
    const select = document.createElement('select');
    select.id = 'reviewer-select';
    select.className = "reviewer-dropdown-style";
    select.style.cssText = "width:100%; padding:12px; margin-bottom:15px; border-radius:8px; border:1px solid #ddd;";
    const defaultOpt = document.createElement('option');
    defaultOpt.text = "Select a Manager/Reviewer...";
    select.add(defaultOpt);
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        querySnapshot.forEach((doc) => {
            const userData = doc.data();
            const opt = document.createElement('option');
            opt.value = userData.email;
            opt.text = `${userData.displayName || 'Team Member'} (${userData.email})`;
            select.add(opt);
        });
        const oldInput = document.getElementById('reviewer-email');
        if (oldInput) oldInput.replaceWith(select);
    } catch (e) { console.error("Error loading directory:", e); }
}

document.getElementById('confirm-submit-btn').onclick = async () => {
    const reviewerEmail = document.getElementById('reviewer-select').value;
    const btn = document.getElementById('confirm-submit-btn');
    if (!reviewerEmail || reviewerEmail.includes("Select")) return alert("Please select a reviewer.");
    btn.disabled = true;
    btn.innerText = "Sending...";
    try {
        await updateDoc(doc(db, "bids", bidId), {
            status: "review",
            assignedReviewer: reviewerEmail,
            submittedAt: new Date()
        });
        await addDoc(collection(db, "notifications"), {
            recipientEmail: reviewerEmail,
            type: "submission",
            message: `New tender submitted: ${currentBidData.bidName || 'Untitled'}`,
            bidId: bidId,
            read: false,
            createdAt: new Date()
        });
        showToast("Tender submitted successfully!");
        setTimeout(() => window.location.href = 'index.html', 1500);
    } catch (e) {
        alert("Submission failed: " + e.message);
        btn.disabled = false;
        btn.innerText = "Send to Reviewer";
    }
};

function updateMetrics(text, confidence) {
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    const wordCountEl = document.getElementById('word-count');
    const confidenceEl = document.getElementById('confidence-level');
    if (wordCountEl) wordCountEl.innerText = wordCount;
    if (confidenceEl) confidenceEl.innerText = confidence ? `${confidence}%` : "---";
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}"></i><span>${message}</span>`;
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 500); }, 3000);
}

function setupMagicButton(questionText) {
    const magicBtn = document.getElementById('magic-draft-btn');
    if (!magicBtn) return;
    const newBtn = magicBtn.cloneNode(true);
    magicBtn.parentNode.replaceChild(newBtn, magicBtn);
    newBtn.onclick = async () => {
        const editor = document.getElementById('ai-content-editor');
        newBtn.disabled = true;
        newBtn.innerHTML = `<i data-lucide="sparkles" class="spin"></i> Drafting...`;
        try {
            const generateDraft = httpsCallable(functions, 'generateSectionDraft');
            const result = await generateDraft({ question: questionText, bidId: bidId, sectionIndex: activeSectionIndex });
            if (result.data.success) {
                editor.value = result.data.answer;
                showToast("Draft generated!");
            }
        } catch (e) { showToast("Drafting failed", "error"); } finally {
            newBtn.disabled = false;
            newBtn.innerHTML = `<i data-lucide="sparkles"></i> Magic AI Draft`;
            if (window.lucide) lucide.createIcons();
        }
    };
}

const modal = document.getElementById('review-modal');
const openModalBtn = document.getElementById('submit-review-btn');
if (openModalBtn) openModalBtn.onclick = () => modal.style.display = 'flex';
window.closeModal = () => modal.style.display = 'none';